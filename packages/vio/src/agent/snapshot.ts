import { listenedEvents } from '../core/dom'

// Compact, ref-addressed text view of the live DOM for agents. One line per
// meaningful element; layout wrappers are flattened and their text bubbles up
// to the nearest shown ancestor. Refs stay stable while the element exists.

export interface SeeOptions {
  /** Only lines changed since the previous snapshot of the same scope. */
  diff?: boolean
  /** Scope the snapshot to this ref's subtree. */
  ref?: string
  /** Max nesting shown; deeper lines collapse into `(+N)`. Default 12. */
  depth?: number
  /** Which page of long child lists to show. Default 0. */
  page?: number
  /** Children shown per parent before paging. Default 50. */
  pageSize?: number
}

export type ActKind = 'click' | 'fill' | 'check' | 'uncheck' | 'select' | 'press' | 'focus' | 'blur' | 'hover' | 'submit'

export const ACT_KINDS: ActKind[] = ['click', 'fill', 'check', 'uncheck', 'select', 'press', 'focus', 'blur', 'hover', 'submit']

interface SnapNode {
  ref: string
  role: string
  el: Element
  text: string[]
  children: SnapNode[]
  hidden: number
}

interface Shown {
  line: string
  parent: string
  prev: string
}

const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'head'])
const TEXT_ROLES = new Set(['textbox', 'select'])
const LANDMARK_TAGS: Record<string, string> = { nav: 'nav', main: 'main', form: 'form', dialog: 'dialog', table: 'table', tr: 'row', td: 'cell', th: 'cell', ul: 'list', ol: 'list', li: 'item', details: 'details', summary: 'summary' }
const MAX_NAME = 60

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'a' && el.hasAttribute('href')) return 'link'
  if (tag === 'button') return 'button'
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type
    if (type === 'hidden') return null
    if (type === 'checkbox' || type === 'radio') return type
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  if (tag === 'textarea') return 'textbox'
  if (tag === 'select') return 'select'
  if (/^h[1-6]$/.test(tag)) return tag
  if (tag === 'img') return 'img'
  if (tag in LANDMARK_TAGS) return LANDMARK_TAGS[tag]!
  if (/^(header|footer|aside|section|article)$/.test(tag) && el.hasAttribute('aria-label')) return tag
  if (listenedEvents(el).length > 0 || el.hasAttribute('tabindex')) return tag
  return null
}

function isHidden(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true
  if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return true
  return (el as HTMLElement).style?.display === 'none'
}

