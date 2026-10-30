import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from '../../core/app'
import { defineComponent } from '../../core/component'
import { applyPatch } from '../../agent/protocol'
import { defineCatalog, describeCatalog, validateSpec, defineSpecView } from '../../spec'
import type { Spec } from '../../spec'

interface Todo { id: number; text: string; done: boolean }

const Badge = defineComponent({
  name: 'Badge',
  render: (_s, ctx) => ({ tag: 'span', props: { class: `badge ${ctx.props.tone ?? 'info'}` }, children: [String(ctx.props.label)] })
})

const Card = defineComponent({
  name: 'Card',
  render: (_s, ctx) => ({ tag: 'section', props: { 'aria-label': String(ctx.props.title) }, children: ctx.props.children as never })
})

const catalog = defineCatalog({
  components: {
    Badge: { component: Badge, doc: 'Small status label', props: { 'label!': 'string', tone: ['info', 'warn'] } },
    Card: { component: Card, props: { 'title!': 'string' }, children: true }
  }
})

const ACTIONS = ['add', 'toggle', 'setDraft']

function todoSpec(): Spec {
  return {
    root: 'card',
    nodes: {
      card: { type: 'Card', props: { title: 'Todos' }, children: ['input', 'list', 'count'] },
      input: { type: 'input', props: { value: { $state: '/draft' }, onInput: { $action: 'setDraft', args: { $event: 'value' } } } },
      list: { type: 'ul', children: ['row'] },
      row: { type: 'li', each: '/todos', key: 'id', props: { class: { $item: '/done' } }, children: ['check', 'label'] },
      check: { type: 'input', props: { type: 'checkbox', checked: { $item: '/done' }, onChange: { $action: 'toggle', args: { $item: '/id' } } } },
      label: { type: 'span', text: { $item: '/text' } },
      count: { type: 'Badge', props: { label: { $state: '/summary' } } }
    }
  }
}

function makeApp(spec: Spec | null = todoSpec()) {
  document.body.innerHTML = '<div id="app"></div>'
  window.location.hash = ''
  const View = defineSpecView({ name: 'View', catalog, spec, actions: ACTIONS })
  const todos: Todo[] = [{ id: 1, text: 'milk', done: false }, { id: 2, text: 'eggs', done: true }]
  const app = createApp({
    root: '#app',
    routes: [{ path: '/', component: View }],
    store: {
      state: { todos, draft: '', summary: '1 left' },
      actions: {
        add: (s) => ({ ...s, todos: [...(s.todos as Todo[]), { id: 3, text: s.draft as string, done: false }], draft: '' }),
        toggle: (s, id) => ({ ...s, todos: (s.todos as Todo[]).map(t => t.id === id ? { ...t, done: !t.done } : t) }),
        setDraft: (s, draft) => ({ ...s, draft })
      }
    }
  })
  app.mount()
  return app
}

beforeEach(() => { document.body.innerHTML = '' })

describe('catalog', () => {
  it('describes itself compactly for an agent prompt', () => {
    const text = describeCatalog(catalog)
    expect(text).toContain('Badge(label!:string, tone:info|warn) Small status label')
    expect(text).toContain('Card(title!:string) +children')
    expect(text).toContain('HTML: div span p')
  })
})

