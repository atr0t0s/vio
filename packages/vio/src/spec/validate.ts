import type { Catalog, PropType } from './catalog'

export type SpecChild = string

export interface SpecNode {
  type: string
  props?: Record<string, unknown>
  /** Text rendered before children; a string or a `$state`/`$item` expression. */
  text?: unknown
  children?: SpecChild[]
  /** Repeat this node once per item of the array at this store pointer (or `$item` expression). */
  each?: unknown
  /** Item field used as the list key when repeating with `each`. */
  key?: string
}

export interface Spec {
  vio?: 1
  root: string
  nodes: Record<string, SpecNode>
}

export interface SpecError {
  code: string
  /** JSON Pointer into the spec. */
  path: string
  message: string
}

export interface ValidateOptions {
  /** Known store action names; `$action` must use one when given. */
  actions?: string[]
  maxNodes?: number
  maxDepth?: number
  maxText?: number
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const NODE_KEYS = new Set(['type', 'props', 'text', 'children', 'each', 'key'])
const EXPR_KEYS = ['$state', '$item', '$action', '$event']
const HTML_PROPS = new Set([
  'id', 'class', 'style', 'href', 'src', 'alt', 'title', 'type', 'value', 'placeholder', 'name', 'for', 'checked',
  'disabled', 'role', 'colspan', 'rowspan', 'target', 'rel', 'width', 'height', 'min', 'max', 'step', 'rows', 'cols',
  'open', 'selected', 'multiple', 'required', 'readonly', 'maxlength', 'minlength', 'pattern', 'autocomplete', 'tabindex',
  'datetime', 'lang', 'dir', 'hidden', 'label', 'download'
])

function esc(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1')
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j]!
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1))
      prev = cur
    }
  }
  return dp[b.length]!
}

/** ` did you mean "x"?` for the closest candidate within a small edit distance. */
export function suggest(word: string, candidates: Iterable<string>): string {
  let best = ''
  let bestD = Infinity
  for (const c of candidates) {
    const d = distance(word, c)
    if (d < bestD) { best = c; bestD = d }
  }
  return best && bestD <= Math.max(2, Math.floor(word.length / 3)) ? `; did you mean "${best}"?` : ''
}

function isExpr(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && EXPR_KEYS.some(k => k in v)
}

function typeOk(type: PropType, v: unknown): boolean {
  if (Array.isArray(type)) return type.includes(v as never)
  switch (type) {
    case 'any': return true
    case 'array': return Array.isArray(v)
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v)
    case 'action': return false
    default: return typeof v === type
  }
}

function describeType(t: PropType): string {
  return Array.isArray(t) ? t.map(x => JSON.stringify(x)).join(' | ') : (t as string)
}