function clip(text: string, max = MAX_NAME): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function quote(text: string): string {
  return '"' + text.replace(/"/g, "'") + '"'
}

function labelFor(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const label = (el as HTMLInputElement).labels?.[0]
  if (label?.textContent) return label.textContent
  return el.getAttribute('placeholder') ?? el.getAttribute('title') ?? ''
}

export class Snapshotter {
  private refs = new WeakMap<Element, string>()
  private byRef = new Map<string, Element>()
  private counter = 0
  private baselines = new Map<string, { header: string; shown: Map<string, Shown> }>()

  constructor(private root: Element, private header: () => string) {}

  refOf(el: Element): string {
    let ref = this.refs.get(el)
    if (!ref) {
      ref = 'e' + ++this.counter
      this.refs.set(el, ref)
      this.byRef.set(ref, el)
    }
    return ref
  }

  /**
   * Ref for a query: `role[.class…][:name]`, e.g. `button:Add`, `textbox`,
   * `button.delete`, `group:Eggs>button.toggle`, `e20>button`. Names match exactly
   * (case-insensitive) first, then by substring. `>` narrows to descendants of
   * the previous match. Fails with the candidates listed when nothing or more
   * than one element matches.
   */
  find(query: string): string {
    let scope = [this.build(this.root, 'app')]
    const parts = query.split('>').map(p => p.trim())
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      // A ref as a scope step (`e20>button.delete`) narrows to that element.
      if (/^e\d+$/.test(part)) {
        const found: SnapNode[] = []
        const byRef = (n: SnapNode) => { if (n.ref === part) found.push(n); n.children.forEach(byRef) }
        scope.forEach(byRef)
        if (!found.length) throw new Error(`E_REF: ${part} is unknown or no longer on the page; call see() for fresh refs`)
        scope = found
        if (i === parts.length - 1) return part
        continue
      }
      const colon = part.indexOf(':')
      const [role = '', ...classes] = (colon < 0 ? part : part.slice(0, colon)).trim().split('.')
      const name = colon < 0 ? null : part.slice(colon + 1).trim().toLowerCase()
      const candidates: SnapNode[] = []
      const fits = (c: SnapNode) => c.role === role && classes.every(cls => c.el.classList.contains(cls))
      const collect = (n: SnapNode) => n.children.forEach(c => { if (fits(c)) candidates.push(c); collect(c) })
      scope.forEach(collect)
      let matches = candidates
      if (name !== null) {
        const named = candidates.map(c => [c, clip(nameOf(c), 200).toLowerCase()] as const)
        const exact = named.filter(([, n]) => n === name).map(([c]) => c)
        matches = exact.length ? exact : named.filter(([, n]) => n.includes(name)).map(([c]) => c)
      }
      const within = i > 0 ? ` inside ${parts.slice(0, i).join('>')}` : ''
      if (matches.length === 0) throw new Error(`E_FIND: no ${part}${within}; call see() to check roles and names`)
      if (matches.length > 1 && i === parts.length - 1) {
        const list = matches.slice(0, 5).map(m => this.line(m, '')).join('; ')
        throw new Error(`E_AMBIGUOUS: ${part}${within} matches ${matches.length}: ${list}${matches.length > 5 ? '; …' : ''}. Add :name, .class, or a parent> scope, or use a ref`)
      }
      scope = matches
    }
    return scope[0]!.ref
  }

  /** Element for a ref (`e12`) or a `role:name` query, or a repair hint when it is gone. */
  resolve(ref: string): Element {
    if (!/^e\d+$/.test(ref)) ref = this.find(ref)
    const el = this.byRef.get(ref)
    if (!el || !el.isConnected) {
      throw new Error(`E_REF: ${ref} is unknown or no longer on the page; call see() for fresh refs`)
    }
    return el
  }

  see(opts: SeeOptions = {}): string {
    const scopeEl = opts.ref ? this.resolve(opts.ref) : this.root
    const tree = this.build(scopeEl, opts.ref ? undefined : 'app')
    const depth = opts.depth ?? 12
    const pageSize = opts.pageSize ?? 50
    const page = opts.page ?? 0

    const lines: string[] = []
    const shown = new Map<string, Shown>()
    const emit = (node: SnapNode, level: number, parent: string, prev: string, parentName: string) => {
      const line = this.line(node, parentName)
      shown.set(node.ref, { line, parent, prev })
      const kids = node.children
      if (level >= depth && kids.length > 0) {
        lines.push(' '.repeat(level) + line + ` (+${countAll(kids)})`)
        return
      }
      // A few leaf children read fine on their parent's line and save a line each.
      if (kids.length > 0 && kids.length <= INLINE_MAX && level > 0 && kids.every(k => k.children.length === 0)) {
        let before = ''
        const inline = kids.map(kid => {
          const kidLine = this.line(kid, nameOf(node))
          shown.set(kid.ref, { line: kidLine, parent: node.ref, prev: before })
          before = kid.ref
          return kidLine
        })
        lines.push(' '.repeat(level) + line + ': ' + inline.join(', '))
        return
      }
      lines.push(' '.repeat(level) + line)
      const start = kids.length > pageSize ? page * pageSize : 0
      const slice = kids.slice(start, start + pageSize)
      let before = ''
      for (const kid of slice) {
        emit(kid, level + 1, node.ref, before, nameOf(node))
        before = kid.ref
      }
      const rest = kids.length - start - slice.length
      if (rest > 0) lines.push(' '.repeat(level + 1) + `… ${rest} more (page=${page + 1})`)
    }
    emit(tree, 0, '', '', '')

    this.prune()
    const header = this.header()
    const key = JSON.stringify([opts.ref ?? '', depth, page, pageSize])
    const baseline = this.baselines.get(key)
    this.baselines.set(key, { header, shown })

    if (opts.diff && baseline) return diffLines(baseline, { header, shown })
    return [header, ...lines].join('\n')
  }

  /** Number of shown elements with this role under the root. */
  count(role: string): number {
    const visit = (n: SnapNode): number => (n.role === role ? 1 : 0) + n.children.reduce((s, c) => s + visit(c), 0)
    return visit(this.build(this.root, 'app'))
  }

  /** Forget all diff baselines (e.g. after navigation the agent wants a full view). */
  reset(): void {
    this.baselines.clear()
  }

  private prune(): void {
    for (const [ref, el] of this.byRef) if (!el.isConnected) this.byRef.delete(ref)
  }

  private build(scope: Element, rootRole?: string): SnapNode {
    const top: SnapNode = { ref: this.refOf(scope), role: rootRole ?? roleOf(scope) ?? scope.tagName.toLowerCase(), el: scope, text: [], children: [], hidden: 0 }
    const walk = (el: Element, owner: SnapNode) => {
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 3) {
          const t = child.textContent?.trim()
          if (t) owner.text.push(t)
          continue
        }
        if (child.nodeType !== 1) continue
        const c = child as Element
        if (isHidden(c)) continue
        const role = roleOf(c)
        if (role) {
          const node: SnapNode = { ref: this.refOf(c), role, el: c, text: [], children: [], hidden: 0 }
          owner.children.push(node)
          walk(c, node)
          continue
        }
        // Plain wrapper (div, span…), classified after walking it:
        // - text only: inline tags and content-named owners (button, link…)
        //   absorb it as their name; otherwise it becomes a `text` line.
        // - text plus a few leaf controls (a div-based list row): a `group`
        //   named by the text, so the controls keep their label.
        // - anything else is flattened away.
        const probe: SnapNode = { ref: '', role: '', el: c, text: [], children: [], hidden: 0 }
        walk(c, probe)
        const texts = probe.children.filter(k => k.role === 'text')
        const controls = probe.children.filter(k => k.role !== 'text')
        const allText = [...probe.text, ...texts.flatMap(k => k.text)]
        if (controls.length === 0) {
          if (allText.length === 0) continue
          if (INLINE_TAGS.has(c.tagName.toLowerCase()) || CONTENT_NAMED.test(owner.role)) owner.text.push(...allText)
          else owner.children.push({ ...probe, ref: this.refOf(c), role: 'text', text: allText, children: [] })
        } else if (allText.length > 0 && controls.every(k => k.children.length === 0)) {
          owner.children.push({ ...probe, ref: this.refOf(c), role: 'group', text: allText, children: controls })
        } else {
          if (probe.text.length > 0) owner.children.push({ ...probe, ref: this.refOf(c), role: 'text', children: [] })
          owner.children.push(...probe.children)
        }
      }
    }
    walk(scope, top)
    return top
  }

  /** One element as `ref role .classes "name" extras`. A name equal to the parent's is omitted. */
  private line(node: SnapNode, parentName: string): string {
    const el = node.el
    const parts = [`${node.ref} ${node.role}`]

    const cls = el.getAttribute('class')
    if (cls) parts.push(cls.trim().split(/\s+/).slice(0, 3).map(c => '.' + c).join(''))

    // Errors are the one thing an agent must read in full.
    const name = clip(nameOf(node), node.role === 'alert' ? 600 : MAX_NAME)
    if (name && name !== clip(parentName)) parts.push(quote(name))
    // A labelled container (section aria-label="Cart") still shows its own text.
    if (el.hasAttribute('aria-label') && node.text.length && !CONTENT_NAMED.test(node.role) && !TEXT_ROLES.has(node.role)) {
      parts.push(quote(clip(node.text.join(' '))))
    }

    if (node.role === 'textbox' || node.role === 'select') {
      const field = el as HTMLInputElement
      const secret = field.type === 'password' || el.hasAttribute('data-vio-redact')
      parts.push('val=' + quote(secret ? (field.value ? '***' : '') : clip(field.value, 40)))
    }
    if (node.role === 'link') {
      const href = el.getAttribute('href')
      if (href) parts.push('->' + clip(href, 40))
    }

    const flags: string[] = []
    if ((el as HTMLInputElement).checked) flags.push('checked')
    if ((el as HTMLButtonElement).disabled) flags.push('disabled')
    for (const a of ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-current']) {
      const v = el.getAttribute(a)
      if (v && v !== 'false') flags.push(a.slice(5) + (v === 'true' ? '' : '=' + v))
    }
    if (flags.length) parts.push(`[${flags.join(',')}]`)

    if (!/^(button|link|textbox|checkbox|radio|select|item|row|cell|summary|h[1-6])$/.test(node.role)) {
      const events = listenedEvents(el).filter(e => e !== 'input' && e !== 'change')
      if (events.length && !/^(form|dialog)$/.test(node.role)) parts.push('on:' + events.join(','))
    }
    return parts.join(' ')
  }

  act(ref: string, kind: ActKind, value?: string): void {
    const el = this.resolve(ref) as HTMLElement
    if ((el as HTMLButtonElement).disabled) throw new Error(`E_DISABLED: ${ref} is disabled`)
    const fire = (type: string, init: EventInit = {}) => el.dispatchEvent(new Event(type, { bubbles: true, ...init }))
    const field = el as HTMLInputElement

    switch (kind) {
      case 'click':
        el.click()
        break
      case 'fill': {
        if (!('value' in el)) throw new Error(`E_ACT: ${ref} is not a text field; fill needs a textbox`)
        el.focus?.()
        field.value = value ?? ''
        fire('input')
        fire('change')
        break
      }
      case 'check':
      case 'uncheck':
        if (!('checked' in el)) throw new Error(`E_ACT: ${ref} is not a checkbox or radio`)
        if (field.checked !== (kind === 'check')) el.click()
        break
      case 'select': {
        const select = el as unknown as HTMLSelectElement
        if (!select.options) throw new Error(`E_ACT: ${ref} is not a select`)
        const values = Array.from(select.options).map(o => o.value)
        if (!values.includes(value ?? '')) throw new Error(`E_VALUE: "${value}" is not an option of ${ref}; options: ${values.join(', ')}`)
        select.value = value!
        fire('input')
        fire('change')
        break
      }
      case 'press': {
        const key = value ?? 'Enter'
        el.focus?.()
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
        // Synthetic events skip default actions; emulate implicit form submission.
        const form = el.closest('form')
        if (key === 'Enter' && form && el.tagName === 'INPUT') submit(form)
        break
      }
      case 'focus':
        el.focus()
        break
      case 'blur':
        el.blur()
        break
      case 'hover':
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        el.dispatchEvent(new MouseEvent('mouseenter'))
        break
      case 'submit': {
        const form = el.closest('form')
        if (!form) throw new Error(`E_ACT: ${ref} is not inside a form`)
        submit(form)
        break
      }
      default:
        throw new Error(`E_ACT: unknown action "${kind}"; use ${ACT_KINDS.join(', ')}`)
    }
  }
}

