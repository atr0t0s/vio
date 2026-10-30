import { describe, it, expect, afterEach } from 'vitest'
import { request as httpRequestRaw } from 'node:http'
import type { Server } from 'node:http'
import { startControl } from '../control.js'
import { httpRequest } from '../commands.js'

let server: Server | undefined
afterEach(() => new Promise<void>(r => (server ? server.close(() => r()) : r())))

async function start(token?: string) {
  const calls: [string, unknown][] = []
  const started = await startControl({
    call: async (method, params) => {
      calls.push([method, params])
      if (method === 'boom') throw new Error('E_REF: e9 is gone')
      return method === 'see' ? 'e1 app' : { ok: true }
    }
  }, { port: 0, token })
  server = started.server
  return { port: started.port, calls }
}

function raw(port: number, headers: Record<string, string>, body = '{"method":"see"}'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequestRaw({ host: '127.0.0.1', port, path: '/call', method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, res => {
      let data = ''
      res.on('data', c => (data += c))
      res.on('end', () => resolve({ status: res.statusCode!, body: data }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('control endpoint', () => {
  it('forwards calls and returns results or errors', async () => {
    const { port, calls } = await start()
    const call = httpRequest(port)
    expect(await call('see', { diff: true })).toBe('e1 app')
    expect(calls).toEqual([['see', { diff: true }]])
    await expect(call('boom', {})).rejects.toThrow('E_REF: e9 is gone')
  })

  it('rejects requests a web page could send', async () => {
    const { port } = await start()
    expect((await raw(port, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await raw(port, { host: 'evil.example:3101' })).status).toBe(403)
  })

  it('requires the token when configured', async () => {
    const { port } = await start('s3cret')
    expect((await raw(port, {})).status).toBe(403)
    expect((await raw(port, { 'x-vio-token': 's3cret' })).status).toBe(200)
    await expect(httpRequest(port, 'nope')('see', {})).rejects.toThrow(/E_FORBIDDEN/)
  })

  it('rejects malformed bodies', async () => {
    const { port } = await start()
    expect(JSON.parse((await raw(port, {}, 'not json')).body).error.message).toMatch(/JSON/)
  })

  it('explains when nothing is listening', async () => {
    await expect(httpRequest(1)('see', {})).rejects.toThrow(/E_NO_SERVER/)
  })
})
