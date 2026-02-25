import { describe, it, expect } from 'vitest'
import {
  createRequest,
  createResponse,
  createErrorResponse,
  isResponse,
  isErrorResponse
} from '../protocol.js'

describe('protocol', () => {
  it('creates a request with incrementing id', () => {
    const req1 = createRequest('getStore', {})
    const req2 = createRequest('dispatch', { action: 'addTodo' })
    expect(req1.id).toBe(1)
    expect(req2.id).toBe(2)
    expect(req1.method).toBe('getStore')
    expect(req2.params).toEqual({ action: 'addTodo' })
  })

  it('creates a success response', () => {
    const res = createResponse(1, { todos: [] })
    expect(res.id).toBe(1)
    expect(res.result).toEqual({ todos: [] })
    expect(isResponse(res)).toBe(true)
    expect(isErrorResponse(res)).toBe(false)
  })

  it('creates an error response', () => {
    const res = createErrorResponse(1, 'Something broke')
    expect(res.id).toBe(1)
    expect(res.error.message).toBe('Something broke')
    expect(isErrorResponse(res)).toBe(true)
  })
})
