import { describe, it, expect } from 'vitest'
import { createApp, defineComponent, EventBus, Store, Router, createElement, diff, patch, ComponentRegistry, Renderer, VERSION } from '..'

describe('Public API', () => {
  it('exports createApp', () => {
    expect(typeof createApp).toBe('function')
  })

  it('exports defineComponent', () => {
    expect(typeof defineComponent).toBe('function')
  })

  it('exports EventBus', () => {
    expect(typeof EventBus).toBe('function')
  })

  it('exports Store', () => {
    expect(typeof Store).toBe('function')
  })

  it('exports Router', () => {
    expect(typeof Router).toBe('function')
  })

  it('exports createElement', () => {
    expect(typeof createElement).toBe('function')
  })

  it('exports diff and patch', () => {
    expect(typeof diff).toBe('function')
    expect(typeof patch).toBe('function')
  })

  it('exports ComponentRegistry', () => {
    expect(typeof ComponentRegistry).toBe('function')
  })

  it('exports Renderer', () => {
    expect(typeof Renderer).toBe('function')
  })

  it('exports VERSION', () => {
    expect(VERSION).toBe('2.0.0')
  })
})
