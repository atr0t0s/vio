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

## Agent API

An agent can see, operate, and verify a running app without selectors or screenshots. `packages/vio/AGENTS.md` is the full contract in about 500 tokens.

```ts
app.manifest()
// { route: '/', routes: ['/'], actions: { add: 'text:string · Add a todo', clear: 'confirm' }, components: [...] }

app.see()
// route=/
// e1 app
//  e2 main
//   e4 form: e5 textbox "New todo" val="", e6 button "Add"
//   e7 list
//    e8 item "Buy milk": e9 checkbox, e10 button "Delete"

await app.act('e9', 'click')           // returns a diff:
// ~ e8 item .done "Buy milk"
// ~ e9 checkbox [checked]

await app.invoke('add', 'Eggs')        // named store action → diff; actions with meta.confirm need { confirm: true }
await app.assert({ text: '1 left' })  // waits up to 1s → { pass: true } or { pass: false, detail }
app.see({ diff: true })                // only what changed since the last snapshot
```

Refs stay stable while the element exists. Long lists page (`page`, `pageSize`), deep trees collapse (`depth`), `ref` scopes to a subtree, and password fields are redacted. Token budgets for the snapshot, diffs, manifest, `AGENTS.md`, and MCP tool definitions are enforced in tests.

Describe store actions for agents with `meta`:

```ts
store: {
  state: { todos: [] },
  actions: { add: (s, text) => ({ ...s, todos: [...s.todos, text] }), clear: (s) => ({ ...s, todos: [] }) },
  meta: { add: { params: 'text:string', doc: 'Add a todo' }, clear: { confirm: true } }
}
```

## Runtime API

Lower-level control of a running app:

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

// Batch: validates every op first, applies them with a single render, rolls back state if one throws
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
| `vio_manifest` | Routes, store actions, mounted components |
| `vio_see` | Text snapshot with refs; `diff`, `ref`, `depth`, `page` |
| `vio_act` | click / fill / check / select / press / … by ref; returns a diff |
| `vio_invoke` | Run a store action by name; returns a diff |
| `vio_assert` | Wait for text / route / state / ref / count conditions |
| `vio_state` | Read store or component state by JSON Pointer; patch component state |
| `vio_nav` | Navigate; returns a diff |
| `vio_debug` | Component tree, recent events, or errors |

## Why AI-Agent-First?

1. **JSON-native** — `{ tag, props, children }`. Any LLM can produce valid component trees.
2. **Pure renders** — `render(state, ctx) → tree`. Same input, same output. Deterministic.
3. **Full introspection** — Agents can see every mounted component, its state, and props via `getComponentTree()`.
4. **Full control** — `see`, `act`, `invoke`, `assert`, plus `setState`, `dispatch`, `navigate`, `batch`.
5. **Serializable output** — Trees, state, and events are plain data (functions are dropped from introspection). Works over any transport.
6. **MCP-ready** — Connect `@atrotos/vio-devtools` and any MCP client can control your app live.

## License

MIT
