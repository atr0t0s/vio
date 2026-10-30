// Single DOM layer: every element creation and prop write goes through here,
// so create-time and update-time semantics cannot drift apart.

export type UnsafeReporter = (reason: string, detail: Record<string, unknown>) => void

const SVG_NS = 'http://www.w3.org/2000/svg'
const MATH_NS = 'http://www.w3.org/1998/Math/MathML'

// Tags that execute code or change document-level behavior. Never created.
const BLOCKED_TAGS = new Set(['script', 'base', 'meta', 'object', 'embed', 'frame', 'frameset', 'applet'])

// Props that inject raw markup or documents. Never applied.
const BLOCKED_PROPS = new Set(['innerhtml', 'outerhtml', 'srcdoc', 'dangerouslysetinnerhtml'])

const URL_PROPS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'background', 'cite', 'ping'])

// Live DOM properties that must track state, not just the initial attribute.
const CONTROLLED_PROPS = new Set(['value', 'checked', 'selected', 'indeterminate', 'muted'])

const IGNORED_PROPS = new Set(['key', 'ref', 'children'])

const LISTENERS = Symbol('vio.listeners')
const CONTROLLED = Symbol('vio.controlled')

type ListenerHost = Element & {
  [LISTENERS]?: Record<string, EventListener | null>
  [CONTROLLED]?: Record<string, unknown>
}

export function childNamespace(tag: string, parentNs: string | null): string | null {
  if (tag === 'svg') return SVG_NS
  if (tag === 'math') return MATH_NS
  if (parentNs === SVG_NS && tag === 'foreignObject') return SVG_NS
  return parentNs
}

/** Namespace the children of `tag` should be created in. */
export function namespaceForChildren(tag: string, ns: string | null): string | null {
  if (ns === SVG_NS && tag === 'foreignObject') return null
  return ns
}

export function isBlockedTag(tag: string): boolean {
  return BLOCKED_TAGS.has(tag.toLowerCase())
}

export function createDomElement(tag: string, ns: string | null): Element {
  return ns ? document.createElementNS(ns, tag) : document.createElement(tag)
}

export function isUnsafeUrl(value: string): boolean {
  // Browsers ignore control chars and whitespace inside the scheme.
  const v = value.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase()
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return true
  if (v.startsWith('data:') && !v.startsWith('data:image/')) return true
  return false
}

function isEventProp(key: string): boolean {
  return key.length > 2 && key[0] === 'o' && key[1] === 'n'
}

function setEvent(el: ListenerHost, key: string, value: unknown): void {
  const type = key.slice(2).toLowerCase()
  const map = (el[LISTENERS] ??= {})
  const had = type in map && map[type] !== null
  if (typeof value === 'function') {
    // One stable listener per type; swapping handlers is a field write.
    if (!had) {
      el.addEventListener(type, dispatchEvent)
    }
    map[type] = value as EventListener
  } else if (had) {
    el.removeEventListener(type, dispatchEvent)
    map[type] = null
  }
}

function dispatchEvent(this: ListenerHost, event: Event): void {
  const handler = this[LISTENERS]?.[event.type]
  if (handler) handler.call(this, event)
  // Renders are synchronous, so by now state has been applied. If the handler
  // did not accept the user's edit, put the controlled value back (like React).
  const wanted = this[CONTROLLED]
  if (wanted) for (const key in wanted) writeControlled(this, key, wanted[key])
}

function writeControlled(el: Element, key: string, next: unknown): void {
  const live = el as unknown as Record<string, unknown>
  if (key === 'value') {
    const v = next === null || next === undefined ? '' : String(next)
    if (live.value !== v) live.value = v
  } else {
    const v = Boolean(next)
    if (live[key] !== v) live[key] = v
  }
}

function classValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(classValue).filter(Boolean).join(' ')
  if (value && typeof value === 'object') {
    return Object.entries(value).filter(([, on]) => on).map(([name]) => name).join(' ')
  }
  return value === null || value === undefined || value === false ? '' : String(value)
}

