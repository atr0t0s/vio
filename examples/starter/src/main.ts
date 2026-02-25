import { createApp, defineComponent } from 'vio'

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
            value: (window as any).__vioInputValue || '',
            oninput: (e: Event) => {
              (window as any).__vioInputValue = (e.target as HTMLInputElement).value
            },
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                const value = ((window as any).__vioInputValue || '').trim()
                if (value) {
                  (window as any).vio.dispatch('addTodo', value);
                  (window as any).__vioInputValue = '';
                  (e.target as HTMLInputElement).value = ''
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
              const value = ((window as any).__vioInputValue || '').trim()
              if (value) {
                (window as any).vio.dispatch('addTodo', value);
                (window as any).__vioInputValue = ''
                const input = document.querySelector('.input-row input') as HTMLInputElement
                if (input) input.value = ''
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
    const hash = window.location.hash
    const current =
      hash === '#/active' ? 'active'
        : hash === '#/completed' ? 'completed'
          : 'all'

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
    const store = (window as any).vio.getStore()
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
                  (window as any).vio.dispatch('toggleTodo', todo.id)
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
                  (window as any).vio.dispatch('deleteTodo', todo.id)
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
        ;(window as any).vio.dispatch('loadTodos', todos)
        // Update nextId to avoid collisions
        const maxId = todos.reduce((max, t) => Math.max(max, t.id), 0)
        if (maxId >= nextId) nextId = maxId + 1
      }
    } catch {
      // ignore parse errors
    }

    // Set initial filter from hash
    const hash = window.location.hash
    const filter =
      hash === '#/active' ? 'active'
        : hash === '#/completed' ? 'completed'
          : 'all'
    ;(window as any).vio.dispatch('setFilter', filter)

    // Persist todos to localStorage on store changes
    const unsubscribe = (window as any).vio.on('store:change', () => {
      const store = (window as any).vio.getStore()
      localStorage.setItem('vio-todos', JSON.stringify(store.todos))
    })

    // Listen for hashchange to update the filter
    const onHashChange = () => {
      const h = window.location.hash
      const f =
        h === '#/active' ? 'active'
          : h === '#/completed' ? 'completed'
            : 'all'
      ;(window as any).vio.dispatch('setFilter', f)
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
