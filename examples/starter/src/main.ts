import { createApp, defineComponent } from '@atrotos/vio'
import type { VioApp } from '@atrotos/vio'
import { connectDevtools } from '@atrotos/vio-devtools/client'

// --- Helpers ---

function getApp(): VioApp {
  return (window as any).vio as VioApp
}

function currentFilter(): string {
  const hash = window.location.hash
  if (hash === '#/active') return 'active'
  if (hash === '#/completed') return 'completed'
  return 'all'
}

// --- Types ---

interface Todo {
  id: number
  text: string
  completed: boolean
}

// --- ID generator ---

let nextId = Date.now()

// --- Components ---

const TodoInput = defineComponent({
  name: 'TodoInput',
  render() {
    return {
      tag: 'div',
      props: { class: 'input-row' },
      children: [
        {
          tag: 'input',
          props: {
            type: 'text',
            placeholder: 'What needs to be done?',
            // Workaround: Vio doesn't have controlled inputs yet, so we
            // read the DOM value directly on submit instead of tracking state.
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                const input = e.target as HTMLInputElement
                const value = input.value.trim()
                if (value) {
                  getApp().dispatch('addTodo', value)
                  input.value = ''
                }
              }
            }
          },
          children: []
        },
        {
          tag: 'button',
          props: {
            onclick: () => {
              // Read DOM value directly since Vio lacks controlled inputs
              const input = document.querySelector('.input-row input') as HTMLInputElement
              if (!input) return
              const value = input.value.trim()
              if (value) {
                getApp().dispatch('addTodo', value)
                input.value = ''
              }
            }
          },
          children: ['Add']
        }
      ]
    }
  }
})

const Nav = defineComponent({
  name: 'Nav',
  render() {
    const current = currentFilter()

    return {
      tag: 'nav',
      children: [
        {
          tag: 'a',
          props: {
            href: '#/',
            class: current === 'all' ? 'active' : ''
          },
          children: ['All']
        },
        {
          tag: 'a',
          props: {
            href: '#/active',
            class: current === 'active' ? 'active' : ''
          },
          children: ['Active']
        },
        {
          tag: 'a',
          props: {
            href: '#/completed',
            class: current === 'completed' ? 'active' : ''
          },
          children: ['Completed']
        }
      ]
    }
  }
})

const TodoList = defineComponent({
  name: 'TodoList',
  render() {
    const store = getApp().getStore()
    const todos = (store.todos || []) as Todo[]
    const filter = (store.filter || 'all') as string

    const filtered = todos.filter((t) => {
      if (filter === 'active') return !t.completed
      if (filter === 'completed') return t.completed
      return true
    })

    const itemsLeft = todos.filter((t) => !t.completed).length

    if (filtered.length === 0) {
      return {
        tag: 'div',
        props: { class: 'todo-list' },
        children: [
          {
            tag: 'div',
            props: { class: 'empty' },
            children: [
              filter === 'all'
                ? 'No todos yet. Add one above!'
                : filter === 'active'
                  ? 'No active todos.'
                  : 'No completed todos.'
            ]
          }
        ]
      }
    }

    return {
      tag: 'div',
      props: { class: 'todo-list' },
      children: [
        ...filtered.map((todo) => ({
          tag: 'div',
          props: { class: 'todo-item' },
          children: [
            {
              tag: 'button',
              props: {
                class: `toggle${todo.completed ? ' done' : ''}`,
                onclick: () => {
                  getApp().dispatch('toggleTodo', todo.id)
                }
              },
              children: [todo.completed ? '\u2713' : '']
            },
            {
              tag: 'span',
              props: {
                class: `text${todo.completed ? ' done' : ''}`
              },
              children: [todo.text]
            },
            {
              tag: 'button',
              props: {
                class: 'delete',
                onclick: () => {
                  getApp().dispatch('deleteTodo', todo.id)
                }
              },
              children: ['\u00d7']
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
        { tag: TodoInput, props: {}, children: [] },
        { tag: Nav, props: {}, children: [] },
        { tag: TodoList, props: {}, children: [] }
      ]
    }
  },
  onMount(ctx) {
    // Load todos from localStorage
    try {
      const saved = localStorage.getItem('vio-todos')
      if (saved) {
        const todos = JSON.parse(saved) as Todo[]
        ;getApp().dispatch('loadTodos', todos)
        // Update nextId to avoid collisions
        const maxId = todos.reduce((max, t) => Math.max(max, t.id), 0)
        if (maxId >= nextId) nextId = maxId + 1
      }
    } catch {
      // ignore parse errors
    }

    // Set initial filter from hash
    getApp().dispatch('setFilter', currentFilter())

    // Persist todos to localStorage on store changes
    const unsubscribe = getApp().on('store:change', () => {
      const store = getApp().getStore()
      localStorage.setItem('vio-todos', JSON.stringify(store.todos))
    })

    // Listen for hashchange to update the filter
    const onHashChange = () => {
      getApp().dispatch('setFilter', currentFilter())
    }
    window.addEventListener('hashchange', onHashChange)

    // Return cleanup
    return () => {
      unsubscribe()
      window.removeEventListener('hashchange', onHashChange)
    }
  }
})

// --- App ---

const app = createApp({
  root: '#app',
  routes: [
    { path: '/', component: AppRoot },
    { path: '/active', component: AppRoot },
    { path: '/completed', component: AppRoot }
  ],
  store: {
    state: {
      todos: [] as Todo[],
      filter: 'all' as 'all' | 'active' | 'completed'
    },
    actions: {
      addTodo(state, payload) {
        const text = payload as string
        const todos = [...(state.todos as Todo[]), { id: nextId++, text, completed: false }]
        return { ...state, todos }
      },
      toggleTodo(state, payload) {
        const id = payload as number
        const todos = (state.todos as Todo[]).map((t) =>
          t.id === id ? { ...t, completed: !t.completed } : t
        )
        return { ...state, todos }
      },
      deleteTodo(state, payload) {
        const id = payload as number
        const todos = (state.todos as Todo[]).filter((t) => t.id !== id)
        return { ...state, todos }
      },
      setFilter(state, payload) {
        return { ...state, filter: payload as string }
      },
      loadTodos(state, payload) {
        return { ...state, todos: payload as Todo[] }
      }
    }
  }
})

// Expose app to window BEFORE mounting so onMount can dispatch
;(window as any).vio = app

app.mount()

// Connect to DevTools MCP server (if running)
connectDevtools(app)
