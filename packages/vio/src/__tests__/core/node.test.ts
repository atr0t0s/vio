import { describe, it, expect } from 'vitest'
import { createElement } from '../../core/node'
import type { VioNodeDescriptor } from '../../core/types'

describe('createElement', () => {
  it('creates an element from a simple descriptor', () => {
    const desc: VioNodeDescriptor = { tag: 'div', props: { id: 'test' }, children: ['Hello'] }
    const el = createElement(desc)
    expect(el).toBeInstanceOf(HTMLDivElement)
    expect(el.id).toBe('test')
    expect(el.textContent).toBe('Hello')
  })

  it('creates nested elements', () => {
    const desc: VioNodeDescriptor = {
      tag: 'ul',
      children: [
        { tag: 'li', children: ['Item 1'] },
        { tag: 'li', children: ['Item 2'] }
      ]
    }
    const el = createElement(desc)
    expect(el.tagName).toBe('UL')
    expect(el.children).toHaveLength(2)
    expect(el.children[0]!.textContent).toBe('Item 1')
  })

  it('sets attributes from props', () => {
    const desc: VioNodeDescriptor = {
      tag: 'input',
      props: { type: 'text', class: 'form-input', 'data-id': '123' }
    }
    const el = createElement(desc) as HTMLInputElement
    expect(el.type).toBe('text')
    expect(el.className).toBe('form-input')
    expect(el.dataset.id).toBe('123')
  })

  it('attaches event listeners from on* props', () => {
    let clicked = false
    const desc: VioNodeDescriptor = {
      tag: 'button',
      props: { onClick: () => { clicked = true } },
      children: ['Click']
    }
    const el = createElement(desc)
    el.click()
    expect(clicked).toBe(true)
  })

  it('handles boolean, null, undefined children by skipping them', () => {
    const desc: VioNodeDescriptor = {
      tag: 'div',
      children: ['visible', null, undefined, false, 0, '']
    }
    const el = createElement(desc)
    expect(el.textContent).toBe('visible0')
  })

  it('handles missing children and props gracefully', () => {
    const desc: VioNodeDescriptor = { tag: 'br' }
    const el = createElement(desc)
    expect(el.tagName).toBe('BR')
  })
})
