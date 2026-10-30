import type { VioNodeDescriptor, VioChild } from './types'
import { childNamespace, createDomElement, isBlockedTag, namespaceForChildren, updateProps } from './dom'
import type { UnsafeReporter } from './dom'

/** Create a static DOM tree from a descriptor. Component tags are skipped; use Renderer for those. */
export function createElement(desc: VioNodeDescriptor, report?: UnsafeReporter): Element {
  return build(desc, null, report)
}

function build(desc: VioNodeDescriptor, parentNs: string | null, report?: UnsafeReporter): Element {
  if (typeof desc.tag !== 'string') {
    throw new Error('createElement only handles string tags. Use Renderer for component tags.')
  }
  if (isBlockedTag(desc.tag)) {
    report?.('blocked-tag', { tag: desc.tag })
    throw new Error(`E_UNSAFE_TAG: <${desc.tag}> is not allowed`)
  }
  const ns = childNamespace(desc.tag, parentNs)
  const el = createDomElement(desc.tag, ns)
  const inner = namespaceForChildren(desc.tag, ns)
  for (const child of desc.children ?? []) {
    const node = buildChild(child, inner, report)
    if (node) el.appendChild(node)
  }
  // Props after children so <select value> can see its options.
  if (desc.props) updateProps(el, desc.props, {}, report)
  return el
}

export function buildChild(child: VioChild, ns: string | null, report?: UnsafeReporter): Node | null {
  if (child === null || child === undefined || child === false || child === true || child === '') return null
  if (typeof child === 'string' || typeof child === 'number') return document.createTextNode(String(child))
  if (Array.isArray(child)) {
    const frag = document.createDocumentFragment()
    for (const c of child) {
      const node = buildChild(c, ns, report)
      if (node) frag.appendChild(node)
    }
    return frag
  }
  if (typeof child === 'object' && typeof child.tag === 'string') {
    if (isBlockedTag(child.tag)) {
      report?.('blocked-tag', { tag: child.tag })
      return null
    }
    return build(child, ns, report)
  }
  return null
}