/** Check a spec against a catalog. Returns every problem found; empty means it is safe to render. */
export function validateSpec(spec: unknown, catalog: Catalog, opts: ValidateOptions = {}): SpecError[] {
  const errors: SpecError[] = []
  const err = (code: string, path: string, message: string) => errors.push({ code, path, message })
  const maxNodes = opts.maxNodes ?? 2000
  const maxDepth = opts.maxDepth ?? 32
  const maxText = opts.maxText ?? 10000

  // Prototype-polluting keys anywhere in the document.
  const scan = (v: unknown, path: string, depth: number) => {
    if (depth > 64 || v === null || typeof v !== 'object') return
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) err('E_SPEC_KEY', `${path}/${esc(k)}`, `key "${k}" is not allowed`)
      else scan((v as Record<string, unknown>)[k], `${path}/${esc(k)}`, depth + 1)
    }
  }
  scan(spec, '', 0)
  if (errors.length) return errors

  if (spec === null || typeof spec !== 'object') {
    err('E_SPEC_SHAPE', '', 'spec must be an object {root, nodes}')
    return errors
  }
  const s = spec as Record<string, unknown>
  const nodes = s.nodes as Record<string, unknown> | undefined
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
    err('E_SPEC_SHAPE', '/nodes', 'nodes must be an object of id → node')
    return errors
  }
  const ids = Object.keys(nodes)
  if (ids.length > maxNodes) err('E_SPEC_SIZE', '/nodes', `${ids.length} nodes exceeds limit ${maxNodes}`)
  if (typeof s.root !== 'string' || !(s.root in nodes)) {
    err('E_SPEC_ROOT', '/root', `root must name a node${typeof s.root === 'string' ? suggest(s.root, ids) : ''}`)
    return errors
  }

  const knownTypes = [...Object.keys(catalog.components), ...catalog.html]
  const actions = opts.actions ? new Set(opts.actions) : null

  const checkExpr = (v: Record<string, unknown>, path: string, inEach: boolean, allowEvent: boolean) => {
    if ('$state' in v) {
      if (typeof v.$state !== 'string' || !v.$state.startsWith('/')) err('E_SPEC_EXPR', `${path}/$state`, '$state must be a JSON Pointer like "/todos"')
    } else if ('$item' in v) {
      if (!inEach) err('E_SPEC_EXPR', `${path}/$item`, '$item is only valid inside a node with each (or its descendants)')
      else if (typeof v.$item !== 'string' || (v.$item !== '' && !v.$item.startsWith('/'))) err('E_SPEC_EXPR', `${path}/$item`, '$item must be "" or a JSON Pointer like "/id"')
    } else if ('$event' in v) {
      if (!allowEvent) err('E_SPEC_EXPR', `${path}/$event`, '$event is only valid inside $action args')
      else if (v.$event !== 'value' && v.$event !== 'checked') err('E_SPEC_EXPR', `${path}/$event`, '$event must be "value" or "checked"')
    } else if ('$action' in v) {
      if (typeof v.$action !== 'string') err('E_SPEC_EXPR', `${path}/$action`, '$action must be an action name')
      else if (actions && !actions.has(v.$action)) err('E_SPEC_ACTION', `${path}/$action`, `unknown action "${v.$action}"${suggest(v.$action, actions)}`)
      if ('args' in v) checkValue(v.args, `${path}/args`, inEach, true)
    }
  }

  const checkValue = (v: unknown, path: string, inEach: boolean, allowEvent: boolean) => {
    if (isExpr(v)) return checkExpr(v, path, inEach, allowEvent)
    if (typeof v === 'function') err('E_SPEC_VALUE', path, 'functions are not allowed in a spec; use {$action}')
    else if (Array.isArray(v)) v.forEach((x, i) => checkValue(x, `${path}/${i}`, inEach, allowEvent))
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) checkValue(x, `${path}/${esc(k)}`, inEach, allowEvent)
  }

  const seen = new Set<string>()
  const visit = (id: string, depth: number, inEach: boolean, stack: Set<string>) => {
    const path = `/nodes/${esc(id)}`
    if (stack.has(id)) return err('E_SPEC_CYCLE', path, `node "${id}" contains itself`)
    if (seen.has(id)) return err('E_SPEC_SHARED', path, `node "${id}" is used as a child more than once; give each use its own node`)
    seen.add(id)
    if (depth > maxDepth) return err('E_SPEC_DEPTH', path, `depth ${depth} exceeds limit ${maxDepth}`)

    const node = nodes[id] as SpecNode
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return err('E_SPEC_SHAPE', path, 'node must be an object with a type')
    for (const k of Object.keys(node)) {
      if (!NODE_KEYS.has(k)) err('E_SPEC_FIELD', `${path}/${esc(k)}`, `unknown node field "${k}"${suggest(k, NODE_KEYS)}`)
    }
    if (typeof node.type !== 'string') return err('E_SPEC_TYPE', `${path}/type`, 'type must be a string')

    const entry = catalog.components[node.type]
    if (!entry && !catalog.html.has(node.type)) {
      err('E_SPEC_TYPE', `${path}/type`, `"${node.type}" is not in the catalog${suggest(node.type, knownTypes)}`)
    }

    const itemScope = inEach || node.each !== undefined
    if (node.each !== undefined) {
      if (isExpr(node.each)) checkExpr(node.each, `${path}/each`, inEach, false)
      else if (typeof node.each !== 'string' || !node.each.startsWith('/')) err('E_SPEC_EXPR', `${path}/each`, 'each must be a store pointer like "/todos" or {$item}')
    }
    if (node.key !== undefined && typeof node.key !== 'string') err('E_SPEC_KEY_FIELD', `${path}/key`, 'key must be the name of an item field')

    if (node.text !== undefined) {
      if (isExpr(node.text)) checkExpr(node.text, `${path}/text`, itemScope, false)
      else if (typeof node.text !== 'string' && typeof node.text !== 'number') err('E_SPEC_TEXT', `${path}/text`, 'text must be a string, number, or {$state}/{$item}')
      else if (String(node.text).length > maxText) err('E_SPEC_TEXT', `${path}/text`, `text longer than ${maxText} characters`)
    }

    const props = node.props ?? {}
    if (typeof props !== 'object' || Array.isArray(props)) {
      err('E_SPEC_SHAPE', `${path}/props`, 'props must be an object')
    } else if (entry) {
      for (const [k, v] of Object.entries(props)) {
        const p = entry.props[k]
        const at = `${path}/props/${esc(k)}`
        if (!p) { err('E_SPEC_PROP', at, `${node.type} has no prop "${k}"${suggest(k, Object.keys(entry.props))}`); continue }
        if (p.type === 'action') {
          if (!isExpr(v) || !('$action' in v)) err('E_SPEC_PROP_TYPE', at, `${node.type}.${k} takes {$action:"name"}`)
          else checkExpr(v, at, itemScope, false)
        } else if (isExpr(v)) {
          checkExpr(v, at, itemScope, false)
        } else if (!typeOk(p.type, v)) {
          err('E_SPEC_PROP_TYPE', at, `${node.type}.${k} must be ${describeType(p.type)}, got ${JSON.stringify(v)?.slice(0, 40)}`)
        } else {
          checkValue(v, at, itemScope, false)
        }
      }
      for (const [k, p] of Object.entries(entry.props)) {
        if (p.required && !(k in props)) err('E_SPEC_REQUIRED', `${path}/props`, `${node.type} needs prop "${k}"`)
      }
    } else {
      for (const [k, v] of Object.entries(props)) {
        const at = `${path}/props/${esc(k)}`
        if (/^on[A-Z]/.test(k)) {
          if (!isExpr(v) || !('$action' in v)) err('E_SPEC_HANDLER', at, `${k} must be {$action:"name"}`)
          else checkExpr(v, at, itemScope, false)
        } else if (!HTML_PROPS.has(k) && !/^(aria|data)-[a-z0-9-]+$/.test(k)) {
          err('E_SPEC_PROP', at, `<${node.type}> prop "${k}" is not allowed${suggest(k, HTML_PROPS)}`)
        } else {
          checkValue(v, at, itemScope, false)
        }
      }
    }

    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) return err('E_SPEC_SHAPE', `${path}/children`, 'children must be an array of node ids')
      if (entry && !entry.children && node.children.length) err('E_SPEC_CHILDREN', `${path}/children`, `${node.type} does not take children`)
      stack.add(id)
      node.children.forEach((child, i) => {
        if (typeof child !== 'string' || !(child in nodes)) {
          err('E_SPEC_CHILD', `${path}/children/${i}`, `child ${JSON.stringify(child)} is not a node id${typeof child === 'string' ? suggest(child, ids) : ''}`)
        } else {
          visit(child, depth + 1, itemScope, stack)
        }
      })
      stack.delete(id)
    }
  }
  visit(s.root as string, 1, false, new Set())
  return errors
}

export function formatErrors(errors: SpecError[]): string {
  return errors.map(e => `${e.code} ${e.path || '/'}: ${e.message}`).join('\n')
}
