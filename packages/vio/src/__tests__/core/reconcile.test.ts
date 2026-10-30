import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Renderer } from '../../core/renderer'
import { defineComponent } from '../../core/component'
import { EventBus } from '../../runtime/event-bus'
import type { ComponentContext } from '../../core/types'

let container: HTMLElement
let bus: EventBus
let renderer: Renderer

beforeEach(() => {
  document.body.innerHTML = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  bus = new EventBus()
  renderer = new Renderer(container, bus)
})

const List = defineComponent({
  name: 'List',
  state: { items: ['a', 'b', 'c'] },
  render: (s) => ({
    tag: 'ul',
    children: (s.items as string[]).map(x => ({ tag: 'li', key: x, children: [x] }))
  })
})

describe('root replacement', () => {
  it('keeps updating after the root tag changes', () => {
    const inst = renderer.mount(defineComponent({
      name: 'A',
      state: { on: false, n: 0 },
      render: (s) => s.on ? { tag: 'p', children: [String(s.n)] } : { tag: 'div', children: [String(s.n)] }
    }))
    renderer.setState(inst.id, { on: true })
    renderer.setState(inst.id, { n: 5 })
    expect(container.innerHTML).toBe('<p>5</p>')
    expect(renderer.getInstance(inst.id)!.element!.isConnected).toBe(true)
    renderer.setState(inst.id, { on: false })
    expect(container.innerHTML).toBe('<div>5</div>')
  })

  it('supports render returning null', () => {
    const inst = renderer.mount(defineComponent({ name: 'N', state: { show: false }, render: (s) => s.show ? { tag: 'b' } : null }))
    expect(container.querySelector('b')).toBeNull()
    renderer.setState(inst.id, { show: true })
    expect(container.querySelector('b')).not.toBeNull()
  })
})

describe('keyed reconciliation', () => {
  it('moves keyed nodes instead of rewriting them', () => {
    const inst = renderer.mount(List)
    const [a, b, c] = Array.from(container.querySelectorAll('li'))
    renderer.setState(inst.id, { items: ['c', 'a', 'b'] })
    const after = Array.from(container.querySelectorAll('li'))
    expect(after.map(li => li.textContent)).toEqual(['c', 'a', 'b'])
    expect(after[0]).toBe(c)
    expect(after[1]).toBe(a)
    expect(after[2]).toBe(b)
  })

  it('preserves focus and typed input across a reorder', () => {
    const Inputs = defineComponent({
      name: 'Inputs',
      state: { ids: ['x', 'y'] },
      render: (s) => ({ tag: 'div', children: (s.ids as string[]).map(id => ({ tag: 'input', key: id, props: { id } })) })
    })
    const inst = renderer.mount(Inputs)
    const y = container.querySelector('#y') as HTMLInputElement
    y.value = 'typed'
    y.focus()
    renderer.setState(inst.id, { ids: ['y', 'x'] })
    expect(container.querySelector('input')).toBe(y)
    expect(y.value).toBe('typed')
    expect(document.activeElement).toBe(y)
  })

  it('handles insert, remove, and reverse together', () => {
    const inst = renderer.mount(List)
    renderer.setState(inst.id, { items: ['d', 'c', 'a'] })
    expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(['d', 'c', 'a'])
    renderer.setState(inst.id, { items: [] })
    expect(container.querySelectorAll('li')).toHaveLength(0)
    renderer.setState(inst.id, { items: ['z', 'y'] })
    expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(['z', 'y'])
  })

  it('matches a random shuffle sequence against a fresh render', () => {
    const inst = renderer.mount(List)
    let seed = 7
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let round = 0; round < 50; round++) {
      const pool = 'abcdefghij'.split('').filter(() => rand() > 0.4)
      pool.sort(() => rand() - 0.5)
      renderer.setState(inst.id, { items: pool })
      expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(pool)
    }
  })

  it('flattens nested child arrays', () => {
    renderer.mount(defineComponent({ name: 'F', render: () => ({ tag: 'p', children: ['a', ['b', ['c']], null] }) }))
    expect(container.textContent).toBe('abc')
  })
})