function submit(form: HTMLFormElement): void {
  if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

const INLINE_MAX = 4
const INLINE_TAGS = new Set(['span', 'b', 'strong', 'em', 'i', 'small', 'code', 'label', 'abbr', 'mark', 's', 'u', 'sub', 'sup', 'time', 'kbd', 'q', 'cite'])
// Roles whose accessible name is their text content.
const CONTENT_NAMED = /^(button|link|h[1-6]|item|cell|option|summary|tab|menuitem|status|alert)$/

function nameOf(node: SnapNode): string {
  const el = node.el
  if (TEXT_ROLES.has(node.role) || node.role === 'checkbox' || node.role === 'radio') return labelFor(el)
  if (node.role === 'img') return el.getAttribute('alt') ?? ''
  return el.getAttribute('aria-label') ?? node.text.join(' ')
}

function countAll(nodes: SnapNode[]): number {
  return nodes.reduce((n, c) => n + 1 + countAll(c.children), 0)
}

function diffLines(
  before: { header: string; shown: Map<string, Shown> },
  after: { header: string; shown: Map<string, Shown> }
): string {
  const out: string[] = []
  if (before.header !== after.header) out.push('~ ' + after.header)
  for (const [ref, now] of after.shown) {
    const was = before.shown.get(ref)
    if (!was) out.push(`+ ${now.line} in ${now.parent || 'root'}${now.prev ? ' after ' + now.prev : ''}`)
    else if (was.line !== now.line) out.push('~ ' + now.line)
    else if (was.parent !== now.parent || (was.prev !== now.prev && (now.prev === '' || before.shown.has(now.prev)) && (was.prev === '' || after.shown.has(was.prev)))) out.push(`~ ${ref} moved ${now.prev ? 'after ' + now.prev : 'first'} in ${now.parent || 'root'}`)
  }
  for (const [ref, was] of before.shown) {
    if (!after.shown.has(ref)) out.push('- ' + was.line.split(' ').slice(0, 2).join(' '))
  }
  return out.length ? out.join('\n') : 'no changes'
}
