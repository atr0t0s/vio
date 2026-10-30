import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Renderer } from '../../core/renderer'
import { defineComponent } from '../../core/component'
import { EventBus } from '../../runtime/event-bus'
import type { VioNodeDescriptor } from '../../core/types'

function setup(render: (s: Record<string, unknown>) => VioNodeDescriptor | null, state: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.innerHTML = ''
  document.body.appendChild(container)
  const bus = new EventBus()
  const renderer = new Renderer(container, bus)
  const inst = renderer.mount(defineComponent({ name: 'T', state, render }))
  return { container, bus, renderer, set: (p: Record<string, unknown>) => renderer.setState(inst.id, p) }
}

describe('DOM layer', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('updates style objects per property and removes dropped keys', () => {
    const { container, set } = setup(s => ({ tag: 'div', props: { style: s.style } }), { style: { color: 'red', marginTop: '2px' } })
    const el = container.firstElementChild as HTMLElement
    set({ style: { color: 'blue' } })
    expect(el.style.color).toBe('blue')
    expect(el.style.marginTop).toBe('')
    expect(el.getAttribute('style')).not.toContain('[object Object]')
  })

  it('accepts string styles and CSS custom properties', () => {
    const { container, set } = setup(s => ({ tag: 'div', props: { style: s.style } }), { style: 'color: red' })
    const el = container.firstElementChild as HTMLElement
    expect(el.style.color).toBe('red')
    set({ style: { '--gap': '4px' } })
    expect(el.style.getPropertyValue('--gap')).toBe('4px')
    expect(el.style.color).toBe('')
  })

  it('keeps input value controlled after the user types', () => {
    const { container, set } = setup(s => ({ tag: 'input', props: { value: s.v } }), { v: 'a' })
    const input = container.querySelector('input')!
    input.value = 'user typed'
    set({ v: 'b' })
    expect(input.value).toBe('b')
    input.value = 'typed again'
    set({ v: 'b', other: 1 })
    expect(input.value).toBe('b')
  })

  it('keeps checkbox checked controlled after the user clicks', () => {
    const { container, set } = setup(s => ({ tag: 'input', props: { type: 'checkbox', checked: s.on } }), { on: false })
    const box = container.querySelector('input')!
    box.click()
    expect(box.checked).toBe(true)
    set({ on: false, tick: 1 })
    expect(box.checked).toBe(false)
    set({ on: true })
    expect(box.checked).toBe(true)
  })

  it('sets select value after its options exist', () => {
    const { container } = setup(() => ({
      tag: 'select',
      props: { value: 'b' },
      children: [{ tag: 'option', props: { value: 'a' }, children: ['A'] }, { tag: 'option', props: { value: 'b' }, children: ['B'] }]
    }))
    expect(container.querySelector('select')!.value).toBe('b')
  })

  it('swaps and removes event handlers', () => {
    const a = vi.fn()
    const b = vi.fn()
    const { container, set } = setup(s => ({ tag: 'button', props: s.h ? { onClick: s.h } : {} }), { h: a })
    const btn = container.querySelector('button')!
    btn.click()
    set({ h: b })
    btn.click()
    set({ h: null })
    btn.click()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('accepts class as string, array, or object', () => {
    const { container, set } = setup(s => ({ tag: 'div', props: { class: s.c } }), { c: ['a', false, 'b'] })
    const el = container.firstElementChild!
    expect(el.className).toBe('a b')
    set({ c: { x: true, y: false } })
    expect(el.className).toBe('x')
  })

  it('handles boolean attributes', () => {
    const { container, set } = setup(s => ({ tag: 'button', props: { disabled: s.d } }), { d: true })
    const btn = container.querySelector('button')!
    expect(btn.disabled).toBe(true)
    set({ d: false })
    expect(btn.disabled).toBe(false)
  })

  it('creates SVG in the SVG namespace and foreignObject children as HTML', () => {
    const { container } = setup(() => ({
      tag: 'svg',
      children: [
        { tag: 'path', props: { d: 'M0 0', class: 'p' } },
        { tag: 'foreignObject', children: [{ tag: 'div' }] }
      ]
    }))
    const svgNs = 'http://www.w3.org/2000/svg'
    expect(container.querySelector('svg')!.namespaceURI).toBe(svgNs)
    expect(container.querySelector('path')!.namespaceURI).toBe(svgNs)
    expect(container.querySelector('path')!.getAttribute('class')).toBe('p')
    expect(container.querySelector('foreignObject div')!.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
  })
})

describe('sanitization', () => {
  it('never creates script or other blocked tags', () => {
    const { container, bus } = setup(() => ({ tag: 'div', children: [{ tag: 'script', children: ['alert(1)'] }, { tag: 'base', props: { href: '/x' } }] }))
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('base')).toBeNull()
    expect(bus.getHistory().filter(e => e.type === 'security:blocked')).toHaveLength(2)
  })

  it('drops inline string handlers and javascript: URLs', () => {
    const { container } = setup(() => ({
      tag: 'a',
      props: { href: ' JaVa\tscript:alert(1)', onclick: 'alert(1)', onmouseover: 'x()' },
      children: ['x']
    }))
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBeNull()
    expect(a.getAttribute('onclick')).toBeNull()
    expect(a.getAttribute('onmouseover')).toBeNull()
  })

  it('blocks raw HTML props and srcdoc', () => {
    const { container } = setup(() => ({ tag: 'div', children: [{ tag: 'iframe', props: { srcdoc: '<script>1</script>' } }], props: { innerHTML: '<img onerror=x>' } }))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('iframe')!.getAttribute('srcdoc')).toBeNull()
  })

  it('allows normal and data:image URLs', () => {
    const { container } = setup(() => ({ tag: 'div', children: [{ tag: 'a', props: { href: '/ok' } }, { tag: 'img', props: { src: 'data:image/png;base64,AA' } }] }))
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/ok')
    expect(container.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AA')
  })

  it('fails with E_DEPTH instead of overflowing the stack', () => {
    let node: VioNodeDescriptor = { tag: 'span' }
    for (let i = 0; i < 2000; i++) node = { tag: 'div', children: [node] }
    expect(() => setup(() => node)).toThrow(/E_DEPTH/)
  })
})
