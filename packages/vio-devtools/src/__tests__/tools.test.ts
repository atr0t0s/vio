import { describe, it, expect } from 'vitest'
import { TOOLS } from '../tools.js'

describe('tool definitions', () => {
  it('defines 11 tools', () => {
    expect(TOOLS).toHaveLength(11)
  })

  it('each tool has name, description, and wsMethod', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.wsMethod).toBeTruthy()
    }
  })

  it('vio_dispatch has action and optional payload params', () => {
    const dispatch = TOOLS.find((t) => t.name === 'vio_dispatch')!
    expect(dispatch.inputSchema.action).toBeDefined()
    expect(dispatch.inputSchema.payload).toBeDefined()
  })

  it('vio_get_store has no params', () => {
    const getStore = TOOLS.find((t) => t.name === 'vio_get_store')!
    expect(Object.keys(getStore.inputSchema)).toHaveLength(0)
  })
})
