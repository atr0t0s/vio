import { describe, it, expect } from 'vitest'
import { VERSION } from '../index'

describe('Vio setup', () => {
  it('exports a version string', () => {
    expect(VERSION).toBe('2.0.0')
  })
})
