import { describe, it, expect, beforeEach } from 'vitest'
import { makeTodoApp, resetDom } from '../fixtures/todo-app'

beforeEach(resetDom)

/** Ref of the first element with `role` on a line containing `within`. */
function refFor(snapshot: string, role: string, within = ''): string {
  for (const line of snapshot.split('\n')) {
    if (!line.includes(within)) continue
    for (const seg of line.trim().split(/: |, (?=e\d+ )/)) {
      const [ref, r] = seg.split(' ')
      if (r === role) return ref!
    }
  }
  throw new Error(`no ${role} near "${within}" in:\n${snapshot}`)
}

describe('see', () => {
  it('renders a compact snapshot with refs', () => {
    const app = makeTodoApp(2)
    expect(app.see()).toBe([
      'route=/',
      'e1 app',
      ' e2 main',
      '  e3 h1 "Todos"',
      '  e4 form: e5 textbox "New todo" val="", e6 button "Add"',
      '  e7 list',
      '   e8 item "Task 1": e9 checkbox, e10 button "Delete"',
      '   e11 item "Task 2": e12 checkbox, e13 button "Delete"',
      '  e14 status "2 left"'
    ].join('\n'))
  })

  it('keeps refs stable and reports only changes in diff mode', async () => {
    const app = makeTodoApp(2)
    const full = app.see()
    const box = refFor(full, 'checkbox', 'Task 1')
    expect(app.see({ diff: true })).toBe('no changes')
    const diff = await app.act(box, 'click')
    expect(diff).toBe([
      '~ e8 item .done "Task 1"',
      `~ ${box} checkbox [checked]`,
      '~ e14 status "1 left"'
    ].join('\n'))
  })

  it('reports additions, removals, and moves', async () => {
    const app = makeTodoApp(2)
    app.see()
    const added = await app.invoke('add', 'Task 3')
    expect(added).toMatch(/^\+ e\d+ item "Task 3" in e7 after e11$/m)
    expect(added).toMatch(/^\+ e\d+ checkbox in e\d+$/m)
    const removed = await app.invoke('remove', 1)
    expect(removed).toMatch(/^- e8 item$/m)
    expect(removed).not.toMatch(/moved/)
  })

  it('pages long lists and collapses deep trees', () => {
    const app = makeTodoApp(30)
    const page0 = app.see({ pageSize: 10 })
    expect(page0).toContain('… 20 more (page=1)')
    expect(page0.match(/ item /g)).toHaveLength(10)
    const page2 = app.see({ pageSize: 10, page: 2 })
    expect(page2).toContain('"Task 21"')
    expect(page2).not.toContain('more (page')
    expect(app.see({ depth: 1 })).toMatch(/^ e2 main \(\+\d+\)$/m)
  })

  it('groups div-based rows so controls keep their label', async () => {
    const { createApp } = await import('../../core/app')
    const { defineComponent } = await import('../../core/component')
    const Rows = defineComponent({
      name: 'Rows',
      render: () => ({
        tag: 'div',
        children: [
          { tag: 'div', props: { class: 'row' }, children: [{ tag: 'span', children: ['milk'] }, { tag: 'button', props: { onClick: () => {} }, children: ['x'] }] },
          { tag: 'div', props: { class: 'footer' }, children: ['1 left'] }
        ]
      })
    })
    const app = createApp({ root: '#app', routes: [{ path: '/', component: Rows }] })
    app.mount()
    expect(app.see()).toBe('route=/\ne1 app\n e3 group .row "milk": e2 button "x"\n e4 text .footer "1 left"')
  })

  it('scopes to a ref and redacts passwords', () => {
    const app = makeTodoApp(1)
    const list = refFor(app.see(), 'list')
    expect(app.see({ ref: list }).split('\n')[1]).toBe('e7 list')
    const input = document.querySelector('input')!
    input.type = 'password'
    input.value = 'hunter2'
    expect(app.see()).toContain('val="***"')
    expect(app.see()).not.toContain('hunter2')
  })
})

describe('act', () => {
  it('fills, submits with Enter, and reports the result', async () => {
    const app = makeTodoApp(0)
    const snap = app.see()
    const input = refFor(snap, 'textbox')
    await app.act(input, 'fill', 'Buy milk')
    const diff = await app.act(input, 'press', 'Enter')
    expect(diff).toContain('"Buy milk"')
    expect(diff).toContain(`~ ${input} textbox "New todo" val=""`)
    expect((await app.assert({ state: '/todos/0/text', equals: 'Buy milk' })).pass).toBe(true)
  })

  it('gives repair hints for stale refs and bad input', async () => {
    const app = makeTodoApp(1)
    const snap = app.see()
    const del = refFor(snap, 'button', 'Delete')
    await app.act(del, 'click')
    await expect(app.act(del, 'click')).rejects.toThrow(/E_REF: e\d+ is unknown or no longer on the page; call see\(\)/)
    await expect(app.act(refFor(snap, 'h1'), 'fill', 'x')).rejects.toThrow(/E_ACT/)
  })
})

describe('invoke', () => {
  it('runs named actions and enforces confirmation', async () => {
    const app = makeTodoApp(2)
    app.see()
    await expect(app.invoke('nope')).rejects.toThrow('E_UNKNOWN_ACTION: "nope"; available: add, toggle, remove, clear')
    await expect(app.invoke('clear')).rejects.toThrow(/E_CONFIRM/)
    expect(app.getStore().todos).toHaveLength(2)
    await app.invoke('clear', undefined, { confirm: true })
    expect(app.getStore().todos).toHaveLength(0)
  })
})

describe('assert', () => {
  it('checks text, state, route, refs, and counts', async () => {
    const app = makeTodoApp(3)
    const snap = app.see()
    expect(await app.assert({ text: '3 left' })).toEqual({ pass: true })
    expect(await app.assert({ route: '/' })).toEqual({ pass: true })
    expect(await app.assert({ role: 'item', count: 3 })).toEqual({ pass: true })
    expect(await app.assert({ state: '/text', of: 'Page/TodoInput', equals: '' })).toEqual({ pass: true })
    expect(await app.assert({ ref: refFor(snap, 'checkbox', 'Task 2'), checked: false })).toEqual({ pass: true })
    expect(await app.assert({ text: 'Task 9', not: true })).toEqual({ pass: true })
  })

  it('explains failures without throwing', async () => {
    const app = makeTodoApp(1)
    expect(await app.assert({ state: '/todos/0/done', equals: true, timeout: 0 })).toEqual({ pass: false, detail: '/todos/0/done is false' })
    expect(await app.assert({ role: 'item', count: 5, timeout: 0 })).toEqual({ pass: false, detail: '1 item' })
    expect((await app.assert({ ref: 'e999', timeout: 0 })).detail).toMatch(/E_REF/)
    expect((await app.assert({ text: 'zzz', timeout: 0 })).detail).toBe('text not found; page: "Todos Add Task 1 Delete 1 left"')
  })

  it('waits for async changes', async () => {
    const app = makeTodoApp(0)
    setTimeout(() => app.dispatch('add', 'later'), 50)
    expect(await app.assert({ text: 'later', timeout: 500 })).toEqual({ pass: true })
  })
})

describe('manifest', () => {
  it('lists routes, documented actions, and mounted components', () => {
    const app = makeTodoApp(1)
    expect(app.manifest()).toEqual({
      route: '/',
      routes: ['/'],
      actions: { add: 'text:string · Add a todo', toggle: 'id:number', remove: 'id:number', clear: 'Delete all todos · confirm' },
      components: ['Page', 'TodoInput', 'TodoList']
    })
  })
})
