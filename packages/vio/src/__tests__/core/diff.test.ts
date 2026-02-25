import { describe, it, expect, beforeEach } from 'vitest'
import { diff, patch } from '../../core/diff'
import { createElement } from '../../core/node'
import type { VioNodeDescriptor } from '../../core/types'

describe('diff + patch', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  it('patches text content changes', () => {
    const oldTree: VioNodeDescriptor = { tag: 'div', children: ['Hello'] }
    const newTree: VioNodeDescriptor = { tag: 'div', children: ['World'] }

    container.appendChild(createElement(oldTree))
    const patches = diff(oldTree, newTree)
    patch(container.firstChild as HTMLElement, patches)

    expect(container.textContent).toBe('World')
  })

  it('patches prop changes', () => {
    const oldTree: VioNodeDescriptor = { tag: 'div', props: { class: 'old' } }
    const newTree: VioNodeDescriptor = { tag: 'div', props: { class: 'new' } }

    container.appendChild(createElement(oldTree))
    const patches = diff(oldTree, newTree)
    patch(container.firstChild as HTMLElement, patches)

    expect((container.firstChild as HTMLElement).className).toBe('new')
  })

  it('patches added children', () => {
    const oldTree: VioNodeDescriptor = { tag: 'ul', children: [{ tag: 'li', children: ['A'] }] }
    const newTree: VioNodeDescriptor = { tag: 'ul', children: [{ tag: 'li', children: ['A'] }, { tag: 'li', children: ['B'] }] }

    container.appendChild(createElement(oldTree))
    const patches = diff(oldTree, newTree)
    patch(container.firstChild as HTMLElement, patches)

    expect(container.firstChild!.childNodes).toHaveLength(2)
  })

  it('patches removed children', () => {
    const oldTree: VioNodeDescriptor = { tag: 'ul', children: [{ tag: 'li', children: ['A'] }, { tag: 'li', children: ['B'] }] }
    const newTree: VioNodeDescriptor = { tag: 'ul', children: [{ tag: 'li', children: ['A'] }] }

    container.appendChild(createElement(oldTree))
    const patches = diff(oldTree, newTree)
    patch(container.firstChild as HTMLElement, patches)

    expect(container.firstChild!.childNodes).toHaveLength(1)
  })

  it('replaces element when tag changes', () => {
    const oldTree: VioNodeDescriptor = { tag: 'div', children: ['content'] }
    const newTree: VioNodeDescriptor = { tag: 'span', children: ['content'] }

    container.appendChild(createElement(oldTree))
    const patches = diff(oldTree, newTree)
    patch(container.firstChild as HTMLElement, patches)

    expect((container.firstChild as HTMLElement).tagName).toBe('SPAN')
  })

  it('removes old props not in new tree', () => {
    const oldTree: VioNodeDescriptor = { tag: 'div', props: { class: 'old', id: 'remove-me' } }
    const newTree: VioNodeDescriptor = { tag: 'div', props: { class: 'new' } }

    container.appendChild(createElement(oldTree))
    const patches = diff(oldTree, newTree)
    patch(container.firstChild as HTMLElement, patches)

    expect((container.firstChild as HTMLElement).className).toBe('new')
    expect((container.firstChild as HTMLElement).id).toBe('')
  })

  it('handles identical trees with no patches', () => {
    const tree: VioNodeDescriptor = { tag: 'div', props: { id: 'same' }, children: ['Hello'] }
    const patches = diff(tree, tree)
    expect(patches).toHaveLength(0)
  })
})
