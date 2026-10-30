import { toPlain } from '../core/renderer'

/** All given fields must hold. `not` inverts the whole check. */
export interface AssertCondition {
  /** Page text contains this (whitespace-normalized). */
  text?: string
  /** Current route path equals this. */
  route?: string
  /** JSON Pointer into the store, or into component state when `of` is set. */
  state?: string
  of?: string
  /** Expected value at `state`. */
  equals?: unknown
  /** Element checks by ref. */
  ref?: string
  value?: string
  checked?: boolean
  /** Number of snapshot lines with this role (e.g. "item"); use with `count`. */
  role?: string
  count?: number
  not?: boolean
  /** Keep retrying for up to this many ms. Default 1000, max 4000. */
  timeout?: number
}

export interface AssertResult {
  pass: boolean
  /** Why it failed (what was found instead). Absent on pass. */
  detail?: string
}

export function getPointer(doc: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return doc
  if (!pointer.startsWith('/')) throw new Error(`E_POINTER: "${pointer}" must start with "/"`)
  let cur: unknown = doc
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

export function short(value: unknown): string {
  const s = JSON.stringify(toPlain(value))
  if (s === undefined) return 'undefined'
  return s.length > 80 ? s.slice(0, 79) + '…' : s
}

export const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Retry `check` until it passes or the timeout elapses. */
export async function waitFor(check: () => AssertResult, cond: AssertCondition): Promise<AssertResult> {
  const timeout = Math.min(cond.timeout ?? 1000, 4000)
  const deadline = Date.now() + timeout
  for (;;) {
    let result: AssertResult
    try {
      result = check()
    } catch (err) {
      result = { pass: false, detail: err instanceof Error ? err.message : String(err) }
    }
    if (cond.not) result = result.pass ? { pass: false, detail: 'condition held but `not` was set' } : { pass: true }
    if (result.pass || Date.now() >= deadline) return result
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