describe('component instances', () => {
  it('gives nested components their own state, lifecycle, and context', () => {
    const mounted: string[] = []
    const unmounted: string[] = []
    let childCtx: ComponentContext | null = null
    const Child = defineComponent({
      name: 'Child',
      state: { n: 0 },
      render: (s, ctx) => {
        childCtx = ctx
        return { tag: 'span', children: [`${ctx.props.label}:${s.n}`] }
      },
      onMount: (ctx) => { mounted.push(ctx.id) },
      onUnmount: (ctx) => { unmounted.push(ctx.id) }
    })
    const Parent = defineComponent({
      name: 'Parent',
      state: { show: true, label: 'x' },
      render: (s) => ({ tag: 'div', children: [s.show ? { tag: Child, props: { label: s.label } } : null] })
    })

    const p = renderer.mount(Parent)
    expect(container.textContent).toBe('x:0')
    expect(mounted).toEqual(['Parent/Child'])

    childCtx!.setState({ n: 3 })
    expect(container.textContent).toBe('x:3')

    // Parent re-render with new props keeps child state
    renderer.setState(p.id, { label: 'y' })
    expect(container.textContent).toBe('y:3')

    renderer.setState(p.id, { show: false })
    expect(unmounted).toEqual(['Parent/Child'])
    expect(renderer.getInstance('Parent/Child')).toBeUndefined()
  })

  it('preserves keyed child component state across reorder', () => {
    const Item = defineComponent({
      name: 'Item',
      state: { clicks: 0 },
      render: (s, ctx) => ({ tag: 'li', props: { onClick: () => ctx.setState({ clicks: (s.clicks as number) + 1 }) }, children: [`${ctx.props.id}:${s.clicks}`] })
    })
    const Parent = defineComponent({
      name: 'P',
      state: { ids: ['a', 'b'] },
      render: (s) => ({ tag: 'ul', children: (s.ids as string[]).map(id => ({ tag: Item, key: id, props: { id } })) })
    })
    const p = renderer.mount(Parent)
    ;(container.querySelectorAll('li')[1] as HTMLElement).click()
    expect(container.textContent).toBe('a:0b:1')
    renderer.setState(p.id, { ids: ['b', 'a'] })
    expect(container.textContent).toBe('b:1a:0')
    expect(renderer.getTree()!.children.map(c => c.id)).toEqual(['P/Item[a]', 'P/Item[b]'])
  })

  it('runs onMount after the element is in the document', () => {
    let connected = false
    renderer.mount(defineComponent({
      name: 'M',
      render: () => ({ tag: 'div', props: { ref: 'box' } }),
      onMount: (ctx) => { connected = ctx.getRef('box')?.isConnected ?? false }
    }))
    expect(connected).toBe(true)
  })

  it('returns a truthful nested tree', () => {
    const Leaf = defineComponent({ name: 'Leaf', state: { v: 1 }, render: () => ({ tag: 'i' }) })
    const Mid = defineComponent({ name: 'Mid', render: () => ({ tag: 'div', children: [{ tag: Leaf }, { tag: Leaf }] }) })
    renderer.mount(defineComponent({ name: 'Root', render: () => ({ tag: 'main', children: [{ tag: Mid, props: { fn: () => 1, n: 2 } }] }) }))
    expect(renderer.getTree()).toEqual({
      id: 'Root', name: 'Root', state: {},
      children: [{
        id: 'Root/Mid', name: 'Mid', state: {}, props: { n: 2 },
        children: [
          { id: 'Root/Mid/Leaf', name: 'Leaf', state: { v: 1 }, children: [] },
          { id: 'Root/Mid/Leaf.1', name: 'Leaf', state: { v: 1 }, children: [] }
        ]
      }]
    })
  })

  it('accepts bare render functions as tags', () => {
    function Badge(_s: Record<string, unknown>, ctx: ComponentContext) { return { tag: 'em', children: [String(ctx.props.text)] } }
    renderer.mount(defineComponent({ name: 'R', render: () => ({ tag: 'div', children: [{ tag: Badge, props: { text: 'hi' } }] }) }))
    expect(container.innerHTML).toBe('<div><em>hi</em></div>')
  })

  it('appends to parentEl when given', () => {
    const host = document.createElement('section')
    container.appendChild(host)
    renderer.mount(defineComponent({ name: 'W', render: () => ({ tag: 'b', children: ['w'] }) }), host)
    expect(host.innerHTML).toBe('<b>w</b>')
  })

  it('batches several setState calls into one render', () => {
    const render = vi.fn((s: Record<string, unknown>) => ({ tag: 'span', children: [String(s.n)] }))
    const inst = renderer.mount(defineComponent({ name: 'B', state: { n: 0 }, render }))
    render.mockClear()
    renderer.batch(() => {
      renderer.setState(inst.id, { n: 1 })
      renderer.setState(inst.id, { n: 2 })
    })
    expect(render).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('2')
  })

  it('reports render errors with the component id', () => {
    const handler = vi.fn()
    bus.on('component:error', handler)
    const Bad = defineComponent({ name: 'Bad', render: () => { throw new Error('boom') } })
    expect(() => renderer.mount(defineComponent({ name: 'Top', render: () => ({ tag: 'div', children: [{ tag: Bad }] }) }))).toThrow(/E_RENDER Top\/Bad: boom/)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ id: 'Top/Bad', phase: 'render' }) }))
  })

  it('stops runaway update loops', () => {
    const inst = renderer.mount(defineComponent({
      name: 'Loop', state: { n: 0 }, render: (s) => ({ tag: 'i', children: [String(s.n)] }),
      onUpdate: (ctx) => ctx.setState({ n: (ctx.getState().n as number) + 1 })
    }))
    expect(() => renderer.setState(inst.id, { n: 1 })).toThrow(/E_UPDATE_LOOP/)
  })

  it('destroy unmounts everything and runs cleanups', () => {
    const cleanup = vi.fn()
    const Child = defineComponent({ name: 'C', render: () => ({ tag: 'i' }), onMount: () => cleanup })
    renderer.mount(defineComponent({ name: 'D', render: () => ({ tag: 'div', children: [{ tag: Child }] }) }))
    renderer.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
    expect(renderer.getTree()).toBeNull()
  })
})
