import { createApp, defineComponent } from 'vio'
import { connectDevtools } from 'vio-devtools/client'

// --- Types ---

interface Todo {
  id: number
  text: string
  completed: boolean
}

type Filter = 'all' | 'active' | 'completed'

function filterFromPath(path: string): Filter {
  if (path === '/active') return 'active'
  if (path === '/completed') return 'completed'
  return 'all'
}

// --- ID generator ---

let nextId = Date.now()

// --- Components ---

const TodoInput = defineComponent({
  name: 'TodoInput',
  state: { text: '' },
  render(state, ctx) {
    const submit = () => {
      const value = (state.text as string).trim()
      if (!value) return
      ctx.dispatch('addTodo', value)
      ctx.setState({ text: '' })
    }
    return {
      tag: 'div',
      props: { class: 'input-row' },
      children: [
        {
          tag: 'input',
          props: {
            type: 'text',
            placeholder: 'What needs to be done?',
            value: state.text,
            onInput: (e: Event) => ctx.setState({ text: (e.target as HTMLInputElement).value }),
            onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') submit() }
          }
        },
        { tag: 'button', props: { onClick: submit }, children: ['Add'] }
      ]
    }
  }
})

const Nav = defineComponent({
  name: 'Nav',
  render(_state, ctx) {
    const current = filterFromPath(ctx.route.path)
    const link = (filter: Filter, href: string, label: string) => ({
      tag: 'a',
      key: filter,
      props: { href, class: { active: current === filter } },
      children: [label]
    })
    return {
      tag: 'nav',
      children: [link('all', '#/', 'All'), link('active', '#/active', 'Active'), link('completed', '#/completed', 'Completed')]
    }
  }
})

const TodoList = defineComponent({
  name: 'TodoList',
  render(_state, ctx) {
    const todos = (ctx.store.todos ?? []) as Todo[]
    const filter = filterFromPath(ctx.route.path)

    const filtered = todos.filter((t) => {
      if (filter === 'active') return !t.completed
      if (filter === 'completed') return t.completed
      return true
    })

    const itemsLeft = todos.filter((t) => !t.completed).length

    if (filtered.length === 0) {
      const empty = { all: 'No todos yet. Add one above!', active: 'No active todos.', completed: 'No completed todos.' }
      return {
        tag: 'div',
        props: { class: 'todo-list' },
        children: [{ tag: 'div', props: { class: 'empty' }, children: [empty[filter]] }]
      }
    }

    return {
      tag: 'div',
      props: { class: 'todo-list' },
      children: [
        filtered.map((todo) => ({
          tag: 'div',
          key: todo.id,
          props: { class: 'todo-item' },
          children: [
            {
              tag: 'button',
              props: { class: { toggle: true, done: todo.completed }, onClick: () => ctx.dispatch('toggleTodo', todo.id) },
              children: [todo.completed ? '✓' : '']
            },
            { tag: 'span', props: { class: { text: true, done: todo.completed } }, children: [todo.text] },
            {
              tag: 'button',
              props: { class: 'delete', onClick: () => ctx.dispatch('deleteTodo', todo.id) },
              children: ['×']
            }
          ]
        })),
        {
          tag: 'div',
          props: { class: 'footer' },
          children: [`${itemsLeft} item${itemsLeft !== 1 ? 's' : ''} left`]
        }
      ]
    }
  }
})

const AppRoot = defineComponent({
  name: 'AppRoot',
  render() {
    return {
      tag: 'div',
      props: { class: 'app' },
      children: [
        { tag: 'h1', children: ['todos'] },
        { tag: TodoInput },
        { tag: Nav },
        { tag: TodoList }
      ]
    }
  }
})

// --- App ---

function loadTodos(): Todo[] {
  try {
    const todos = JSON.parse(localStorage.getItem('vio-todos') ?? '[]') as Todo[]
    const maxId = todos.reduce((max, t) => Math.max(max, t.id), 0)
    if (maxId >= nextId) nextId = maxId + 1
    return todos
  } catch {
    return []
  }
}

const app = createApp({
  root: '#app',
  routes: [
    { path: '/', component: AppRoot },
    { path: '/active', component: AppRoot },
    { path: '/completed', component: AppRoot }
  ],
  store: {
    state: { todos: loadTodos() },
    actions: {
      addTodo(state, payload) {
        const todos = [...(state.todos as Todo[]), { id: nextId++, text: payload as string, completed: false }]
        return { ...state, todos }
      },
      toggleTodo(state, payload) {
        const todos = (state.todos as Todo[]).map((t) => (t.id === payload ? { ...t, completed: !t.completed } : t))
        return { ...state, todos }
      },
      deleteTodo(state, payload) {
        return { ...state, todos: (state.todos as Todo[]).filter((t) => t.id !== payload) }
      }
    }
  }
})

app.on('store:change', () => {
  localStorage.setItem('vio-todos', JSON.stringify(app.getStore().todos))
})

// Handy for poking at the app from the browser console.
;(window as any).vio = app

app.mount()

// Connect to DevTools MCP server (if running)
connectDevtools(app)
