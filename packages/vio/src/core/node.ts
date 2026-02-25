import type { VioNodeDescriptor, VioChild } from './types'

export function createElement(desc: VioNodeDescriptor): HTMLElement {
  if (typeof desc.tag !== 'string') {
    throw new Error('createElement only handles string tags. Use renderComponent for component tags.')
  }

  const el = document.createElement(desc.tag)

  if (desc.props) {
    for (const [key, value] of Object.entries(desc.props)) {
      if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.slice(2).toLowerCase()
        el.addEventListener(eventName, value as EventListener)
      } else if (key === 'class') {
        el.className = String(value)
      } else if (key === 'style' && typeof value === 'object' && value !== null) {
        Object.assign(el.style, value)
      } else if (key === 'ref') {
        // refs handled by the component system, skip here
      } else if (value !== null && value !== undefined && value !== false) {
        el.setAttribute(key, String(value))
      }
    }
  }

  if (desc.children) {
    for (const child of desc.children) {
      appendChildNode(el, child)
    }
  }

  return el
}

function appendChildNode(parent: HTMLElement, child: VioChild): void {
  if (child === null || child === undefined || child === false || child === true) {
    return
  }
  if (child === '') {
    return
  }
  if (typeof child === 'string') {
    parent.appendChild(document.createTextNode(child))
  } else if (typeof child === 'number') {
    parent.appendChild(document.createTextNode(String(child)))
  } else if (typeof child === 'object' && 'tag' in child) {
    if (typeof child.tag === 'string') {
      parent.appendChild(createElement(child))
    }
    // Component tags handled elsewhere
  }
}
