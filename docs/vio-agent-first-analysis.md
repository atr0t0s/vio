# Vio: agent-first framework audit and v3 proposal

**Date:** 2026-10-30  
**Scope:** `packages/vio`, `packages/vio-devtools`, the starter example, tests, build output.  
**Method:** source read, full test/build run, jsdom probes against the real runtime, token measurements, and a review of current agent-UI standards (A2UI, json-render, MCP Apps, WebMCP, AG-UI, Playwright MCP).

---

## Bottom line

Vio's core thesis is good and still rare: **a tiny, build-free, deterministic UI runtime whose entire state and UI can be inspected and driven by an agent**. Keep it.

But the current code is a promising prototype, not yet a framework. It has no real component instance tree, no props/slots/context, no keyed reconciliation, no SSR, no data or form layer, no sanitization, and its agent introspection returns a tree with no children. Its own starter app works around the two most basic omissions:

- controlled inputs: *"Vio doesn't have controlled inputs yet, so we read the DOM value directly"* ([main.ts:44](../examples/starter/src/main.ts#L44))
- route params: the app listens to `hashchange` and dispatches `setFilter` itself because the matched route never reaches the component ([main.ts:237](../examples/starter/src/main.ts#L237))

And measured against the frameworks it wants to beat, current Vio is **more verbose**, not less:

| Equivalent snippet | React 19 | Vue 3.5+ | Svelte 5 | Vio v2 | Vio v3 proposal |
|---|---:|---:|---:|---:|---:|
| Counter component (tokens, o200k) | 63 | 47 | 32 | **125** | **45** (terse) / 54 (HTML) |
| Filtered todo list (tokens) | 179 | 179 | 172 | **287**\* | **170** |

\* The Vio v2 list snippet is not functionally equivalent: it cannot receive props or update local state, so it reaches through `window.vio` to the global store. It is longer *and* less capable.

The opportunity is not to out-feature React, Vue, and Svelte on breadth. That is not realistic. The opportunity is to be:

1. **better on the agent contract** (observe, act, assert, replay, permissions, token budget),
2. **at parity on the subset agent-built apps actually need** (routing, data, forms, auth, SSR, tables, errors, a11y),
3. **the interop host** that can render React/Vue/Svelte islands instead of rebuilding their ecosystems,
4. **multi-surface** (web, SSR HTML, email, Markdown, terminal) because agents produce more than browser pages.

The rest of this document is the evidence, the design shifts, and a phased plan.

---

## Contents

1. [What exists today](#1-what-exists-today)
2. [Claims vs reality](#2-claims-vs-reality)
3. [Verified defects](#3-verified-defects)
4. [Comparison with React, Vue, Svelte](#4-comparison-with-react-vue-svelte)
5. [What agent-first UI looks like in 2026](#5-what-agent-first-ui-looks-like-in-2026)
6. [Vio v3 architecture](#6-vio-v3-architecture)
7. [Token economy](#7-token-economy)
8. [Completeness and real-world relevance](#8-completeness-and-real-world-relevance)
9. [Robustness engineering](#9-robustness-engineering)
10. [Roadmap](#10-roadmap)
11. [Migration](#11-migration)
12. [File-by-file actions](#12-file-by-file-actions)
13. [References](#13-references)

---

## 1. What exists today

### 1.1 Baseline

| Metric | Value |
|---|---|
| Runtime source (non-test) | **1,186 LOC**, ~**8,278 tokens** |
| Public type surface (`dist/index.d.ts`) | ~**1,938 tokens** |
| README | ~**1,119 tokens** |
| Tests | **99 passing** (80 core + 19 devtools), `tsc --noEmit` clean |
| Build | **18.41 kB** ES / **5.22 kB gzip**; 13.21 kB CJS / 4.54 kB gzip |
| Runtime dependencies | **zero** |
| Build required to run | **no** (ESM, plain TS/JS) |
| Devtools | MCP server over stdio, WS bridge, 11 tools |

The size and the zero-dependency, no-build story are real advantages for coding agents. The whole framework API fits in fewer tokens than a single React component file.

### 1.2 Runtime shape

```
createApp(config)
  ├─ EventBus (history, wildcard)
  ├─ Store (state + pure action map)
  ├─ Router (hash only, flat routes)
  └─ Renderer
       ├─ mount(ComponentDef) → one root instance
       ├─ renderTree(def, state) → resolve component tags inline
       ├─ createElementRecursive(tree) → DOM
       └─ setState → diff(oldTree,newTree) → patch(DOM)
```

Key structural facts:

- Only the **root** component gets an `ComponentInstance`, lifecycle hooks, and local state. Nested components are inlined during `resolveTree` and never instantiated ([renderer.ts:124-147](../packages/vio/src/core/renderer.ts#L124-L147)).
- There are **three different prop appliers**: `node.ts`, `renderer.createElementRecursive`, and `diff.patch`. They already disagree (styles, properties, events) ([node.ts:10-24](../packages/vio/src/core/node.ts#L10-L24), [renderer.ts:155-169](../packages/vio/src/core/renderer.ts#L155-L169), [diff.ts:113-137](../packages/vio/src/core/diff.ts#L113-L137)).
- `render(state, store?)` advertises a store argument that is **never passed** ([types.ts:1](../packages/vio/src/core/types.ts#L1), [renderer.ts:120](../packages/vio/src/core/renderer.ts#L120)).
- `render(state)` has **no context**: no props, no `setState`, no route, no refs, no slots. Local state is read-only from inside a component.
- `getComponentTree()` returns the root and `children: []` unconditionally ([app.ts:130-140](../packages/vio/src/core/app.ts#L130-L140)).
- The router matches `:params` but never provides them to the component ([router.ts:69-89](../packages/vio/src/router/router.ts#L69-L89)).
- `key` exists on the descriptor type but is ignored by the diff ([types.ts:7](../packages/vio/src/core/types.ts#L7), [diff.ts:54-95](../packages/vio/src/core/diff.ts#L54-L95)).

### 1.3 What is genuinely good and should survive

| Asset | Why it matters |
|---|---|
| **Tiny API** | 1.9k tokens of types; an agent can learn the whole framework in one context window. |
| **No build step** | Agents can write one file and open it. No JSX/SFC compiler, no plugin config, no HMR dependency. |
| **Pure `render(state)`** | Deterministic UI from data; easy to snapshot, replay, and test. |
| **JSON-ish descriptors** | Machine-readable and serializable in principle (once handlers are separated). |
| **Event bus with history** | A foundation for observability and replay (needs sequencing and safety). |
| **Single app control surface** | `setState`/`dispatch`/`navigate`/`batch` is the right instinct; the semantics need fixing. |
| **MCP devtools** | Correct direction; the tool design and payloads are the weak part. |
| **Zero dependencies / 5 kB gzip** | A credible "runtime for agent-generated UI" footprint. |

---

## 2. Claims vs reality

The README makes strong guarantees. Each one is currently false in a way that matters to robustness and to agents.

| Claim | Reality |
|---|---|
| "Components are pure data structures." | Definitions contain closures and DOM assumptions. A component cannot be serialized, sent, or safely generated by a remote agent. Only the *output* tree is data, and it contains live functions. |
| "State is immutable." | `Store.getState()` and `getComponentTree()` return **shallow** copies; nested objects are shared and mutable ([store.ts:18-20](../packages/vio/src/reactivity/store.ts#L18-L20)). Actions can mutate and return the same object; nothing detects it. |
| "Everything is observable." | Only events are observable. There are no sequence numbers, correlation IDs, subscriptions with filters, or backpressure. History stores live payload references, which can be mutated after the fact. |
| "Full introspection — `getComponentTree()`." | Returns `{ id, name, state, children: [] }` for the root only ([app.ts:130-140](../packages/vio/src/core/app.ts#L130-L140)). There is no structure to see. |
| "Batch operations atomically." | Not atomic: each operation renders independently. Two `dispatch` ops produced **two extra renders** in a probe; a throwing op leaves earlier ops applied. Only 4 of the 6 declared actions are implemented ([app.ts:149-173](../packages/vio/src/core/app.ts#L149-L173)). |
| "Serializable, loggable, replayable." | Event history has no sequence, no inverse, no state hashes, and no action log. Replaying 100 events cannot reproduce a session. |
| "Components, state, events are all plain JSON." | Event handlers are functions; `setState` can hold anything; JSON serialization can fail or leak. |
| "Router: path matching, params, guards." | Params are matched but never delivered; guards are silently skipped when no store is configured; unknown routes leave stale UI. |
| "Forms: form state, validation, node generation." | Values live outside app state (not observable/introspectable), there is no input binding, no submit path, no error display, no async validation. |
| "Devtools exposes the app to agents." | The component-tree tool returns the root state only; there is no snapshot, no refs, no actions/assertions, no event streaming, no auth. |

This gap between marketing and semantics is the biggest robustness risk: an agent reading the README will confidently call APIs whose contracts are false.

---

## 3. Verified defects

All of the following were reproduced in jsdom against the current source. Severity is from the perspective of "an agent builds and operates a real app".

### 3.1 P0 — correctness or security

| # | Defect | Evidence | Effect |
|---|---|---|---|
| 1 | **Root tag change freezes the app.** `patch(REPLACE)` swaps the DOM node, but `Renderer` keeps `instance.element` pointing at the detached node. | [renderer.ts:103-117](../packages/vio/src/core/renderer.ts#L103-L117), [diff.ts:108-111](../packages/vio/src/core/diff.ts#L108-L111) | Any component whose root conditional changes tag stops updating permanently (`elementConnected: false`). |
| 2 | **`key` is ignored.** Children are diffed by index. | [diff.ts:54-95](../packages/vio/src/core/diff.ts#L54-L95) | Reordering a list patches values into the wrong DOM nodes; focus, selection, input contents, and component state are lost or swapped. |
| 3 | **Controlled inputs do not work.** `value`/`checked` are set as attributes, never as DOM properties. | [diff.ts:113-137](../packages/vio/src/core/diff.ts#L113-L137), [renderer.ts:165-167](../packages/vio/src/core/renderer.ts#L165-L167) | Typed text is not overwritten by state; checkbox `checked` stays `false` after a click even when state is `true`. The example documents the workaround. |
| 4 | **Style objects corrupt on update.** `patch` has no `style` branch, so it calls `setAttribute('style', '[object Object]')`. | [diff.ts:113-137](../packages/vio/src/core/diff.ts#L113-L137) | Dynamic styles break; create-time works, update-time destroys styling. |
| 5 | **Nested components are second-class.** No instance, no state, no lifecycle, no props contract. `onMount` never runs for children; `getComponentTree` cannot see them. | [renderer.ts:124-147](../packages/vio/src/core/renderer.ts#L124-L147), [renderer.ts:190-195](../packages/vio/src/core/renderer.ts#L190-L195) | A "component framework" where only the root is a component. No cleanup, no local state, no composition. |
| 6 | **Introspection is misleading.** `children` is hard-coded empty. | [app.ts:130-140](../packages/vio/src/core/app.ts#L130-L140) | Agents cannot see the UI they are controlling; the devtools' main tool is useless. |
| 7 | **Route params never reach components.** The matcher returns `params`, but nothing passes them into render. | [router.ts:26-48](../packages/vio/src/router/router.ts#L26-L48), [renderer.ts:119-121](../packages/vio/src/core/renderer.ts#L119-L121) | `/users/:id` is unusable except by reading `window.location` (which the example does). |
| 8 | **Agent-generated UI is executable.** A spec can contain `{tag:'script', children:['...']}` or `{props:{onclick:'...'}}`. The renderer creates a real `<script>` and sets inline handler attributes. | [renderer.ts:149-186](../packages/vio/src/core/renderer.ts#L149-L186), [diff.ts:113-137](../packages/vio/src/core/diff.ts#L113-L137) | Script injection, `javascript:` URLs, `<iframe srcdoc>`, `<base>`, `<meta http-equiv>`; no allowlist, no sanitizer. In an agent-first framework, model output must be treated as untrusted. |
| 9 | **Devtools is unauthenticated and open by default.** WS on `localhost:3100`, no token, no origin check, no rate limit; `removeComponent` can unmount the root. | [client.ts:45-48](../packages/vio-devtools/src/client.ts#L45-L48), [ws-bridge.ts:27-50](../packages/vio-devtools/src/ws-bridge.ts#L27-L50), [tools.ts:63-70](../packages/vio-devtools/src/tools.ts#L63-L70) | Any local page/process can drive or blank the app. |

### 3.2 P1 — semantics and completeness

| # | Defect | Evidence | Effect |
|---|---|---|---|
| 10 | **Navigation to the current path swallows the next `hashchange`.** `isProgrammaticHash` is set before setting the hash and only cleared by a `hashchange`, which does not fire when the hash is unchanged. | [app.ts:142-147](../packages/vio/src/core/app.ts#L142-L147), [app.ts:67-75](../packages/vio/src/core/app.ts#L67-L75) | After `app.navigate('/')` on `/`, the browser Back button or a manual hash edit is ignored. |
| 11 | **Unknown route leaves stale UI and a lying URL.** | [app.ts:47-57](../packages/vio/src/core/app.ts#L47-L57) | `navigate('/nope')` changes the hash, renders nothing, and leaves the previous page; no 404. |
| 12 | **Guard is silently ignored without a store.** | [router.ts:32](../packages/vio/src/router/router.ts#L32), [router.ts:40](../packages/vio/src/router/router.ts#L40) | Auth guards "work" only if your app happens to configure a store; otherwise they are no-ops. Fail-open security. |
| 13 | **Every navigation unmounts and remounts the root.** | [app.ts:47-57](../packages/vio/src/core/app.ts#L47-L57) | Local state is lost on route changes even when the same component handles both routes; mounted children (if they existed) would leak. |
| 14 | **`batch` is not atomic and its payload shape is inconsistent.** `dispatch` reads `{action, value}`, while the type and devtools say `payload`. `addComponent`/`updateProps` are unimplemented. | [app.ts:149-173](../packages/vio/src/core/app.ts#L149-L173), [types.ts:76-80](../packages/vio/src/core/types.ts#L76-L80) | "Atomic" batches emit intermediate UI states; devtools calls silently do nothing. |
| 15 | **Store immutability is shallow and unenforced.** | [store.ts:18-37](../packages/vio/src/reactivity/store.ts#L18-L37) | `app.getStore().user.name = 'x'` mutates app state; two setState calls produced three renders; no transaction. |
| 16 | **No error containment.** A throwing `render`, `onMount`, or event handler breaks the app; no boundary, no diagnostic, no recovery. | [renderer.ts:99-121](../packages/vio/src/core/renderer.ts#L99-L121) | Blank screen; agents get a stack trace without component path or state. |
| 17 | **No app teardown.** `createApp` has no `destroy()`; hash listeners, store subscribers, WS, and DOM persist. | [app.ts:59-178](../packages/vio/src/core/app.ts#L59-L178) | Leaks in tests, HMR, embedding, and multi-app pages. |
| 18 | **SVG is created in the HTML namespace.** | [renderer.ts:152](../packages/vio/src/core/renderer.ts#L152), [node.ts:8](../packages/vio/src/core/node.ts#L8) | `<svg><path/></svg>` produces HTML elements; icons/charts do not render. |
| 19 | **`mount(def, parentEl)` never appends the element when `parentEl` is provided.** | [renderer.ts:36-40](../packages/vio/src/core/renderer.ts#L36-L40) | The public-looking child-mount API silently renders nothing. |
| 20 | **No depth/node budget.** Recursive resolution/creation has no limits. | [renderer.ts:124-198](../packages/vio/src/core/renderer.ts#L124-L198) | A malicious or broken spec can stack-overflow or freeze the tab. |
| 21 | **IDs come from a module-global counter.** | [renderer.ts:5](../packages/vio/src/core/renderer.ts#L5) | IDs differ between server and client (blocking hydration), leak creation order, and are not stable for agent refs. |
| 22 | **HTTP client drops useful behavior.** No abort/timeout/retry, error responses discard the body, no query serialization, no FormData, no credentials, no 204 handling; response types are not exported. | [http/client.ts:56-91](../packages/vio/src/http/client.ts#L56-L91), [index.ts:35](../packages/vio/src/index.ts#L35) | Real APIs fail in ways the client cannot express or recover from. |

### 3.3 Why the 99 passing tests did not catch this

The suite tests the happy path, not the contract:

- `getComponentTree` is asserted only on `name` and `state`, never `children` ([app.test.ts:155-160](../packages/vio/src/__tests__/core/app.test.ts#L155-L160)).
- Diff tests cover text, props, add/remove at the tail, and tag replacement on a detached element; they never cover **reorder**, **focus/value preservation**, **root replacement through the Renderer**, **style**, **checkbox property**, or **SVG**.
- Renderer tests mount a root and a nested stateless child; they never assert child lifecycle or child state.
- No SSR, hydration, accessibility, memory, security, property-based, or token-budget tests.
- Devtools tests use a mock app; they do not test that the returned tree is truthful.

That is why the suite is green while the framework is not robust. Fixing the tests is part of fixing the framework.

---

## 4. Comparison with React, Vue, Svelte

Versions referenced: React 19, Vue 3.5+/3.6, Svelte 5. "Built-in" means the core framework provides it; "ecosystem" means an official or dominant companion package.

### 4.1 Core rendering and composition

| Capability | React 19 | Vue 3.6 | Svelte 5 | Vio v2 | Vio v3 target |
|---|---|---|---|---|---|
| Components | ✅ | ✅ | ✅ | 🟡 root only | ✅ |
| Props + validation | 🟡 types only | ✅ runtime/types | ✅ runtime/types | ❌ | ✅ schema |
| Children / slots | ✅ | ✅ named slots | ✅ snippets | ❌ | ✅ |
| Fragments / arrays | ✅ | ✅ | ✅ | ❌ single node | ✅ |
| Conditionals / lists | ✅ | ✅ | ✅ | ✅ manual | ✅ |
| Keyed reconciliation | ✅ | ✅ | ✅ | ❌ | ✅ |
| Refs | ✅ | ✅ | ✅ | ❌ (`getRef` returns null) | ✅ |
| Lifecycle | ✅ | ✅ | ✅ | 🟡 root only | ✅ per instance |
| Context / DI | ✅ | ✅ provide/inject | ✅ | ❌ | ✅ |
| Error boundaries | ✅ | ✅ | ✅ | ❌ | ✅ |
| Async / Suspense | ✅ | ✅ | ✅ await | ❌ | ✅ resource states |
| Portals / teleport | ✅ | ✅ Teleport | ✅ | ❌ | ✅ |
| Transitions / animation | 🟡 | ✅ | ✅ | ❌ | ✅ |
| Custom directives | ❌ | ✅ | ✅ actions | ❌ | 🟡 |
| Memoization | ✅ memo/compiler | ✅ | ✅ derived | ❌ | ✅ selectors/memo |
| Built-in state | 🟡 hooks | ✅ reactive | ✅ runes | 🟡 basic | ✅ store |
| Built-in router | ❌ | 🟡 Vue Router | 🟡 SvelteKit | 🟡 hash only | ✅ nested/loaders |
| Built-in data cache | ❌ | 🟡 ecosystem | 🟡 load | ❌ | ✅ resources |
| Built-in forms | ❌ | 🟡 ecosystem | 🟡 actions | 🟡 stub | ✅ schema forms |
| Scoped styling | ❌ | ✅ | ✅ | ❌ | ✅ |
| TypeScript inference | ✅ | ✅ | ✅ | ❌ `Record<string, unknown>` | ✅ generics |

### 4.2 Platform and production

| Capability | React 19 | Vue 3.6 | Svelte 5 | Vio v2 | Vio v3 target |
|---|---|---|---|---|---|
| SSR | ✅ RSC/streaming | ✅ Nuxt | ✅ SvelteKit | ❌ | ✅ string/stream |
| Hydration | ✅ | ✅ | ✅ | ❌ | ✅ |
| Streaming | ✅ | ✅ | ✅ | ❌ | ✅ |
| SSG / islands | 🟡 Next/Astro | 🟡 Nuxt/Astro | 🟡 SvelteKit | ❌ | ✅ P3 |
| Code splitting / lazy | ✅ | ✅ | ✅ | ❌ | ✅ |
| i18n | 🟡 ecosystem | 🟡 vue-i18n | 🟡 ecosystem | ❌ | ✅ |
| Accessibility tooling | 🟡 eslint | 🟡 | ✅ compiler warnings | ❌ | ✅ catalog/axe |
| Testing utilities | ✅ RTL | ✅ VTU | ✅ testing-library | ❌ | ✅ `@vio/test` |
| Devtools | ✅ | ✅ | ✅ | 🟡 MCP only | ✅ CLI + MCP |
| Custom elements / interop | 🟡 | ✅ | ✅ | ❌ | ✅ adapters |
| Compiler required | 🟡 JSX | ✅ SFC | ✅ | ❌ | ❌ |
| Gzip core | ~20 kB+ (ReactDOM) | ~13–16 kB | ~3–10 kB | **5.2 kB** | ≤12 kB |
| Ecosystem | huge | large | medium | none | interop |

### 4.3 Agent-native capabilities (the actual opportunity)

| Capability | React | Vue | Svelte | Vio v2 | Vio v3 target |
|---|---|---|---|---|---|
| Machine-readable app manifest | ❌ | ❌ | ❌ | ❌ | ✅ |
| Token-efficient UI snapshot with refs | ❌ | ❌ | ❌ | ❌ | ✅ |
| Snapshot diff / pagination | ❌ | ❌ | ❌ | ❌ | ✅ |
| Semantic action invocation (no selectors) | ❌ | ❌ | ❌ | 🟡 `dispatch` | ✅ invoke |
| Assertions / wait-for (self-verification) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Deterministic replay / time travel | ❌ | ❌ | ❌ | ❌ | ✅ |
| Permissions / confirmation / audit for agent actions | ❌ | ❌ | ❌ | ❌ | ✅ |
| Safe generated UI (catalog, sanitization) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Protocol interop (A2UI / MCP Apps / AG-UI / WebMCP) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-surface render (HTML/email/Markdown/terminal) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Token budgets in CI | ❌ | ❌ | ❌ | ❌ | ✅ |
| OpenAPI/schema → UI | ❌ | ❌ | ❌ | ❌ | ✅ |

### 4.4 The honest verdict on "more features"

You will not out-feature three ecosystems. Any roadmap that tries will fail on maintenance, documentation, and edge cases.

What is achievable:

1. **Parity on the agent-app subset.** Routing, data, forms, auth guards, tables, errors, loading/empty states, SSR, i18n, a11y, testing. This is a finite list (~20 primitives), not an ecosystem.
2. **Built-ins where the others rely on ecosystem.** A single install that includes router + data + forms + styles is genuinely "more complete" for the first hour of a project.
3. **Interop instead of reimplementation.** Host React/Vue/Svelte components as leaf islands behind an adapter. Vio becomes the only framework that can consume the other three. That is a justified claim of "more".
4. **Win the agent contract decisively.** Snapshot/act/assert/replay/permissions/multi-surface/token budgets are things none of the three have. This is the moat.
5. **Multi-surface.** One IR rendered to web, email, Markdown, terminal, PDF. The others are web-first (React Native aside).

If a comparison table says "Vio has more features than React", it should be scoped: *more relevant features for agent-built, agent-operated apps, plus interop with the React ecosystem*. Otherwise it is not credible.

---

## 5. What agent-first UI looks like in 2026

Five projects are defining the space. Vio should align with their lessons rather than invent a parallel dialect.

### 5.1 A2UI (Google, v0.9)

A2UI transmits UI as **declarative data, not executable code**: a flat list of components with ID references, a data model, and a catalog of trusted components. The client owns rendering and styling. Key properties:

- **Flat component list with IDs** is easy for LLMs to generate *incrementally* and for clients to patch.
- **Catalog** defines the allowed vocabulary; the agent cannot invent components or raw HTML.
- **Data model + JSON Pointer binding** (`/user/name`) separate structure from values.
- **Incremental updates and streaming**, not full regeneration.
- **Client-defined functions** for validation and formatting.
- **Version negotiation** and **error handling** are part of the spec.
- Security: the format is data, so the host can review and sandbox; UI injection is bounded by the catalog.

Source: [Introducing A2UI](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/), [A2UI v0.9](https://developers.googleblog.com/a2ui-v0-9-generative-ui/).

**Lesson for Vio:** the nested descriptor tree is the wrong *wire* format. Keep nested authoring if you like, but normalize to a flat, ID-addressed graph with a catalog and data binding.

### 5.2 json-render (Vercel Labs)

A schema-agnostic spec runtime built around `{ root, elements }`:

- **Catalog** of components/actions/functions with Zod schemas; `catalog.prompt()` generates a compact system prompt.
- **Specs** are flat and streamable; **JSONL patches** update them progressively.
- **Data binding** (`{ "$state": "/path" }`), **computed values**, **visibility**, **watchers**, **validation**, **directives**.
- **Registry/renderers** for multiple targets; **code export**; devtools.
- Integrations for AI SDK, A2UI, Adaptive Cards, AG-UI, OpenAPI.

Sources: [Specs](https://json-render.dev/docs/specs), [Catalog](https://json-render.dev/docs/catalog), [AI SDK](https://json-render.dev/docs/ai-sdk).

**Lesson for Vio:** a spec runtime needs validation, binding, streaming patches, and code export. These are not "nice to have"; they are the product.

### 5.3 MCP Apps (SEP-1865)

MCP Apps treats UI as a **predeclared resource** (`ui://`) referenced by tools, rendered in a **sandboxed iframe**, with **bidirectional JSON-RPC** and **user consent** for UI-initiated tool calls.

Source: [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).

**Lesson for Vio:** support both sides. Vio should be able to render an MCP App/UI resource, and expose a Vio app as a reviewable UI resource. Sandboxing and consent are part of the agent contract, not an afterthought.

### 5.4 WebMCP (Chrome)

WebMCP lets a page expose tools to browser agents via an imperative API or declarative form annotations, so an agent can call `addTodo` instead of guessing selectors.

Source: [WebMCP](https://developer.chrome.com/docs/ai/webmcp).

**Lesson for Vio:** every action in a Vio app should already be a named, schema-described capability. Exposing them as WebMCP tools should be one line, not a separate integration.

### 5.5 AG-UI

AG-UI standardizes the event stream between agents and frontends (messages, tool calls, state deltas). A2UI explicitly composes with it.

**Lesson for Vio:** the event bus and agent bridge should speak a standard streaming protocol, not just request/response.

### 5.6 Playwright MCP

Playwright MCP's design is the best public example of token-efficient agent control:

- **Accessibility tree snapshots with refs**, not screenshots.
- `browser_snapshot` supports `target`, `depth`, and boxes; actions take an **exact ref**.
- `browser_verify_*` tools let the agent assert outcomes.
- Its README now says the quiet part: for coding agents, **CLI + skills are more token-efficient than MCP** because they avoid loading large tool schemas and verbose trees into context.

Source: [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp).

**Lesson for Vio:** ship a CLI and a 300-token skill for coding agents; keep MCP for persistent, interactive loops. Both should share one protocol and one snapshot format.

### 5.7 Synthesis: ten principles for Vio v3

1. **Spec is data; actions are names.** No functions in the wire format.
2. **Flat graph + stable IDs + keys.** Nested syntax is sugar.
3. **Catalog is the security and quality boundary.** Agents compose trusted components.
4. **Bind, don't re-send.** Data binding + patches beat regenerating trees.
5. **Stream and diff.** JSONL/JSON Patch, partial render, snapshot diffs.
6. **Observe with a11y/refs, not full JSON dumps.**
7. **Act semantically first, by ref second.** `invoke(action)` beats clicking.
8. **Assert, don't eyeball.** Built-in waiting assertions and replay.
9. **CLI for coding agents, MCP for loops.** One protocol, two surfaces.
10. **Make token cost a testable budget**, not a slogan.

---

## 6. Vio v3 architecture

### 6.1 One IR, two authoring surfaces, many renderers

```
Authoring                          Wire / storage
  HTML tagged template  ─┐         ┌─ canonical IR (flat, versioned)
  Terse array DSL       ─┼─ compile ─┤   nodes + data + actions + meta
  JSON spec (agents)    ─┘         └─ JSON Patch / JSONL stream
                                             │
                                      validate against catalog
                                             │
Runtime: instance tree → keyed reconcile → DOM ops
         store (transactions, resources) ←→ effects
         agent bridge (manifest/snapshot/act/assert/invoke/events)
         transports (CLI, MCP, WS/SSE, AG-UI, WebMCP, A2UI)
         renderers (DOM, SSR HTML, Markdown, terminal, email/PDF)
```

The **canonical IR** is the contract. Everything else is a front-end or back-end for it.

### 6.2 Canonical IR (flat, ID-addressed, versioned)

```json
{
  "vio": 3,
  "root": "n1",
  "nodes": {
    "n1": { "type": "main", "children": ["n2", "n3"] },
    "n2": { "type": "h1", "children": ["Todos"] },
    "n3": {
      "type": "TodoList",
      "props": {
        "items": { "$state": "/todos" },
        "filter": { "$state": "/filter" },
        "onToggle": { "$action": "todo.toggle" },
        "onDelete": { "$action": "todo.delete" }
      }
    }
  },
  "data": { "todos": [], "filter": "all" },
  "meta": { "title": "Todos", "route": "/todos" }
}
```

Rules:

- `type` is an HTML tag or a catalog component name. No implicit components.
- Every node has a stable ID. Keys are required for list items.
- Prop values may be expressions: `$state` (JSON Pointer), `$bind`, `$cond`, `$t` (i18n), `$pipe` (whitelisted function), `$action` (named action + args).
- `data` is a JSON document; binding uses RFC 6901 JSON Pointer.
- No functions, DOM nodes, or class instances in the IR.
- Specs are validated against the catalog before render; errors carry JSON Pointer paths.

**Why flat:** A2UI and json-render both use flat, ID-addressed graphs because they are incrementally patchable and easier for LLMs to emit and repair. Nested authoring stays as sugar; the runtime normalizes.

### 6.3 Semantic catalog is the biggest token lever

The current model forces an agent to emit every `<li>`, `<input>`, and `<button>`. A semantic catalog lets it say:

```json
{
  "root": "todos",
  "elements": {
    "todos": {
      "type": "TodoList",
      "props": {
        "items": { "$state": "/todos" },
        "filter": { "$state": "/filter" },
        "onToggle": { "$action": "todo.toggle" },
        "onDelete": { "$action": "todo.delete" }
      }
    }
  },
  "data": { "filter": "all", "todos": [] }
}
```

Measured: **106 tokens** (pretty-printed), versus **1,058** for a flat primitive tree and **3,110** for a nested instance tree of the same 20-item screen. That is a 10–30x reduction before any diffing.

Catalog definition:

```ts
const catalog = defineCatalog({
  components: {
    TodoList: {
      description: 'Filtered todo list with toggle and delete.',
      props: z.object({
        items: z.array(Todo),
        filter: z.enum(['all', 'active', 'done']),
        onToggle: action(),
        onDelete: action(),
      }),
      slots: [],
    },
    DataTable: { /* ... */ },
    Form: { /* ... */ },
    Metric: { /* ... */ },
  },
  actions: {
    'todo.toggle': { params: z.object({ id: z.string() }), scope: 'write' },
    'todo.delete': { params: z.object({ id: z.string() }), scope: 'write', confirm: true },
  },
})
```

The catalog generates:

- JSON Schema for validation,
- a **compact prompt** for agents (component names, props, actions, one example),
- the **manifest** returned by `vio_manifest`,
- the allowlist used by the sanitizer,
- docs (`llms.txt`) and codegen.

This is the json-render/A2UI pattern, and it is the right one.

### 6.4 Component model: props, state, context, slots, lifecycle

Keep `defineComponent`, fix the contract. The second render argument — currently an unused store slot — becomes the context. That preserves v2 source compatibility.

```ts
const TodoItem = defineComponent({
  name: 'TodoItem',
  props: z.object({ todo: TodoSchema }),
  state: () => ({ editing: false }),
  render(state, ctx) {
    const { todo } = ctx.props
    return html`
      <li key=${todo.id} class=${todo.done ? 'done' : ''}>
        <input type="checkbox" checked=${todo.done}
               @change=${() => ctx.dispatch('todo.toggle', todo.id)}>
        <span>${todo.text}</span>
        <button @click=${() => (state.editing = true)}>Edit</button>
      </li>`
  },
  onMount(ctx) {
    const id = setInterval(() => ctx.setState({ now: Date.now() }), 1000)
    return () => clearInterval(id)
  },
  onError(err, ctx) {
    return html`<p class="error">Could not render item: ${err.message}</p>`
  },
})
```

`ctx` provides:

| Field | Purpose |
|---|---|
| `props` | Read-only inputs, validated by schema |
| `state` | Current state (same object as first arg) |
| `set(patch)` | Local state update (object or updater) |
| `dispatch(name, payload)` | Store action (sync or async) |
| `store` | Read-only store snapshot / selector hook |
| `route` | `{ path, params, query, hash, data }` |
| `ref(name)` | Element ref, resolved after commit |
| `slot(name?)` | Children/slot content |
| `emit(name, payload)` | Bubbling component event |
| `signal` | `AbortSignal`, aborted on unmount |
| `use(resource)` | Subscribe to a resource |
| `watch(source, cb)` | Effect with automatic cleanup |
| `inject(key)` | Context value from an ancestor |

Lifecycle is **per instance**, not per root. Children get instances, IDs, cleanup, and error boundaries.

**Props vs state is not cosmetic.** Merging them (current behavior) means a parent re-render silently resets child state, and a child cannot tell "my input changed" from "my local state changed". Separate them.

### 6.5 Instance tree and keyed reconciliation

```
App
└─ Shell
   ├─ Nav
   └─ TodoPage (route)
      ├─ TodoInput
      └─ TodoList
         ├─ TodoItem[key=t1]
         └─ TodoItem[key=t2]
```

Each instance:

```ts
interface Instance {
  id: string            // stable path, not a global counter
  key?: string | number
  def: ComponentDef
  props: unknown
  state: unknown
  parent: Instance | null
  children: Instance[]
  element: Node | null
  status: 'mounting' | 'ready' | 'error' | 'unmounted'
  cleanups: (() => void)[]
  error?: Error
}
```

Reconciliation:

- Keyed children matched by `key`; unkeyed by position.
- Minimal moves using LIS (longest increasing subsequence), the standard approach in Vue/Solid.
- Component instances preserved across reorders and route changes when the same component + key remains.
- DOM writes batched; effects flushed after commit.
- Root tag replacement updates the preserved element pointer (fixes P0 #1).
- Attributes vs properties handled explicitly (`value`, `checked`, `selected`, `disabled`, `muted`, `open`).
- SVG namespace selected by tag (`svg`, `path`, `circle`, ...) or an `ns` prop.
- Style objects diffed per property; class accepts string, array, or object.
- Event handlers delegated at the root; cleanup on unmount; `passive`, `capture`, `once` options.
- `innerHTML` is not available; `html`/`text`/`nodes` are explicit, safe props.

### 6.6 Store, resources, transactions

Store keeps the good reducer core, adds the missing production semantics:

```ts
const store = defineStore({
  state: () => ({ todos: [] as Todo[], filter: 'all' as Filter }),
  getters: {
    left: (s) => s.todos.filter((t) => !t.done).length,
  },
  actions: {
    toggle(id: string, { commit }) {
      commit((s) => {
        const t = s.todos.find((x) => x.id === id)
        if (t) t.done = !t.done
      })
    },
    async add(text: string, { commit, signal }) {
      const todo = await api.create(text, { signal })
      commit((s) => s.todos.push(todo))
    },
  },
  persist: { key: 'todos', version: 1, migrate: (old) => old },
})
```

Add:

- **Transactions**: `store.tx(fn)` batches events/renders and rolls back on throw.
- **Selectors with memoization**; components subscribe to slices, not the whole tree.
- **Async actions** with `signal`, status, and error.
- **Middleware**: logging, undo, analytics, permission checks.
- **Time travel**: `{ seq, action, payload, stateHash }` ring buffer; `app.replay(seq)`.
- **Immutability**: dev deep-freeze; `commit` uses structural sharing; actions cannot return the same object.
- **Persistence** with versioned migration.
- **Serializability check** in dev: warn on functions, cycles, DOM nodes.

Resources (the real-world data primitive):

```ts
const todos = resource({
  key: ['todos', filter],
  load: ({ signal }) => http.get('/api/todos', { signal }),
  staleTime: 30_000,
  retry: { attempts: 2, backoff: 'expo' },
})

// in a component
const { data, loading, error, refetch } = ctx.use(todos)
```

Resource states are explicit (`idle | loading | refreshing | empty | error | ready`) and appear in the agent snapshot. Mutations support optimistic updates, rollback, and invalidation. SSR can prefetch and serialize the cache.

### 6.7 Router with loaders, guards, and layouts

```ts
const routes = [
  {
    path: '/',
    layout: Shell,
    guard: async ({ session }) => session.user ?? redirect('/login'),
    children: [
      { index: true, component: Home },
      {
        path: 'todos/:id',
        component: TodoPage,
        loader: ({ params, signal }) => api.todo(params.id, { signal }),
      },
      { path: '*', component: NotFound },
    ],
  },
]
```

Requirements:

- Nested routes and layouts; relative paths; `index`; wildcard specificity (most specific wins, not first).
- Async guards with `redirect()` and abort; **fail closed** when a guard throws.
- Typed params and query schemas; encoded values; repeated query keys.
- Loaders run before render; data available via `ctx.route.data`; pending/error UI; revalidation.
- Lazy components with pending UI.
- History mode by default (real URLs, SSR/SEO); hash mode opt-in.
- 404 and error routes.
- Scroll restoration, focus management, route announcer for a11y, view transitions.
- Route manifest for agents (paths, params, auth, loaders).

### 6.8 SSR, hydration, islands

- `renderToString(appOrSpec, { catalog, data })` → `{ html, state, head, css }`, no DOM globals.
- `renderToStream` for progressive HTML plus patches.
- `hydrate(app, el, { state })` attaches events without re-creating DOM; warns on mismatch with a component path.
- SSR-safe core: no `document`/`window` at import or app creation; adapters for browser/server/worker.
- Static export per route; islands hydrate only interactive components.
- Head/meta/JSON-LD management, critical CSS extraction, CSP nonce, Trusted Types.
- Deterministic IDs derived from route + key path (not counters) so server and client agree.

SSR is also an **agent feature**: an agent can render a page to HTML or a snapshot without a browser, verify content, and produce email/PDF from the same IR.

### 6.9 Agent protocol: two planes, one snapshot format

**Semantic plane** (stable, no selectors):

```ts
app.invoke('todo.toggle', { id: 't1' })
app.invoke('todo.add', { text: 'Buy milk' })
app.assert({ state: '/todos/0/done', equals: true })
```

**Presentation plane** (exploration/UI-specific):

```ts
const snap = app.see({ depth: 6, page: 0 })
app.act(snap.ref('e12'), 'click')
```

**Manifest** (cached, ~250 tokens):

```json
{
  "app": "todos",
  "route": "/todos",
  "routes": [{ "path": "/todos/:id", "params": { "id": "string" }, "auth": true }],
  "components": { "TodoList": { "props": ["items", "filter", "onToggle", "onDelete"] } },
  "actions": {
    "todo.toggle": { "params": { "id": "string" }, "scope": "write" },
    "todo.delete": { "params": { "id": "string" }, "scope": "write", "confirm": true }
  },
  "limits": { "maxNodes": 2000, "snapshotDepth": 8, "pageSize": 50 },
  "capabilities": ["see", "act", "assert", "state", "invoke", "nav", "replay"]
}
```

**Snapshot** (a11y-style, refs, state summary, pagination):

```
route=/todos filter=all left=7 gen=42
main#e1
 h1#e2 "Todos"
 form#e3
  input#e4 text "New todo" val=""
  button#e5 "Add" [enabled]
 ul#e6
  li#e7 done
   checkbox#e8 "Buy milk" [checked]
   button#e9 "Delete"
  …
 status#e30 "7 left"
```

Rules:

- Refs are stable within a generation; structural changes bump `gen` and invalidate refs.
- Lists paginate (`page`, `pageSize`, `… 80 more`); subtrees can be collapsed by `depth` or `ref`.
- State is included only for components marked `expose` or when `state:true`; secrets/PII are redacted.
- `see({ diff: true })` returns only `+`, `-`, `~` lines since the previous snapshot. Measured: **57 tokens** for a small diff versus **1,019** for a full 20-item aria snapshot.
- Errors include the component path and a suggested next action.

**Tools** (keep the count small; 6–8):

| Tool | Purpose |
|---|---|
| `vio_manifest` | Cached app contract: routes, components, actions, permissions, limits |
| `vio_see` | Snapshot with refs; diff, depth, target, pagination |
| `vio_act` | Click/fill/select/check/press/hover/focus/scroll by ref; waits for settle |
| `vio_invoke` | Invoke a named action with validated params (no ref) |
| `vio_assert` | Wait for text/ref/state/route condition; structured pass/fail |
| `vio_state` | Read/patch store or component state by JSON Pointer |
| `vio_nav` | Navigate and return a snapshot diff |
| `vio_debug` | Events, errors, perf, token meter (opt-in) |

Plus MCP **resources** for `manifest`, `snapshot`, `schema`, and an **event subscription** (instead of polling `getEventHistory`).

**CLI** (for coding agents; Playwright's own README recommends this over MCP for high-throughput coding):

```
vio see --diff --depth 6 --json
vio act e4 fill "Buy milk"
vio invoke todo.toggle --id t1 --json
vio assert state /todos/0/done=true
vio nav /todos --diff
vio test agent/tasks/*.yaml
vio replay .vio/session.json
```

Exit codes, JSON output, no tool-schema overhead. Ship a **skill** (a 300-token contract) and an `AGENTS.md`.

### 6.10 Security model for generated UI

Threat model: the spec may come from a remote agent, a subagent, or a prompt-injected model. Treat it as untrusted HTML/JS.

Controls:

1. **Catalog allowlist** for tags, components, props, and actions. Unknown → structured validation error, not a render.
2. **Forbidden tags/attrs**: `script`, `iframe`, `object`, `embed`, `base`, `meta`, `link`, `form[action]` unless explicitly allowed; `on*` attributes always rejected; inline event handlers are functions or `$action`, never strings.
3. **URL sanitization**: only `https:`, `mailto:`, `tel:`, relative; reject `javascript:`, `data:` (except images with a strict MIME allowlist), `blob:` unless trusted.
4. **No raw HTML** (`innerHTML`) in the spec path. `html` is for trusted code, not generated specs.
5. **Budgets**: max depth, nodes, text length, children per node, total spec bytes; reject with a path.
6. **Prototype safety**: reject `__proto__`, `constructor`, `prototype` keys; use null-prototype maps for props.
7. **Action scopes**: `read` < `write` < `danger` < `payment`; confirmation policy; per-agent tokens; audit log with actor and before/after.
8. **Redaction**: snapshot/state filters for passwords, tokens, PII; `expose` allowlist.
9. **Transport auth**: devtools token, origin check, localhost bind, rate limit; no unauthenticated `removeComponent`.
10. **CSP / Trusted Types** guidance and SSR nonce injection.
11. **Provenance UI**: mark agent-generated regions ("generated") and require human confirmation for destructive actions.
12. **Prompt-injection awareness**: generated UI text is data; never interpret it as instructions; link/action targets validated.

Add a **malicious spec test suite** (script tag, inline handler, `javascript:` URL, depth bomb, huge array, prototype pollution, data exfiltration via snapshot) to CI.

### 6.11 Interop: borrow the ecosystems

Do not rebuild React's ecosystem. Host it:

```ts
import { reactIsland } from 'vio-adapter-react'
import { Chart } from 'recharts'

const RevenueChart = reactIsland(Chart, {
  props: { data: { $state: '/revenue' } },
})
```

- Render React/Vue/Svelte components into Vio-owned containers; pass props and callbacks; unmount cleanly.
- Hydrate islands only when interactive; SSR static HTML by default.
- Expose Vio components as custom elements for the reverse direction.
- Adapters are optional packages, so the core stays 5 kB.

This is the practical answer to "more features": Vio owns the app shell, routing, data, agent contract, and multi-surface output; the ecosystem supplies leaf widgets.

### 6.12 Multi-surface renderers

The same IR can target:

| Target | Use case | Notes |
|---|---|---|
| DOM | Web app | Primary |
| HTML string | SSR, email | Inline CSS, table layout for email; escape by default |
| Markdown | Docs, reports, chat | Headings/lists/tables/links; interactive nodes degrade to text |
| Terminal/ANSI | CLI agents | Boxes, colors, prompts |
| PDF | Reports, invoices | Print CSS or server renderer |
| JSON | Other agents | The IR itself |

This is a defensible "more features than React/Vue/Svelte" claim: they are web runtimes; Vio can be the **UI layer for agent outputs**, not just web pages. Start with DOM + SSR + Markdown, then email/terminal.

### 6.13 Decision log: what to change and why

| ID | Decision | Evidence | Cost | Reversible |
|---|---|---|---|---|
| D1 | Flat, ID-addressed IR as the canonical wire format; nested syntax as sugar | A2UI flat list for incremental generation; json-render `{root,elements}` | Medium: rewrite diff/introspection; keep authoring | Yes (format version) |
| D2 | Semantic catalog + data binding + patches | A2UI catalog/data model; json-render catalog/streaming; 106 vs 1,058/3,110 tokens | Medium: schema/validation layer | Yes (catalog optional) |
| D3 | Named actions, no closures in specs | A2UI declarative data; MCP Apps reviewability; security | Low–medium: handler registry | Yes |
| D4 | Full instance tree with props/state/slots/context/error boundaries | Current root-only model blocks composition; React/Vue/Svelte all have it | High: renderer rewrite | No (internal) |
| D5 | Keyed reconciliation + DOM property semantics | Verified reorder/input/style bugs | Medium: diff rewrite | No (internal) |
| D6 | History router + nested routes + loaders/guards/redirects | Real URLs, SSR, auth; current params/guards broken | Medium | Yes (hash opt-in) |
| D7 | Resources + transactions in the store | Real-world data needs; current store is a reducer toy | Medium | Yes (additive) |
| D8 | Snapshot+refs+diff, act/assert/invoke, manifest | Playwright MCP; 57 vs 1,019 tokens; CLI-first research | Medium | Yes |
| D9 | SSR/hydration + deterministic IDs | SEO, first paint, agent server-side verification | High | Yes (opt-in) |
| D10 | Allowlisted catalog + sanitization + budgets | Agent output untrusted; current script/inline-handler injection | Medium | No (security) |
| D11 | Interop adapters for React/Vue/Svelte | Ecosystem breadth without reimplementation | Medium | Yes (optional packages) |
| D12 | Token budgets and agent evals in CI | Measured verbosity gap; avoids regressions | Low | Yes |

---

## 7. Token economy

### 7.1 Measurements

Tokenizer: `gpt-tokenizer` 4.1.0, `o200k_base` (modern OpenAI models). Code files are complete, formatted, with imports; no minification. These are **source tokens**, not model success rates.

| Artifact | Tokens |
|---|---:|
| React 19 counter | 63 |
| Vue 3.5 counter | 47 |
| Svelte 5 counter | 32 |
| **Vio v2 counter** | **125** |
| **Vio v3 terse counter** | **45** |
| **Vio v3 HTML counter** | **54** |
| React 19 filtered list | 179 |
| Vue 3.5 filtered list | 179 |
| Svelte 5 filtered list | 172 |
| **Vio v2 filtered list** | **287**\* |
| **Vio v3 terse filtered list** | **170** |
| README | 1,119 |
| Public types (`dist/index.d.ts`) | 1,938 |
| Whole runtime source | 8,278 |
| Starter todo app (`main.ts`) | 1,807 |
| Proposed cheat sheet | 274 |

\* Not equivalent: no props/local state; reads `window.vio`.

Current Vio is **2.0x** React, **2.7x** Vue, and **3.9x** Svelte on the counter, and **1.6x** React/Vue on the list, despite doing less. The proposed terse syntax is at parity with Vue and within 1.4x of Svelte, while the HTML syntax is within 1.2x of React.

### 7.2 Observation is where the real waste is

For the same 20-item screen:

| Format | Tokens | Structure? | Notes |
|---|---:|---|---|
| Current `getComponentTree()` | 591 | ❌ | Root state only; `children: []` |
| Honest nested instance tree | 3,110 | ✅ | Full nodes + state |
| Flat `{root, elements}` | 1,058 | ✅ | A2UI/json-render style |
| Accessibility snapshot | 1,019 | ✅ | Playwright-MCP style |
| Compact Vio snapshot | 539 | ✅ | Refs + inline state |
| **Snapshot diff** | **57** | changes only | 18x cheaper than full aria |
| **Semantic catalog spec** | **106** | intent only | `TodoList` + bindings |

The lesson is not "minify keys". It is:

1. **Don't send structure the agent doesn't need.** Prefer semantic components.
2. **Don't resend state with structure.** Bind by pointer; send state deltas.
3. **Don't resend the whole screen.** Diff by default.
4. **Don't make the agent read the DOM.** Refs + roles + names.
5. **Don't make the agent click when it can invoke.** Semantic action plane.

Key minification (`t`, `p`, `c`) saves 10–20% and hurts comprehension. Semantic compression saves 10–30x. Prioritize the latter.

### 7.3 Authoring syntax: let the eval decide

Three candidates, all compiling to the same IR:

1. **Terse array DSL** — JSON-compatible, no parser, 45 tokens for the counter.
   ```ts
   const Counter = component({ count: 0 }, (s, x) =>
     ['button.counter', { onclick: () => x.set({ count: s.count + 1 }) }, 'Count: ', s.count])
   ```
2. **HTML tagged template** — familiar to every model, SSR-friendly, 54 tokens.
   ```ts
   const Counter = component({ count: 0 }, (s, x) => html`
     <button class="counter" @click=${() => x.set({ count: s.count + 1 })}>
       Count: ${s.count}
     </button>`)
   ```
3. **JSX** — most familiar to React-trained models, but requires a compiler and is more verbose.

Recommendation: ship **HTML + terse DSL** (no compiler, same IR), document HTML as the default for agents, and run a controlled evaluation before freezing docs:

- 3 models × 5 tasks (counter, list, form, dashboard, chat) × 3 formats.
- Metrics: output tokens, first-pass validity, attempts to pass tests, wall time, human interventions.
- Pick the format with the best **tokens per successful task**, not the shortest hello world.

Svelte's 32-token counter is a reminder that a compiler can win on brevity. Vio's counterargument is **no build**, which saves setup tokens and failure modes. Measure both.

### 7.4 Agent surface budget

- **Manifest:** ~250 tokens, cached for the session.
- **Cheat sheet:** 274 tokens (see [vio-agent-cheatsheet.md](./vio-agent-cheatsheet.md)).
- **Tool schemas:** 6–8 tools, ~300 tokens total; current 11 tools measure 539.
- **Snapshot:** ≤400 tokens for a 20-item list by default; paginate beyond.
- **Diff:** ≤60 tokens for a typical interaction.
- **Errors:** one line + JSON Pointer + fix, no stack unless `debug`.

Enforce budgets in CI:

```json
{
  "budgets": {
    "cheatsheet": 300,
    "manifest": 300,
    "snapshot20": 400,
    "diff": 80,
    "counter": 60,
    "list": 200
  }
}
```

`vio check --tokens` fails the build if a doc, snapshot fixture, or example exceeds its budget. This is the only way "token-efficient" stays true.

### 7.5 The coding-agent workflow

Coding agents do not use a browser devtools panel. They read files, run commands, and parse output. Therefore:

- **CLI first**, MCP second; both share one protocol.
- **`vio check`** validates types, catalog, a11y rules, security rules, and token budgets; emits JSON with file/line/fix.
- **`vio see --json`** and **`vio act`** let the agent verify UI without screenshots.
- **`vio test`** runs agent task specs in CI.
- **`llms.txt` / `AGENTS.md` / one skill** replace prose docs.
- **Deterministic output** (no random IDs, no timing races) so agent runs are reproducible.
- **One canonical way** per task; aliases and magic confuse models.
- **Errors as repair instructions**, e.g. `E_CATALOG_PROP: TodoList has no prop "onToggl"; did you mean "onToggle"? at /elements/todos/props`.

---

## 8. Completeness and real-world relevance

### 8.1 What agent-built apps actually need

Ranked by frequency in agent-generated projects:

| Use case | Required primitives | Vio v2 | Phase |
|---|---|---|---|
| Admin CRUD / internal tools | auth, table, filters, pagination, forms, modals, toasts, optimistic updates, RBAC | ❌ | P2 |
| Dashboards | layout, metrics, charts (SVG), date ranges, loading/empty/error | ❌ | P2 |
| Forms / onboarding | schema validation, controlled inputs, errors, file upload, progress | 🟡 stub | P2 |
| Chat / agent UI | streaming, markdown, tool calls, approvals, attachments, A2UI/MCP Apps | ❌ | P1/P3 |
| Content / marketing / SEO | SSR/SSG, meta, i18n, images, a11y, routing | ❌ | P2 |
| Auth flows | session, guards, redirects, token refresh, protected routes | ❌ | P2 |
| Reports / email | multi-surface render, tables, PDF | ❌ | P3 |
| Offline / PWA | service worker, cache, sync queue | ❌ | P3 |
| Realtime / collab | WS/SSE, presence, optimistic, conflict handling | ❌ | P3 |
| Data visualization | SVG, canvas escape hatch, theming | ❌ | P2 |

The "boring" features are the differentiators for real-world use: auth guards, loading/empty/error states, optimistic updates, pagination, focus management, toasts, i18n, telemetry. React/Vue/Svelte users assemble these from ecosystem; Vio can ship them.

### 8.2 Table stakes backlog (must match, not exceed)

1. Props/state/slots/context/refs/error boundaries.
2. Keyed lists, fragments, conditionals.
3. SSR + hydration + head/meta.
4. Nested router + guards + loaders + redirects + 404.
5. Resources + mutations + cache + optimistic + offline queue.
6. Schema forms + validation + file upload + server errors.
7. Scoped styling + design tokens + dark mode.
8. A11y primitives: focus trap, live region, roving tabindex, skip link, reduced motion.
9. i18n: messages, plurals, locale routing, RTL.
10. Testing library + deterministic scheduler.
11. CLI + devtools + manifest + snapshots.
12. TypeScript generics/inference and schema generation.

### 8.3 Parity-plus (small built-in wins)

- Router + data + forms + styles in one package (React needs 4–6 libraries).
- Scoped CSS without a compiler (Vue/Svelte require SFC compilation).
- No build step (all three require one).
- Single 5–12 kB runtime (smaller than ReactDOM + router + query).
- Deterministic snapshots as a first-class test artifact.

### 8.4 Moat (where to be #1)

1. **Token-budgeted authoring + observation** with CI enforcement.
2. **Semantic action plane** + permissions + audit + WebMCP export.
3. **Snapshot/refs/assert** self-verification.
4. **Deterministic replay** and bug bundles.
5. **Safe generative UI** (catalog, sanitization, provenance).
6. **Protocol interop**: A2UI, MCP Apps, AG-UI, WebMCP.
7. **Multi-surface** output.
8. **OpenAPI/JSON Schema → UI** generation.
9. **Agent contract tests** in CI.
10. **Interop host** for React/Vue/Svelte islands.

### 8.5 Five reference apps to validate against

Build these before claiming completeness:

1. **Todo** (done) — baseline state, lists, filters, persistence.
2. **Admin CRUD** — auth, table, search, pagination, edit form, optimistic delete, toasts.
3. **Dashboard** — metrics, date range, SVG chart, loading/empty/error.
4. **Chat** — streaming messages, tool calls, approval card, attachments.
5. **Content site** — SSR, routes, i18n, SEO, a11y, static export.

For each, measure: source tokens, agent attempts, time to green tests, runtime size, Lighthouse, a11y violations, snapshot tokens.

---

## 9. Robustness engineering

### 9.1 Contracts and invariants

Write these down and test them:

- `render` is pure: same props/state → same IR; no DOM, no time, no randomness, no I/O.
- Every mounted instance is reachable from the instance tree and has a stable ID.
- Every effect/cleanup pair runs exactly once; unmount aborts the signal.
- `getComponentTree()`/`see()` reflects the DOM (modulo hidden/aria) and every node is addressable.
- A keyed reorder preserves element identity, focus, selection, and component state.
- `diff` + `patch` is observationally equivalent to a full render (property test).
- `batch`/`tx` is all-or-nothing and renders once.
- State snapshots are structurally immutable (dev deep-freeze).
- A render/lifecycle/action error is contained by the nearest boundary and reported with a component path.
- SSR HTML + hydration produces the same DOM as client render.
- Specs are validated before render; invalid specs never touch the DOM.
- Snapshot output contains no redacted fields and no functions.

### 9.2 Test plan

| Layer | Tests |
|---|---|
| Diff/reconcile | Property-based: random old/new trees → diff+patch ≡ full render; keyed reorder; focus/value; root replace; SVG; style; boolean attrs; events cleanup |
| Renderer | Instance tree, props updates, slots, context, lifecycle order, cleanup, error boundaries, batching, nested mount, parentEl |
| Store | Async actions, transactions/rollback, selectors, persistence/migration, deep freeze, concurrency (two actions interleaved) |
| Router | Nested routes, specificity, params/query encoding, async guards, redirects, 404, history/hash, back/forward, scroll/focus |
| SSR | String/stream, hydration equivalence, mismatch diagnostics, no DOM globals, streaming, head/meta |
| Security | Malicious spec suite: script, inline handlers, javascript: URLs, iframe/srcdoc, prototype pollution, depth/size bombs, snapshot exfiltration |
| A11y | axe-core on reference apps; focus trap; route announcer; live regions; keyboard-only flows |
| Memory | Mount/unmount 10k components; listener/effect/subscription counts; heap growth |
| Performance | 1k/10k rows; keyed reorder; SSR throughput; bundle size; startup |
| Token | Cheat sheet, manifest, snapshot, diff, example budgets |
| Agent eval | 20 tasks; success rate, attempts, tokens, time, interventions |

Tooling: Vitest + jsdom for unit, Playwright for browser/e2e, `fast-check` for properties, `axe-core` for a11y, a small tokenizer in devDependencies for budgets. Add coverage thresholds (90% statements for core).

### 9.3 Error taxonomy

Every error gets a code, a component path, a JSON Pointer (if spec), and a fix hint:

```
E_RENDER_THROW  TodoItem at /todos/3  "todo.text is undefined"
  fix: guard with `todo.text ?? ''` or add a resource error state
E_CATALOG_PROP  /elements/todos/props/onToggl
  fix: unknown prop; did you mean "onToggle"?
E_SPEC_DEPTH    /elements/0/children/...
  fix: depth 34 exceeds limit 16
E_ACTION_SCOPE  todo.delete  requires scope "write" (agent has "read")
```

Dev overlay optional; CLI/JSON is primary.

### 9.4 Performance strategy

- Keyed LIS reconciliation; avoid full subtree re-render.
- Batch DOM reads/writes; use `requestAnimationFrame` for visual updates, microtask for state.
- Event delegation at the app root.
- Fine-grained subscriptions: components selecting slices of the store, not the whole tree.
- Optional signals for hot leaves; keep coarse rendering as the predictable default.
- Lazy routes and code splitting; SSR streaming.
- Benchmarks against js-framework-benchmark before making performance claims.

---

## 10. Roadmap

Assumes 1–2 engineers. Effort is rough; exit criteria are the contract.

### Phase 0 — Trust (2 weeks)

**Outcome:** no known P0 bugs; the framework does what the README says.

- Fix defects #1–#9 (root replace, keyed diff, controlled inputs, styles, instance tree minimum, truthful tree, params, sanitization, devtools auth).
- Unify the three prop appliers into one DOM layer.
- Add `destroy()`, per-instance cleanup, stable IDs.
- Fix router guard fail-open, unknown route, hash flag.
- Add property-based diff tests, keyed reorder/focus, security suite.
- Make `getComponentTree` truthful or remove it until it is.

**Exit:** 200+ tests; malicious spec suite passes; no P0 in audit; example no longer needs controlled-input workaround.

### Phase 1 — Agent contract (3 weeks)

**Outcome:** an agent can build, operate, and verify an app without reading source or using a browser.

- Flat IR + catalog + validation.
- Manifest, snapshot with refs, diff/pagination, `act`, `invoke`, `assert`, `state`, `nav`.
- CLI + 300-token skill + `AGENTS.md`; MCP tools thinned to 6–8.
- JSON Patch/JSONL streaming; `vio see --diff` default.
- Token budgets in CI; 20-task agent eval harness.
- Devtools auth/origin/rate limits.

**Exit:** 20-item snapshot ≤400 tokens; diff ≤80; agent completes CRUD scenario with 0 selectors; eval ≥90% success; tokens ≤50% of a Playwright-driven React baseline.

### Phase 2 — Baseline parity (6–8 weeks)

**Outcome:** the five reference apps are credible.

- Props/state/slots/context/error boundaries (full).
- Nested router + loaders/guards/redirects/404 + history mode.
- Resources/mutations/cache/optimistic/offline queue.
- Schema forms + validation + file upload + server errors.
- SSR + hydration + head/meta + static export.
- Scoped styling + tokens + dark mode.
- A11y primitives + i18n + testing library.
- TypeScript generics + schema generation.

**Exit:** feature matrix meets the target subset; Lighthouse ≥95 on content app; axe 0 critical; benchmark within 2x of Vue/Svelte on core operations.

### Phase 3 — Moat (8–12 weeks)

**Outcome:** capabilities the other three do not have.

- Deterministic replay/time travel + bug bundles.
- Multi-surface: HTML/email/Markdown/terminal (PDF later).
- Safe generative UI: catalog, sanitization, provenance, confirmations.
- A2UI renderer/exporter; MCP Apps host; AG-UI adapter; WebMCP auto-export.
- OpenAPI/JSON Schema → app/form/table generation.
- Permissions/audit/multi-agent scopes.
- Interop adapters for React/Vue/Svelte islands.
- Agent contract tests.

**Exit:** external agent drives a Vio app through A2UI/MCP; one spec renders to web + email + Markdown; audit log covers all write actions.

### Phase 4 — Ecosystem (ongoing)

`create-vio`, Vite plugin, VS Code/language server, devtools UI, docs/llms.txt, examples, benchmarks, community adapters, changelog/migration guides.

### What to defer or kill

- Concurrent rendering/scheduler parity with React. Not worth it now.
- A Svelte-class compiler. Keep no-build as the identity; add optional compile later.
- Reimplementing a component library. Interop + design-system catalog.
- Native/mobile. Multi-surface via HTML/Markdown/terminal first.
- GraphQL/ORM integrations until the data layer is stable.

---

## 11. Migration

### 11.1 Compatibility strategy

- Keep `defineComponent`, `createApp`, `Store`, `Router`, nested descriptors working in a `v2` compat mode.
- Normalize v2 nested trees into v3 IR internally; only the runtime changes.
- Add `render(state, ctx)` as an additive second argument (currently the unused store slot).
- Keep hash routing opt-in; new apps default to history mode.
- Version the wire format (`"vio": 3`); support reading v2 specs for one major.

### 11.2 Breaking changes (v3.0)

| Change | Migration |
|---|---|
| `getComponentTree` shape | Use `see()`/`inspect()`; keep old shape behind `legacyTree: true` for one release |
| `batch` payload `{action,value}` | Standardize `{ action, payload }`; accept both with a warning |
| `batch` atomicity | Document the new all-or-nothing semantics; tests may need updating |
| Global counter IDs | Stable path IDs; tests should not assert exact IDs |
| Router default history | Hash mode via `router: { mode: 'hash' }` |
| Props no longer merged into state | Use `ctx.props`; codemod or compat flag |
| Specs with functions/HTML | Rejected for remote specs; use catalog actions |

### 11.3 Codemod

`{ tag: 'div', props: { class: 'x' }, children: [a, b] }` → `['div.x', a, b]` (optional) or keep nested form; the runtime normalizes. The codemod is cosmetic; the important migration is handler/props separation and the new agent API.

---

## 12. File-by-file actions

| File | Action |
|---|---|
| [types.ts](../packages/vio/src/core/types.ts) | Generics for props/state; separate props/state; `ctx` with store/route/refs/slots/signal; flat IR types; action/catalog types; error codes. |
| [component.ts](../packages/vio/src/core/component.ts) | Props schema validation; registry by name; lazy components; metadata (description/slots); duplicate policy. |
| [node.ts](../packages/vio/src/core/node.ts) | Merge into one DOM layer; property/attribute/SVG/style/event semantics; remove duplicate applier. |
| [renderer.ts](../packages/vio/src/core/renderer.ts) | Instance tree; per-instance lifecycle/effects/cleanup; keyed reconcile; batching; stable IDs; error boundaries; `destroy`; snapshot hooks; sanitization boundary. |
| [diff.ts](../packages/vio/src/core/diff.ts) | Keyed LIS; property vs attribute; style diff; event cleanup; fragments/text; root replacement; property tests. |
| [app.ts](../packages/vio/src/core/app.ts) | `ctx` wiring; `destroy`; route params/404; transaction batch; manifest/see/act/assert/invoke; store subscription cleanup; fix hash flag. |
| [router.ts](../packages/vio/src/router/router.ts) | Async guards/redirects; specificity; nested routes/layouts; loaders; params/query; history/hash; 404/error; scroll/focus. |
| [store.ts](../packages/vio/src/reactivity/store.ts) | Async actions; getters/selectors; transactions/rollback; persistence; middleware; deep freeze; time travel. |
| [event-bus.ts](../packages/vio/src/runtime/event-bus.ts) | Sequence/correlation IDs; error isolation; async handlers; filters; bounded sanitized history; replay metadata. |
| [http/client.ts](../packages/vio/src/http/client.ts) | Abort/timeout/retry; error body; query; FormData; credentials; async interceptors; typed errors; export types. |
| [form.ts](../packages/vio/src/forms/form.ts) | Standard Schema/Zod; touched/dirty/errors; async validation; submit states; bindings; a11y; observable state. |
| [index.ts](../packages/vio/src/index.ts) | Subpath exports (`vio/core`, `vio/router`, `vio/data`, `vio/test`); version; compat entry. |
| [tools.ts](../packages/vio-devtools/src/tools.ts) | 6–8 tools; manifest/see/act/invoke/assert/state/nav; structured errors; redaction; permissions. |
| [client.ts](../packages/vio-devtools/src/client.ts) | Reconnect/backoff; auth token; origin check; request queue; event streaming; no destructive root removal by default. |
| [ws-bridge.ts](../packages/vio-devtools/src/ws-bridge.ts) | Auth handshake; single-client policy; backpressure; timeouts; structured errors. |
| [package.json](../packages/vio/package.json) | `sideEffects: false`; subpath exports; engines; optional peer deps; publish config. |

---

## 13. References

**Agent UI standards**

- Google, [Introducing A2UI: An open project for agent-driven interfaces](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) (Dec 2025).
- Google, [A2UI v0.9: The New Standard for Portable, Framework-Agnostic Generative UI](https://developers.googleblog.com/a2ui-v0-9-generative-ui/) (Apr 2026).
- Model Context Protocol, [SEP-1865: MCP Apps — Interactive User Interfaces for MCP](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).
- Vercel Labs, [json-render — Specs](https://json-render.dev/docs/specs), [Catalog](https://json-render.dev/docs/catalog), [AI SDK](https://json-render.dev/docs/ai-sdk).
- Chrome for Developers, [WebMCP](https://developer.chrome.com/docs/ai/webmcp).
- Microsoft, [Playwright MCP](https://github.com/microsoft/playwright-mcp) (accessibility snapshots, refs, CLI+skills guidance).

**Framework references**

- React, [React reference](https://react.dev/reference/react) and [Server Components](https://react.dev/reference/rsc/server-components).
- Vue, [Vue guide](https://vuejs.org/guide/).
- Svelte, [Svelte docs](https://svelte.dev/docs/svelte/overview).

**Repo evidence**

- [README.md](../README.md)
- [app.ts](../packages/vio/src/core/app.ts)
- [renderer.ts](../packages/vio/src/core/renderer.ts)
- [diff.ts](../packages/vio/src/core/diff.ts)
- [router.ts](../packages/vio/src/router/router.ts)
- [store.ts](../packages/vio/src/reactivity/store.ts)
- [starter main.ts](../examples/starter/src/main.ts)

---

## Appendix A — Proposed agent cheat sheet

See [vio-agent-cheatsheet.md](./vio-agent-cheatsheet.md) (274 tokens, measured). It is the entire contract an agent needs to start; everything else is discovered through `vio_manifest` and `vio_see`.

## Appendix B — Benchmark sources

The token measurements are reproducible from the snippets in this document:

- Counter: React/Vue/Svelte/Vio v2/Vio terse/Vio HTML.
- Filtered list: same five.
- Snapshot formats: 20 todos, nested tree, flat tree, aria snapshot, compact snapshot, diff.
- Semantic spec: `TodoList` + `$state` + `$action` (106 tokens).
- Tools: current 11 vs proposed 6.

Use `gpt-tokenizer` (o200k_base) and record the exact files/commit. Re-run on every release; models and docs drift.

## Appendix C — Immediate next steps

1. **Decide** on the v3 direction (flat IR + catalog + agent protocol) and the authoring experiment.
2. **Implement Phase 0** behind the current API; do not add features until the P0 bugs are fixed.
3. **Build the eval harness** (20 tasks, 3 frameworks, token/attempt/time metrics) before claiming token efficiency.
4. **Ship the cheat sheet + `AGENTS.md` + `vio check --tokens`** early; they guide every later decision.
5. **Pick the five reference apps**; completeness is defined by them, not by a feature checklist.

The core idea — a tiny, deterministic, inspectable UI runtime for agents — is worth building. The current implementation needs to earn the README before it can earn the market.
