# Vio

An AI-agent-first frontend framework. Components are pure data structures. State is immutable. Everything is observable.

## Core Concepts

**JSON-to-DOM rendering** — Components return `{ tag, props, children }` trees. No templates, no JSX.

```ts
import { defineComponent } from 'vio'

const Greeting = defineComponent({
  name: 'Greeting',
  state: { name: 'World' },
  render(state) {
    return {
      tag: 'h1',
      children: [`Hello, ${state.name}!`]
    }
  }
})
```

**Immutable state** — State changes produce new objects. The virtual DOM diff determines what to update.

**Observable everything** — All mutations flow through an event bus. Serializable, loggable, replayable.

## Quick Start

```ts
import { createApp, defineComponent } from 'vio'

const App = defineComponent({
  name: 'App',
  state: { count: 0 },
  render(state) {
    return {
      tag: 'div',
      children: [
        { tag: 'h1', children: [`Count: ${state.count}`] },
        { tag: 'button', props: { onClick: () => {} }, children: ['Increment'] }
      ]
    }
  }
})

const app = createApp({
  root: '#app',
  routes: [{ path: '/', component: App }],
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
```

## Runtime API

AI agents can control a running Vio app programmatically:

```ts
// State management
app.setState(componentId, { count: 5 })
app.getState(componentId)

// Global store
app.dispatch('toggleTheme')
app.getStore()

// Navigation
app.navigate('/dashboard')

// Introspection
app.getComponentTree()

// Event observation
app.on('state:change', (event) => console.log(event))

// Batch operations
app.batch([
  { action: 'setState', target: id, payload: { count: 10 } },
  { action: 'dispatch', payload: { action: 'toggleTheme' } }
])
```

## Batteries Included

| Module | Import | Description |
|--------|--------|-------------|
| Store | `Store` | Global state with pure action reducers |
| Router | `Router` | Path matching, params, guards |
| HTTP | `HttpClient` | Fetch wrapper with interceptors |
| Forms | `createForm` | Form state, validation, node generation |

## Why AI-Agent-First?

1. **JSON-native** — `{ tag, props, children }`. Any LLM can produce valid component trees.
2. **Pure renders** — `render(state) → tree`. Same input, same output. Deterministic.
3. **Full introspection** — Agents can "see" the entire UI as JSON via `getComponentTree()`.
4. **Full control** — `setState`, `dispatch`, `navigate`, `batch` — all programmatic.
5. **Serializable** — Components, state, events are all plain JSON. Works over any transport.

## License

MIT