function setStyle(el: HTMLElement | SVGElement, next: unknown, prev: unknown): void {
  const style = el.style
  if (typeof next === 'string' || next === null || next === undefined || next === false) {
    style.cssText = typeof next === 'string' ? next : ''
    return
  }
  const nextObj = next as Record<string, unknown>
  const prevObj = (prev && typeof prev === 'object' ? prev : {}) as Record<string, unknown>
  if (typeof prev === 'string') style.cssText = ''
  for (const name of Object.keys(prevObj)) {
    if (!(name in nextObj)) writeStyle(style, name, null)
  }
  for (const [name, value] of Object.entries(nextObj)) {
    if (value !== prevObj[name] || typeof prev === 'string') writeStyle(style, name, value)
  }
}

function writeStyle(style: CSSStyleDeclaration, name: string, value: unknown): void {
  const v = value === null || value === undefined || value === false ? '' : String(value)
  if (name.includes('-')) {
    if (v === '') style.removeProperty(name)
    else style.setProperty(name, v)
  } else {
    (style as unknown as Record<string, string>)[name] = v
  }
}

/**
 * Apply one prop to an element. `prev` is the previously rendered value
 * (undefined on create). Unsafe values are dropped and reported, never applied.
 */
export function setProp(el: Element, key: string, next: unknown, prev: unknown, report?: UnsafeReporter): void {
  if (IGNORED_PROPS.has(key)) return
  const lower = key.toLowerCase()

  if (BLOCKED_PROPS.has(lower)) {
    if (next !== undefined && next !== null) report?.('blocked-prop', { tag: el.tagName.toLowerCase(), prop: key })
    return
  }

  if (isEventProp(lower)) {
    if (typeof next === 'string') {
      report?.('inline-handler', { tag: el.tagName.toLowerCase(), prop: key })
      return
    }
    setEvent(el, lower, next)
    return
  }

  if (key === 'class' || key === 'className') {
    const v = classValue(next)
    if (el instanceof HTMLElement) el.className = v
    else if (v) el.setAttribute('class', v)
    else el.removeAttribute('class')
    return
  }

  if (key === 'style') {
    setStyle(el as HTMLElement, next, prev)
    return
  }

  if (CONTROLLED_PROPS.has(key) && key in el) {
    const host = el as ListenerHost
    if (next === undefined) {
      if (host[CONTROLLED]) delete host[CONTROLLED][key]
    } else {
      (host[CONTROLLED] ??= {})[key] = next
    }
    writeControlled(el, key, next)
    return
  }

  if (next === null || next === undefined || next === false) {
    el.removeAttribute(key)
    return
  }

  const value = next === true ? '' : String(next)
  if (URL_PROPS.has(lower) && isUnsafeUrl(value)) {
    report?.('unsafe-url', { tag: el.tagName.toLowerCase(), prop: key })
    el.removeAttribute(key)
    return
  }
  el.setAttribute(key, value)
}

export function isControlledProp(key: string): boolean {
  return CONTROLLED_PROPS.has(key)
}

/** Apply a full prop diff. Controlled props are always re-synced against the live DOM. */
export function updateProps(
  el: Element,
  next: Record<string, unknown>,
  prev: Record<string, unknown>,
  report?: UnsafeReporter
): void {
  for (const key of Object.keys(prev)) {
    if (!(key in next)) setProp(el, key, undefined, prev[key], report)
  }
  for (const [key, value] of Object.entries(next)) {
    if (value !== prev[key] || CONTROLLED_PROPS.has(key)) setProp(el, key, value, prev[key], report)
  }
}

/** Event types this element has a live handler for (used by agent snapshots). */
export function listenedEvents(el: Element): string[] {
  const map = (el as ListenerHost)[LISTENERS]
  return map ? Object.keys(map).filter(type => map[type]) : []
}
