import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpClient } from '../../http/client'

describe('HttpClient', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('makes GET requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'test' }),
      headers: new Headers({ 'content-type': 'application/json' })
    })

    const client = new HttpClient()
    const res = await client.get('/api/test')
    expect(res.data).toEqual({ data: 'test' })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'GET' }))
  })

  it('makes POST requests with body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1 }),
      headers: new Headers({ 'content-type': 'application/json' })
    })

    const client = new HttpClient()
    const res = await client.post('/api/items', { name: 'test' })
    expect(res.data).toEqual({ id: 1 })
  })

  it('supports request interceptors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Headers({ 'content-type': 'application/json' })
    })

    const client = new HttpClient()
    client.interceptors.request.use((config) => ({
      ...config,
      headers: { ...config.headers, Authorization: 'Bearer token' }
    }))

    await client.get('/api/test')
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token' })
    }))
  })

  it('supports base URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Headers({ 'content-type': 'application/json' })
    })

    const client = new HttpClient({ baseURL: 'https://api.example.com' })
    await client.get('/users')
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.com/users', expect.any(Object))
  })

  it('throws on non-ok responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'not found' }),
      headers: new Headers({ 'content-type': 'application/json' })
    })

    const client = new HttpClient()
    await expect(client.get('/api/missing')).rejects.toThrow()
  })
})
