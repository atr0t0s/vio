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

/** RFC 6902 subset. `path` is a JSON Pointer; `-` appends to an array. */
export type PatchOp =
  | { op: 'add' | 'replace' | 'test'; path: string; value: unknown }
  | { op: 'remove'; path: string }

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function segments(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) throw new Error(`E_PATCH: path "${path}" must start with "/"`)
  return path.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/**
 * Apply a JSON Patch without mutating `doc`: only the containers along each
 * path are copied. Throws `E_PATCH` (with the op index) and applies nothing
 * if any op fails.
 */
export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  let result: unknown = doc
  ops.forEach((op, i) => {
    try {
      result = applyOne(result, op)
    } catch (err) {
      const message = err instanceof Error ? err.message.replace(/^E_PATCH: /, '') : String(err)
      throw new Error(`E_PATCH ops[${i}] ${op.op} ${op.path}: ${message}`)
    }
  })
  return result as T
}

function applyOne(doc: unknown, op: PatchOp): unknown {
  const segs = segments(op.path)
  if (segs.some(s => UNSAFE_SEGMENTS.has(s))) throw new Error('unsafe key in path')
  if (op.op === 'test') {
    if (!deepEqual(getPointer(doc, op.path), op.value)) throw new Error(`test failed, value is ${short(getPointer(doc, op.path))}`)
    return doc
  }
  if (segs.length === 0) {
    if (op.op === 'remove') throw new Error('cannot remove the root')
    return op.value
  }
  const write = (node: unknown, depth: number): unknown => {
    const key = segs[depth]!
    const last = depth === segs.length - 1
    if (Array.isArray(node)) {
      const copy = node.slice()
      const index = key === '-' ? copy.length : Number(key)
      if (!/^(0|[1-9]\d*)$/.test(key) && key !== '-') throw new Error(`"${key}" is not an array index`)
      if (last) {
        if (op.op === 'add') {
          if (index > copy.length) throw new Error(`index ${index} is past the end (${copy.length})`)
          copy.splice(index, 0, op.value)
        } else {
          if (index >= copy.length) throw new Error(`index ${index} does not exist`)
          if (op.op === 'remove') copy.splice(index, 1)
          else copy[index] = op.value
        }
        return copy
      }
      if (index >= copy.length) throw new Error(`index ${index} does not exist`)
      copy[index] = write(copy[index], depth + 1)
      return copy
    }
    if (node === null || typeof node !== 'object') throw new Error(`no container at "${key}"`)
    const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) }
    if (last) {
      if (op.op === 'remove' || op.op === 'replace') {
        if (!Object.prototype.hasOwnProperty.call(copy, key)) throw new Error(`"${key}" does not exist`)
      }
      if (op.op === 'remove') delete copy[key]
      else copy[key] = op.value
      return copy
    }
    if (!Object.prototype.hasOwnProperty.call(copy, key)) throw new Error(`"${key}" does not exist`)
    copy[key] = write(copy[key], depth + 1)
    return copy
  }
  return write(doc, 0)
}