describe('validateSpec', () => {
  const codes = (spec: unknown, opts = { actions: ACTIONS }) => validateSpec(spec, catalog, opts).map(e => `${e.code} ${e.path}`)

  it('accepts a good spec', () => {
    expect(validateSpec(todoSpec(), catalog, { actions: ACTIONS })).toEqual([])
  })

  it('suggests fixes for typos', () => {
    const errors = validateSpec({ root: 'a', nodes: { a: { type: 'Bdge', props: { label: 'x' } } } }, catalog)
    expect(errors[0]!.message).toBe('"Bdge" is not in the catalog; did you mean "Badge"?')
    const prop = validateSpec({ root: 'a', nodes: { a: { type: 'Badge', props: { lable: 'x' } } } }, catalog)
    expect(prop.map(e => e.message)).toEqual(['Badge has no prop "lable"; did you mean "label"?', 'Badge needs prop "label"'])
    const action = validateSpec({ root: 'a', nodes: { a: { type: 'button', props: { onClick: { $action: 'tggle' } } } } }, catalog, { actions: ACTIONS })
    expect(action[0]!.message).toBe('unknown action "tggle"; did you mean "toggle"?')
  })

  it('checks prop types, enums, required props, and children', () => {
    expect(codes({ root: 'a', nodes: { a: { type: 'Badge', props: { label: 1, tone: 'loud' } } } })).toEqual([
      'E_SPEC_PROP_TYPE /nodes/a/props/label',
      'E_SPEC_PROP_TYPE /nodes/a/props/tone'
    ])
    expect(codes({ root: 'a', nodes: { a: { type: 'Badge', props: { label: 'x' }, children: ['b'] }, b: { type: 'p' } } })).toEqual(['E_SPEC_CHILDREN /nodes/a/children'])
    expect(codes({ root: 'a', nodes: { a: { type: 'div', children: ['missing'] } } })).toEqual(['E_SPEC_CHILD /nodes/a/children/0'])
  })

  it('rejects structural problems', () => {
    expect(codes({ root: 'x', nodes: {} })).toEqual(['E_SPEC_ROOT /root'])
    expect(codes({ root: 'a', nodes: { a: { type: 'div', children: ['a'] } } })).toEqual(['E_SPEC_CYCLE /nodes/a'])
    expect(codes({ root: 'a', nodes: { a: { type: 'div', children: ['b', 'b'] }, b: { type: 'p' } } })).toEqual(['E_SPEC_SHARED /nodes/b'])
    expect(codes({ root: 'a', nodes: { a: { type: 'div', txt: 'x' } } })).toEqual(['E_SPEC_FIELD /nodes/a/txt'])
    expect(codes({ root: 'a', nodes: { a: { type: 'p', text: { $item: '/x' } } } })).toEqual(['E_SPEC_EXPR /nodes/a/text/$item'])
  })

  describe('malicious specs', () => {
    it('rejects script, iframe, and other unlisted tags', () => {
      for (const type of ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'svg']) {
        expect(codes({ root: 'a', nodes: { a: { type } } })).toEqual(['E_SPEC_TYPE /nodes/a/type'])
      }
    })

    it('rejects string handlers, raw HTML props, and functions', () => {
      expect(codes({ root: 'a', nodes: { a: { type: 'button', props: { onClick: 'alert(1)' } } } })).toEqual(['E_SPEC_HANDLER /nodes/a/props/onClick'])
      expect(codes({ root: 'a', nodes: { a: { type: 'div', props: { innerHTML: '<img onerror=x>' } } } })).toEqual(['E_SPEC_PROP /nodes/a/props/innerHTML'])
      expect(codes({ root: 'a', nodes: { a: { type: 'div', props: { title: () => 1 } } } })).toEqual(['E_SPEC_VALUE /nodes/a/props/title'])
    })

    it('rejects prototype pollution keys', () => {
      const spec = JSON.parse('{"root":"a","nodes":{"a":{"type":"div","props":{"__proto__":{"polluted":true}}}}}')
      expect(codes(spec)).toEqual(['E_SPEC_KEY /nodes/a/props/__proto__'])
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('enforces node and depth limits', () => {
      const nodes: Record<string, unknown> = {}
      for (let i = 0; i < 50; i++) nodes[`n${i}`] = { type: 'div', children: i < 49 ? [`n${i + 1}`] : [] }
      expect(codes({ root: 'n0', nodes }, { actions: ACTIONS })).toContain('E_SPEC_DEPTH /nodes/n32')
      expect(validateSpec({ root: 'n0', nodes }, catalog, { maxNodes: 10 }).map(e => e.code)).toContain('E_SPEC_SIZE')
    })
  })
})

describe('defineSpecView', () => {
  it('renders state, item scopes, lists, and catalog components', () => {
    makeApp()
    const items = document.querySelectorAll('li')
    expect([...items].map(li => li.textContent)).toEqual(['milk', 'eggs'])
    expect((items[1]!.querySelector('input') as HTMLInputElement).checked).toBe(true)
    expect(items[1]!.className).toBe('true')
    expect(document.querySelector('section')!.getAttribute('aria-label')).toBe('Todos')
    expect(document.querySelector('.badge')!.textContent).toBe('1 left')
  })

  it('wires $action with $item and $event args to store actions', async () => {
    const app = makeApp()
    ;(document.querySelector('li input') as HTMLInputElement).click()
    expect((app.getStore().todos as Todo[])[0]!.done).toBe(true)
    const input = document.querySelector('section > input') as HTMLInputElement
    input.value = 'bread'
    input.dispatchEvent(new Event('input'))
    expect(app.getStore().draft).toBe('bread')
    expect(input.value).toBe('bread')
  })

  it('shows validation errors instead of rendering, visible to see()', () => {
    const app = makeApp({ root: 'a', nodes: { a: { type: 'script', text: 'alert(1)' } } })
    expect(document.querySelector('script')).toBeNull()
    expect(app.see()).toContain(`alert "E_SPEC_TYPE /nodes/a/type: 'script' is not in the catalog`)
    const long = makeApp({ root: 'a', nodes: { a: { type: 'Badge', props: { lable: 'x', tone: 'loud' } } } })
    const line = long.see().split('\n').find(l => l.includes('alert'))!
    expect(line).toContain('did you mean')
    expect(line).toContain('E_SPEC_REQUIRED')
  })

  it('lets an agent build and edit the UI with patches', async () => {
    const app = makeApp(null)
    expect(document.querySelector('#app')!.innerHTML).toBe('<!---->')
    app.patchState('View', [{ op: 'replace', path: '/spec', value: { root: 'h', nodes: { h: { type: 'h1', text: 'Hello' } } } }])
    expect(app.see()).toContain('h1 "Hello"')
    app.see()
    app.patchState('View', [
      { op: 'add', path: '/spec/nodes/b', value: { type: 'Badge', props: { label: { $state: '/summary' }, tone: 'warn' } } },
      { op: 'replace', path: '/spec/root', value: 'card' },
      { op: 'add', path: '/spec/nodes/card', value: { type: 'Card', props: { title: 'Box' }, children: ['h', 'b'] } }
    ])
    const diff = app.see({ diff: true })
    expect(diff).toMatch(/\+ e\d+ section "Box"/)
    expect(diff).toContain('"1 left"')
    expect(() => app.patchState('View', [{ op: 'remove', path: '/spec/nodes/zzz' }])).toThrow('E_PATCH ops[0] remove /spec/nodes/zzz: "zzz" does not exist')
  })
})

describe('manifest docs', () => {
  it('advertises the spec view and its catalog to agents', () => {
    const app = makeApp(null)
    const doc = app.manifest().docs!.View!
    expect(doc).toContain('patchState')
    expect(doc).toContain('Badge(label!:string, tone:info|warn)')
  })
})

describe('applyPatch', () => {
  it('copies only along the path and leaves the input alone', () => {
    const doc = { a: { b: [1, 2] }, c: { d: 1 } }
    const out = applyPatch(doc, [{ op: 'add', path: '/a/b/-', value: 3 }, { op: 'replace', path: '/a/b/0', value: 9 }])
    expect(out).toEqual({ a: { b: [9, 2, 3] }, c: { d: 1 } })
    expect(doc.a.b).toEqual([1, 2])
    expect(out.c).toBe(doc.c)
  })

  it('is all-or-nothing and supports test', () => {
    const doc = { n: 1 }
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/n', value: 2 }, { op: 'test', path: '/n', value: 1 }])).toThrow('E_PATCH ops[1] test /n: test failed, value is 2')
    expect(doc.n).toBe(1)
  })

  it('refuses prototype keys', () => {
    expect(() => applyPatch({}, [{ op: 'add', path: '/__proto__/x', value: 1 }])).toThrow(/unsafe key/)
  })
})

describe('spec token budget', () => {
  it('catalog description for two components stays small', async () => {
    const { encode } = await import('gpt-tokenizer')
    expect(encode(describeCatalog(catalog)).length).toBeLessThanOrEqual(220)
  })
})
