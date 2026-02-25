import { createApp, defineComponent } from 'vio'

// --- Components ---

const Nav = defineComponent({
  name: 'Nav',
  render() {
    return {
      tag: 'nav',
      children: [
        { tag: 'a', props: { href: '#/' }, children: ['Home'] },
        { tag: 'a', props: { href: '#/counter' }, children: ['Counter'] },
        { tag: 'a', props: { href: '#/todos' }, children: ['Todos'] }
      ]
    }
  }
})

const Home = defineComponent({
  name: 'Home',
  render() {
    return {
      tag: 'div',
      children: [
        { tag: Nav, props: {}, children: [] },
        { tag: 'h1', children: ['Vio v2'] },
        { tag: 'p', children: ['An AI-agent-first frontend framework.'] },
        { tag: 'p', children: ['Components are pure JSON. No templates. No JSX.'] },
        {
          tag: 'pre',
          children: [
            JSON.stringify(
              { tag: 'div', props: { class: 'example' }, children: ['Hello World'] },
              null,
              2
            )
          ]
        }
      ]
    }
  }
})

const Counter = defineComponent({
  name: 'Counter',
  state: { count: 0 },
  render(state) {
    return {
      tag: 'div',
      children: [
        { tag: Nav, props: {}, children: [] },
        { tag: 'h1', children: ['Counter'] },
        {
          tag: 'div',
          props: { class: 'counter' },
          children: [
            { tag: 'h2', children: [`Count: ${state.count}`] },
            { tag: 'p', children: ['This counter demonstrates state management.'] }
          ]
        }
      ]
    }
  }
})

const Todos = defineComponent({
  name: 'Todos',
  state: {
    items: [
      { text: 'Learn Vio', done: true },
      { text: 'Build something', done: false },
      { text: 'Ship it', done: false }
    ] as Array<{ text: string; done: boolean }>
  },
  render(state) {
    const items = state.items as Array<{ text: string; done: boolean }>
    return {
      tag: 'div',
      children: [
        { tag: Nav, props: {}, children: [] },
        { tag: 'h1', children: ['Todos'] },
        ...items.map((item, i) => ({
          tag: 'div',
          props: { class: `todo-item${item.done ? ' done' : ''}` },
          children: [
            { tag: 'span', children: [item.done ? '[x]' : '[ ]'] },
            { tag: 'span', children: [item.text] }
          ]
        }))
      ]
    }
  }
})

// --- App ---

const app = createApp({
  root: '#app',
  routes: [
    { path: '/', component: Home },
    { path: '/counter', component: Counter },
    { path: '/todos', component: Todos }
  ],
  store: {
    state: { theme: 'light' },
    actions: {
      toggleTheme(s) {
        return { ...s, theme: s.theme === 'light' ? 'dark' : 'light' }
      }
    }
  }
})

app.mount()

// Expose app to window for AI agent runtime control
;(window as any).vio = app
