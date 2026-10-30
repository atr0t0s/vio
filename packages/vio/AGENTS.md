# Vio for agents

Node: `{ tag, props?, children?, key? }`; tag is an HTML tag or component. Children: strings, numbers, nodes, arrays; `null|false|''` skipped.
Component: `defineComponent({ name, state, render(s, ctx), onMount, onUpdate, onUnmount, onError })`. `render` is pure; may return `null`.
ctx: `props`, `setState(patch)`, `getState()`, `store`, `dispatch(name, payload)`, `route {path,params,query}`, `getRef(name)`, `emit`.
Props: `class` string|array|{name:bool}; `style` string|object; `value`/`checked` controlled; `on<Event>` functions; `ref: 'name'`. Key every list item.
Store: `{ state, actions: { name(s, p) => newState }, meta: { name: { params, doc, confirm } } }`. State is frozen: return new objects.
Routes: `{ path: '/u/:id', component, guard: s => true|false|'/redirect' }`. Hash routing. Same component across routes keeps state.
`onError(err, ctx)` returns fallback UI for its subtree. Blocked: script/base/meta/object/embed, innerHTML, srcdoc, string handlers, javascript: URLs.

Operate a running app (or via vio-devtools MCP tools of the same names):
- `app.manifest()` routes, actions, components, docs.
- `app.see({ diff, ref, depth, page })` one line per element like `e5 button "Add"` (leaf children after `:`); refs are stable.
- `await app.act('e5', 'click'|'fill'|'check'|'select'|'press'|…, value)` returns a diff. Any ref may be a query: `button:Add`, `button.x`, `group:Eggs>button`.
- `await app.invoke('add', payload, { confirm })` runs a store action, returns a diff; prefer it to clicking.
- `await app.assert({ text | route | state:'/ptr', equals | ref, checked | role, count, not, timeout })` returns `{ pass, detail }`.
- `app.batch([...])` validates, applies with one render, and rolls back state on failure.
Generated UI: a spec view (`@atrotos/vio/spec`) puts its catalog and grammar in `manifest().docs`; edit with `patchState(id, jsonPatch)`.
Shell: `vio serve`, then `vio see|act|invoke|assert|run …` (exit 2: assert failed).
Errors start with a code (`E_REF`, `E_CONFIRM`, `E_RENDER Page/List: …`) and say how to fix.
