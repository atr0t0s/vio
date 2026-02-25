import type { VioNodeDescriptor, VioChild } from './types'
import { createElement } from './node'

export type PatchOp =
  | { type: 'REPLACE'; newNode: VioNodeDescriptor }
  | { type: 'PROPS'; added: Record<string, unknown>; removed: string[] }
  | { type: 'TEXT'; value: string }
  | { type: 'CHILDREN'; ops: ChildOp[] }

export type ChildOp =
  | { type: 'INSERT'; index: number; node: VioChild }
  | { type: 'REMOVE'; index: number }
  | { type: 'PATCH'; index: number; patches: PatchOp[] }
  | { type: 'REPLACE_CHILD'; index: number; node: VioChild }

export function diff(oldNode: VioNodeDescriptor, newNode: VioNodeDescriptor): PatchOp[] {
  const patches: PatchOp[] = []
  if (oldNode === newNode) return patches

  if (oldNode.tag !== newNode.tag) {
    patches.push({ type: 'REPLACE', newNode })
    return patches
  }

  const oldProps = oldNode.props ?? {}
  const newProps = newNode.props ?? {}
  const added: Record<string, unknown> = {}
  const removed: string[] = []

  for (const key of Object.keys(newProps)) {
    if (newProps[key] !== oldProps[key]) {
      added[key] = newProps[key]
    }
  }
  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps)) {
      removed.push(key)
    }
  }
  if (Object.keys(added).length > 0 || removed.length > 0) {
    patches.push({ type: 'PROPS', added, removed })
  }

  const oldChildren = oldNode.children ?? []
  const newChildren = newNode.children ?? []
  const childOps = diffChildren(oldChildren, newChildren)
  if (childOps.length > 0) {
    patches.push({ type: 'CHILDREN', ops: childOps })
  }

  return patches
}

function diffChildren(oldChildren: VioChild[], newChildren: VioChild[]): ChildOp[] {
  const ops: ChildOp[] = []
  const maxLen = Math.max(oldChildren.length, newChildren.length)

  for (let i = 0; i < maxLen; i++) {
    const oldChild = i < oldChildren.length ? oldChildren[i] : undefined
    const newChild = i < newChildren.length ? newChildren[i] : undefined

    if (oldChild === undefined || oldChild === null) {
      if (newChild !== undefined && newChild !== null) {
        ops.push({ type: 'INSERT', index: i, node: newChild })
      }
      continue
    }

    if (newChild === undefined || newChild === null) {
      ops.push({ type: 'REMOVE', index: i })
      continue
    }

    if (isPrimitive(oldChild) && isPrimitive(newChild)) {
      if (String(oldChild) !== String(newChild)) {
        ops.push({ type: 'REPLACE_CHILD', index: i, node: newChild })
      }
      continue
    }

    if (isPrimitive(oldChild) !== isPrimitive(newChild)) {
      ops.push({ type: 'REPLACE_CHILD', index: i, node: newChild })
      continue
    }

    if (isNode(oldChild) && isNode(newChild)) {
      const childPatches = diff(oldChild, newChild)
      if (childPatches.length > 0) {
        ops.push({ type: 'PATCH', index: i, patches: childPatches })
      }
    }
  }

  return ops
}

function isPrimitive(child: VioChild): child is string | number | boolean {
  return typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean'
}

function isNode(child: VioChild): child is VioNodeDescriptor {
  return typeof child === 'object' && child !== null && 'tag' in child
}

export function patch(element: HTMLElement, patches: PatchOp[]): void {
  for (const p of patches) {
    switch (p.type) {
      case 'REPLACE': {
        const newEl = createElement(p.newNode)
        element.parentNode?.replaceChild(newEl, element)
        break
      }
      case 'PROPS': {
        for (const [key, value] of Object.entries(p.added)) {
          if (key.startsWith('on') && typeof value === 'function') {
            (element as any)[key.toLowerCase()] = value
          } else if (key === 'class') {
            element.className = String(value)
          } else if (value !== null && value !== undefined && value !== false) {
            element.setAttribute(key, String(value))
          }
        }
        for (const key of p.removed) {
          if (key.startsWith('on')) {
            (element as any)[key.toLowerCase()] = null
          } else if (key === 'class') {
            element.className = ''
          } else {
            element.removeAttribute(key)
          }
        }
        break
      }
      case 'CHILDREN': {
        patchChildren(element, p.ops)
        break
      }
    }
  }
}

function patchChildren(parent: HTMLElement, ops: ChildOp[]): void {
  // Process removals in reverse order to maintain indices
  const removals = ops.filter(op => op.type === 'REMOVE').sort((a, b) => (b as any).index - (a as any).index)
  for (const op of removals) {
    if (op.type === 'REMOVE') {
      const child = parent.childNodes[op.index]
      if (child) parent.removeChild(child)
    }
  }

  for (const op of ops) {
    switch (op.type) {
      case 'INSERT': {
        const newChild = createChildElement(op.node)
        if (newChild) {
          const ref = parent.childNodes[op.index]
          if (ref) {
            parent.insertBefore(newChild, ref)
          } else {
            parent.appendChild(newChild)
          }
        }
        break
      }
      case 'REPLACE_CHILD': {
        const newChild = createChildElement(op.node)
        const oldChild = parent.childNodes[op.index]
        if (newChild && oldChild) {
          parent.replaceChild(newChild, oldChild)
        }
        break
      }
      case 'PATCH': {
        const child = parent.childNodes[op.index]
        if (child instanceof HTMLElement) {
          patch(child, op.patches)
        }
        break
      }
      case 'REMOVE':
        break // Already handled above
    }
  }
}

function createChildElement(child: VioChild): Node | null {
  if (child === null || child === undefined || child === false || child === true || child === '') {
    return null
  }
  if (typeof child === 'string') {
    return document.createTextNode(child)
  }
  if (typeof child === 'number') {
    return document.createTextNode(String(child))
  }
  if (typeof child === 'object' && 'tag' in child && typeof child.tag === 'string') {
    return createElement(child)
  }
  return null
}
