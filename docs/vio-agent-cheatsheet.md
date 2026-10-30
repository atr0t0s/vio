# Vio (v3) cheat sheet

`c(name, init, (s, x) => node)`: `s` state, `x` ctx.
Node: `['tag.class#id', props?, ...children]` or `html`; strings are text.
Ctx: `x.props`, `x.set(patch)`, `x.dispatch(name, payload)`, `x.store`, `x.route.params`, `x.ref`, `x.slot`, `x.signal`.
Lists: `key` in props; `false|null|''` skipped.
Store: `defineStore({ state, getters, actions: { a(s,p) => newState } })`.
Router: `r('/u/:id', Page, { loader, guard, children })`; guard → `true|redirect(path)`.
Data: `res({ key, load: ({signal}) => json(url) })` → `.data .loading .empty .error`.
Catalog: `defineCatalog({ components, actions })`; actions: `params`, `scope`.
Agent: `app.manifest()`, `app.see({depth,ref,diff})` → `[ref=e12]`, `app.act('e12','click')`, `app.invoke('todo.add',{text})`, `app.assert({text:'7 left'})`.
CLI: `vio check | vio see --diff | vio act e12 click | vio assert text "7 left"`.
Rules: pure render, key lists, named actions, no raw HTML in specs.
