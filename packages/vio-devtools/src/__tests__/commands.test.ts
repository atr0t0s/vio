import { describe, it, expect } from 'vitest'
import { runCli, toCall, EXIT } from '../commands.js'

function harness(responses: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  const calls: [string, Record<string, unknown>][] = []
  const io = {
    out: (t: string) => out.push(t),
    err: (t: string) => err.push(t),
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push([method, params])
      const r = responses[method]
      if (r instanceof Error) throw r
      return typeof r === 'function' ? (r as (p: unknown) => unknown)(params) : r
    },
    readFile: async (p: string) => {
      if (!(p in files)) throw new Error('ENOENT')
      return files[p]!
    }
  }
  return { io, out, err, calls }
}

describe('toCall', () => {
  it('maps commands to bridge calls', () => {
    expect(toCall('see', ['--diff', '--depth', '3'])).toEqual({ method: 'see', params: { diff: true, depth: 3 } })
    expect(toCall('act', ['item:Milk>button:Delete', 'click'])).toEqual({ method: 'act', params: { ref: 'item:Milk>button:Delete', action: 'click' } })
    expect(toCall('act', ['textbox', 'fill', 'Buy', 'milk'])).toEqual({ method: 'act', params: { ref: 'textbox', action: 'fill', value: 'Buy milk' } })
    expect(toCall('invoke', ['toggle', '3', '--confirm'])).toEqual({ method: 'invoke', params: { action: 'toggle', payload: 3, confirm: true } })
    expect(toCall('invoke', ['add', 'Buy', 'milk'])).toEqual({ method: 'invoke', params: { action: 'add', payload: 'Buy milk' } })
    expect(toCall('find', ['button:Add', 'todo'])).toEqual({ method: 'find', params: { query: 'button:Add todo' } })
    expect(toCall('state', ['/todos/0', '--id', 'App/List'])).toEqual({ method: 'state', params: { path: '/todos/0', id: 'App/List' } })
    expect(toCall('state', ['--id', 'V', '--patch', '[{"op":"remove","path":"/spec"}]'])).toEqual({ method: 'state', params: { id: 'V', patch: [{ op: 'remove', path: '/spec' }] } })
  })

  it('parses assert pairs, keeping text-like values as strings', () => {
    expect(toCall('assert', ['text=3', 'checked=true', 'count=2', 'role=item', 'state=/n', 'equals={"a":1}', '--not', '--timeout', '200'])).toEqual({
      method: 'assert',
      params: { text: '3', checked: true, count: 2, role: 'item', state: '/n', equals: { a: 1 }, not: true, timeout: 200 }
    })
  })

  it('gives usage errors', () => {
    expect(() => toCall('act', ['e1'])).toThrow('E_USAGE: act needs <ref|query> <action>')
    expect(() => toCall('assert', ['text'])).toThrow(/key=value/)
    expect(() => toCall('state', ['--set', '{bad'])).toThrow('E_USAGE: --set is not valid JSON')
    expect(() => toCall('fly', [])).toThrow(/unknown command "fly"/)
  })
})

describe('runCli', () => {
  it('prints text results and JSON for objects', async () => {
    const h = harness({ see: 'e1 app', manifest: { routes: ['/'] } })
    expect(await runCli(['see'], h.io)).toBe(EXIT.ok)
    expect(await runCli(['manifest'], h.io)).toBe(EXIT.ok)
    expect(h.out).toEqual(['e1 app', '{"routes":["/"]}'])
  })

  it('exits 2 on a failed assertion and 1 on errors', async () => {
    const h = harness({ assert: { pass: false, detail: 'text not found' }, act: new Error('E_REF: e9 is gone') })
    expect(await runCli(['assert', 'text=done'], h.io)).toBe(EXIT.failed)
    expect(h.out).toEqual(['fail: text not found'])
    expect(await runCli(['act', 'e9', 'click'], h.io)).toBe(EXIT.error)
    expect(h.err).toEqual(['E_REF: e9 is gone'])
  })

  it('runs a script and stops at the first failure', async () => {
    const script = JSON.stringify({ steps: [
      { act: ['textbox', 'fill', 'Milk'] },
      { invoke: ['toggle', 1, { confirm: true }] },
      { see: { diff: true } },
      { assert: { text: 'Milk', count: 1, role: 'item' } },
      { assert: { text: 'Eggs', timeout: 0 } },
      { nav: '/never' }
    ] })
    const h = harness({
      act: '~ e3 textbox val="Milk"',
      invoke: '~ e8 item .done',
      see: 'no changes',
      assert: (p: Record<string, unknown>) => (p.text === 'Milk' ? { pass: true } : { pass: false, detail: 'text not found' })
    }, { 'flow.json': script })
    expect(await runCli(['run', 'flow.json'], h.io)).toBe(EXIT.failed)
    expect(h.out).toEqual([
      '✓ 1 act textbox fill Milk',
      '✓ 2 invoke toggle 1 --confirm',
      '✓ 3 see --diff',
      '✓ 4 assert text=Milk count=1 role=item',
      '✗ 5 assert text=Eggs --timeout 0\n  fail: text not found'
    ])
    expect(h.calls.map(c => c[0])).toEqual(['act', 'invoke', 'see', 'assert', 'assert'])
  })

  it('reports unreadable scripts', async () => {
    const h = harness()
    expect(await runCli(['run', 'missing.json'], h.io)).toBe(EXIT.error)
    expect(h.err[0]).toMatch(/E_SCRIPT: cannot read missing.json/)
  })
})
