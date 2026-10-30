import type { ComponentContext, ComponentDef, VioChild, VioNodeDescriptor } from '../core/types'
import { defineComponent } from '../core/component'
import { getPointer } from '../agent/protocol'
import { describeCatalog } from './catalog'
import type { Catalog } from './catalog'
import { validateSpec, formatErrors } from './validate'
import type { Spec, SpecError, SpecNode, ValidateOptions } from './validate'

interface Scope {
  store: Record<string, unknown>
  item: unknown
  dispatch: (action: string, payload?: unknown) => void
}

function isExpr(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && ('$state' in v || '$item' in v || '$action' in v || '$event' in v)
}

function resolve(v: unknown, scope: Scope, event?: unknown): unknown {
  if (isExpr(v)) {
    if ('$state' in v) return getPointer(scope.store, v.$state as string)
    if ('$item' in v) return getPointer(scope.item, (v.$item as string) || '/')
    if ('$event' in v) {
      const target = (event as Event | undefined)?.target as HTMLInputElement | undefined
      return target ? target[v.$event as 'value' | 'checked'] : undefined
    }
    const name = v.$action as string
    const args = v.args
    const hasArgs = 'args' in v
    return (...callArgs: unknown[]) => {
      const first = callArgs[0]
      const isEvent = typeof Event !== 'undefined' && first instanceof Event
      // Explicit args win; otherwise pass what a catalog component called us with (not DOM events).
      const payload = hasArgs ? resolve(args, scope, isEvent ? first : undefined) : isEvent ? undefined : first
      scope.dispatch(name, payload)
    }
  }
  if (Array.isArray(v)) return v.map(x => resolve(x, scope, event))
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = resolve(x, scope, event)
    return out
  }
  return v
}

/**
 * Turn a validated spec into a renderable descriptor. Call `validateSpec`
 * first: this function trusts the shape and only resolves expressions.
 */
export function specToNode(spec: Spec, catalog: Catalog, ctx: Pick<ComponentContext, 'store' | 'dispatch'>): VioNodeDescriptor | null {
  const build = (id: string, scope: Scope): VioChild => {
    const node = spec.nodes[id] as SpecNode
    if (node.each !== undefined) {
      const list = typeof node.each === 'string' ? getPointer(scope.store, node.each) : resolve(node.each, scope)
      if (!Array.isArray(list)) return null
      return list.map((item, i) => one(node, { ...scope, item }, node.key !== undefined ? (item as Record<string, unknown>)?.[node.key] as string : i))
    }
    return one(node, scope, undefined)
  }

  const one = (node: SpecNode, scope: Scope, key: unknown): VioNodeDescriptor => {
    const entry = catalog.components[node.type]
    const props = resolve(node.props ?? {}, scope) as Record<string, unknown>
    const kids: VioChild[] = []
    if (node.text !== undefined) {
      const text = resolve(node.text, scope)
      if (text !== undefined && text !== null) kids.push(String(text))
    }
    for (const child of node.children ?? []) kids.push(build(child, scope))
    const desc: VioNodeDescriptor = entry
      ? { tag: entry.component, props: entry.children ? { ...props, children: kids } : props }
      : { tag: node.type, props, children: kids }
    if (typeof key === 'string' || typeof key === 'number') desc.key = key
    return desc
  }

  const scope: Scope = { store: ctx.store, item: undefined, dispatch: ctx.dispatch }
  const root = build(spec.root, scope)
  return Array.isArray(root) ? { tag: 'div', children: root } : (root as VioNodeDescriptor | null)
}

export interface SpecViewOptions extends ValidateOptions {
  name?: string
  catalog: Catalog
  /** Initial spec; replace or patch it later through the component's `spec` state. */
  spec?: Spec | null
}

/**
 * A component that renders an agent-provided spec from its `spec` state (or
 * `spec` prop). Invalid specs never reach the DOM: the errors render instead,
 * as a `role="alert"` block that shows up in `app.see()`.
 */
export function defineSpecView(opts: SpecViewOptions): ComponentDef {
  const cache = new WeakMap<object, SpecError[]>()
  const check = (spec: Spec): SpecError[] => {
    let errors = cache.get(spec)
    if (!errors) {
      errors = validateSpec(spec, opts.catalog, opts)
      cache.set(spec, errors)
    }
    return errors
  }

  return defineComponent({
    name: opts.name ?? 'SpecView',
    doc: 'Renders state.spec. Edit with patchState / vio_state patch, e.g. [{op:"replace",path:"/spec",value:{...}}].\n' + describeCatalog(opts.catalog),
    state: { spec: opts.spec ?? null },
    render(state, ctx) {
      const spec = (ctx.props.spec ?? ctx.getState().spec) as Spec | null
      if (!spec) return null
      const errors = typeof spec === 'object' ? check(spec) : validateSpec(spec, opts.catalog, opts)
      if (errors.length) {
        return { tag: 'pre', props: { role: 'alert', 'data-vio-spec': 'invalid' }, children: [formatErrors(errors)] }
      }
      return specToNode(spec, opts.catalog, ctx)
    }
  })
}
