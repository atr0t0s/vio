import { describe, it, expect } from 'vitest'
import type { VioNodeDescriptor, ComponentDef, ComponentContext } from '../../core/types'

describe('Core types', () => {
  it('accepts a valid node descriptor', () => {
    const node: VioNodeDescriptor = {
      tag: 'div',
      props: { class: 'container', id: 'main' },
      children: [
        { tag: 'h1', children: ['Hello'] },
        'plain text',
        { tag: 'span', props: { style: 'color:red' }, children: [] }
      ]
    }
    expect(node.tag).toBe('div')
    expect(node.children).toHaveLength(3)
  })

  it('accepts a component function as tag', () => {
    const MyComponent = (state: any) => ({ tag: 'div', children: [] })
    const node: VioNodeDescriptor = {
      tag: MyComponent,
      props: { title: 'Hello' },
      children: []
    }
    expect(typeof node.tag).toBe('function')
  })

  it('allows children to be omitted', () => {
    const node: VioNodeDescriptor = { tag: 'br' }
    expect(node.tag).toBe('br')
    expect(node.children).toBeUndefined()
  })
})
