# Vio

An AI-agent-first frontend framework. Components are pure data structures. State is immutable. Everything is observable.

## Core Concepts

**JSON-to-DOM rendering** — Components return `{ tag, props, children }` trees. No templates, no JSX.

```ts
import { defineComponent } from '@atrotos/vio'

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

**Immutable state** — State changes produce new objects. Keyed reconciliation determines what to update.

**Observable everything** — All mutations flow through an event bus. Serializable, loggable, replayable.

## Quick Start

```ts
import { createApp, defineComponent } from '@atrotos/vio'

const App = defineComponent({
  name: 'App',
  state: { count: 0 },
  render(state, ctx) {
    return {
      tag: 'div',
      children: [
        { tag: 'h1', children: [`Count: ${state.count}`] },
        { tag: 'button', props: { onClick: () => ctx.setState({ count: (state.count as number) + 1 }) }, children: ['Increment'] }
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

## Components

`render(state, ctx)` returns a descriptor (or `null`). Nest components with `{ tag: Child, props, key }`; every nested component is a real instance with its own state and lifecycle.

| `ctx` field | Purpose |
|---|---|
| `props` | Props from the parent; route components get `{ params, query }` |
| `setState(patch)` / `getState()` | Local state |
| `store` / `dispatch(action, payload)` | Global store snapshot and actions |
| `route` | `{ path, params, query }` |
| `getRef(name)` | Element tagged with `props: { ref: 'name' }` |
| `emit(event, payload)` | Event bus |

Props: `class` takes a string, array, or `{ name: bool }`; `style` takes a string or object; `value`/`checked` are controlled; `on*` takes functions; give list items a `key`. SVG works.

**Safe by default:** `<script>`, `<base>`, `<meta>`, `<object>`, `<embed>`, `innerHTML`, `srcdoc`, string `on*` handlers, and `javascript:` URLs are dropped and reported as `security:blocked` events.

**Routes:** guards return `true`, `false`, or a redirect path, and run even without a store. Unknown paths render nothing and emit `route:notfound`. Navigating between paths served by the same component keeps its state.

## Runtime API

AI agents can control a running Vio app programmatically:

```ts
// State management
app.setState(componentId, { count: 5 })
app.getState(componentId)

// Global store
app.dispatch('toggleTheme')
app.getStore()

// Navigation (returns false when no route matches)
app.navigate('/dashboard')
app.getRoute()

// Introspection: nested tree with stable path IDs like "App/TodoList/Item[3]"
app.getComponentTree()

// Event observation
app.on('state:change', (event) => console.log(event))

// Batch: validates every op first, then applies them with a single render
app.batch([
  { action: 'setState', target: id, payload: { count: 10 } },
  { action: 'dispatch', payload: { action: 'toggleTheme' } }
])

// Teardown
app.destroy()
```

## Batteries Included

| Module | Import | Description |
|--------|--------|-------------|
| Store | `Store` | Global state with pure action reducers |
| Router | `Router` | Path matching, params, guards |
| HTTP | `HttpClient` | Fetch wrapper with interceptors |
| Forms | `createForm` | Form state, validation, node generation |

## Devtools (MCP)

`@atrotos/vio-devtools` is a companion package that exposes a running Vio app to AI agents via the [Model Context Protocol](https://modelcontextprotocol.io). An MCP-capable client (Claude Code, Cursor, etc.) can read state, dispatch actions, navigate routes, and inspect the component tree — all from the terminal.

**Architecture:** MCP Server (stdio) ↔ WebSocket Bridge ↔ Browser Client

### Setup

1. **Browser side** — connect the devtools client in your app entry:

```ts
import { connectDevtools } from '@atrotos/vio-devtools/client'

const app = createApp({ /* ... */ })
app.mount()
connectDevtools(app)
```

2. **MCP config** — add to your `.mcp.json` (or Claude Code settings):

```json
{
  "mcpServers": {
    "vio-devtools": {
      "command": "node",
      "args": ["./packages/vio-devtools/dist/cli.js"]
    }
  }
}
```

3. **Build** — `npm run build` from the workspace root.

**Security:** the bridge binds to `127.0.0.1` only and rejects browser connections from non-localhost origins (add more with `VIO_DEVTOOLS_ORIGINS=https://a,https://b`). Set `VIO_DEVTOOLS_TOKEN` on the server and pass the same value as `connectDevtools(app, { token })` to require a token.

### Available Tools

| Tool | Description |
|------|-------------|
| `vio_get_state` | Get component local state by instance ID |
| `vio_set_state` | Merge partial state into a component |
| `vio_get_store` | Read global store state |
| `vio_dispatch` | Dispatch a store action |
| `vio_navigate` | Navigate to a route |
| `vio_get_component_tree` | Full component tree with IDs and state |
| `vio_get_registered_components` | List all registered component names |
| `vio_remove_component` | Unmount a component by instance ID |
| `vio_batch` | Validate, then apply several operations with one render |
| `vio_emit` | Emit an event on the event bus |
| `vio_get_event_history` | Get recent event bus history |

## Why AI-Agent-First?

1. **JSON-native** — `{ tag, props, children }`. Any LLM can produce valid component trees.
2. **Pure renders** — `render(state) → tree`. Same input, same output. Deterministic.
3. **Full introspection** — Agents can see every mounted component, its state, and props via `getComponentTree()`.
4. **Full control** — `setState`, `dispatch`, `navigate`, `batch` — all programmatic.
5. **Serializable output** — Trees, state, and events are plain data (functions are dropped from introspection). Works over any transport.
6. **MCP-ready** — Connect `@atrotos/vio-devtools` and any MCP client can control your app live.

## License

MIT
