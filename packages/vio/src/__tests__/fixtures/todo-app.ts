import { createApp } from '../../core/app'
import { defineComponent } from '../../core/component'

export interface Todo { id: number; text: string; done: boolean }

const TodoInput = defineComponent({
  name: 'TodoInput',
  state: { text: '' },
  render: (s, ctx) => ({
    tag: 'form',
    props: { onSubmit: (e: Event) => { e.preventDefault(); ctx.dispatch('add', s.text); ctx.setState({ text: '' }) } },
    children: [
      { tag: 'input', props: { placeholder: 'New todo', value: s.text, onInput: (e: Event) => ctx.setState({ text: (e.target as HTMLInputElement).value }) } },
      { tag: 'button', props: { type: 'submit' }, children: ['Add'] }
    ]
  })
})

const TodoList = defineComponent({
  name: 'TodoList',
  render: (_s, ctx) => {
    const todos = ctx.store.todos as Todo[]
    return {
      tag: 'ul',
      children: todos.map(t => ({
        tag: 'li',
        key: t.id,
        props: { class: t.done ? 'done' : '' },
        children: [
          { tag: 'input', props: { type: 'checkbox', checked: t.done, 'aria-label': t.text, onChange: () => ctx.dispatch('toggle', t.id) } },
          { tag: 'span', children: [t.text] },
          { tag: 'button', props: { onClick: () => ctx.dispatch('remove', t.id) }, children: ['Delete'] }
        ]
      }))
    }
  }
})

const Page = defineComponent({
  name: 'Page',
  render: (_s, ctx) => {
    const todos = ctx.store.todos as Todo[]
    return {
      tag: 'main',
      children: [
        { tag: 'h1', children: ['Todos'] },
        { tag: TodoInput },
        { tag: TodoList },
        { tag: 'p', props: { role: 'status' }, children: [`${todos.filter(t => !t.done).length} left`] }
      ]
    }
  }
})

export function makeTodoApp(count = 3) {
  const todos: Todo[] = Array.from({ length: count }, (_, i) => ({ id: i + 1, text: `Task ${i + 1}`, done: false }))
  let nextId = count + 1
  const app = createApp({
    root: '#app',
    routes: [{ path: '/', component: Page }],
    store: {
      state: { todos },
      actions: {
        add: (s, text) => ({ ...s, todos: [...(s.todos as Todo[]), { id: nextId++, text: text as string, done: false }] }),
        toggle: (s, id) => ({ ...s, todos: (s.todos as Todo[]).map(t => t.id === id ? { ...t, done: !t.done } : t) }),
        remove: (s, id) => ({ ...s, todos: (s.todos as Todo[]).filter(t => t.id !== id) }),
        clear: (s) => ({ ...s, todos: [] })
      },
      meta: {
        add: { params: 'text:string', doc: 'Add a todo' },
        toggle: { params: 'id:number' },
        remove: { params: 'id:number' },
        clear: { doc: 'Delete all todos', confirm: true }
      }
    }
  })
  app.mount()
  return app
}

export function resetDom(): void {
  window.location.hash = ''
  document.body.innerHTML = '<div id="app"></div>'
}
