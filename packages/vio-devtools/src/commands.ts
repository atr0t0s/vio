import { readFile } from 'node:fs/promises'

// The `vio` CLI: one shell command per agent action, plain-text output, and
// exit codes a coding agent can branch on (0 ok, 1 error, 2 assertion failed).

export type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>

export interface CliIO {
  out: (text: string) => void
  err: (text: string) => void
  request: Request
  readFile?: (path: string) => Promise<string>
}

export const EXIT = { ok: 0, error: 1, failed: 2 } as const

export const USAGE = `vio <command>   (talks to a running app through \`vio serve\` or the MCP server)
  status                           which page is connected
  manifest                         routes, actions, components, docs
  see [--diff] [--ref R] [--depth N] [--page N]
  find <query>                     ref for role:name, e.g. button:Add or item:Milk>button:Delete
  act <ref|query> <action> [value] click fill check uncheck select press focus blur hover submit
  invoke <action> [json] [--confirm]
  assert key=value... [--not] [--timeout MS]   text= route= state= of= equals= ref= checked= role= count=
  nav <path>
  state [path] [--id ID] [--set JSON] [--patch JSON]
  debug tree|events|errors [--limit N]
  run <script.json> [--verbose]    steps like {"act":["button:Add","click"]}, {"assert":{"text":"1 left"}}
  serve                            run the bridge without MCP (for CLI-only use)
Exit codes: 0 ok, 1 error, 2 assertion failed.`

interface Parsed {
  positional: string[]
  flags: Record<string, string | true>
}

function parse(args: string[]): Parsed {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split(/=(.*)/s)
      const next = args[i + 1]
      if (inline !== undefined) flags[key!] = inline
      else if (next !== undefined && !next.startsWith('--') && VALUE_FLAGS.has(key!)) { flags[key!] = next; i++ }
      else flags[key!] = true
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

const VALUE_FLAGS = new Set(['ref', 'depth', 'page', 'id', 'set', 'patch', 'limit', 'timeout'])

/** JSON if it parses, otherwise the raw string (so `text=1 left` and `equals=true` both work). */
function loose(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function json(value: string | true | undefined, flag: string): unknown {
  if (typeof value !== 'string') throw new Error(`E_USAGE: --${flag} needs a JSON value`)
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`E_USAGE: --${flag} is not valid JSON`)
  }
}

function num(value: string | true | undefined): number | undefined {
  return typeof value === 'string' ? Number(value) : undefined
}

function clean(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
}

/** Map one command to a bridge method and params. */
export function toCall(command: string, args: string[]): { method: string; params: Record<string, unknown> } {
  const { positional: p, flags: f } = parse(args)
  const need = (n: number, what: string) => {
    if (p.length < n) throw new Error(`E_USAGE: ${command} needs ${what}`)
  }
  switch (command) {
    case 'status':
      return { method: 'status', params: {} }
    case 'manifest':
      return { method: 'manifest', params: {} }
    case 'see':
      return { method: 'see', params: clean({ diff: f.diff === true || undefined, ref: f.ref, depth: num(f.depth), page: num(f.page) }) }
    case 'find':
      need(1, 'a query like button:Add')
      return { method: 'find', params: { query: p.join(' ') } }
    case 'act':
      need(2, '<ref|query> <action>')
      return { method: 'act', params: clean({ ref: p[0], action: p[1], value: p.length > 2 ? p.slice(2).join(' ') : undefined }) }
    case 'invoke':
      need(1, 'an action name')
      return { method: 'invoke', params: clean({ action: p[0], payload: p[1] !== undefined ? loose(p.slice(1).join(' ')) : undefined, confirm: f.confirm === true || undefined }) }
    case 'assert': {
      const cond: Record<string, unknown> = {}
      for (const pair of p) {
        const eq = pair.indexOf('=')
        if (eq < 1) throw new Error(`E_USAGE: assert takes key=value pairs, got "${pair}"`)
        const key = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        // Text-like keys stay strings even when they look like JSON ("3", "true").
        cond[key] = /^(text|route|state|of|ref|role)$/.test(key) ? value : loose(value)
      }
      if (Object.keys(cond).length === 0) throw new Error('E_USAGE: assert needs at least one key=value')
      if (f.not) cond.not = true
      if (f.timeout !== undefined) cond.timeout = num(f.timeout)
      return { method: 'assert', params: cond }
    }
    case 'nav':
      need(1, 'a path')
      return { method: 'nav', params: { path: p[0] } }
    case 'state':
      return { method: 'state', params: clean({ path: p[0], id: f.id, set: f.set !== undefined ? json(f.set, 'set') : undefined, patch: f.patch !== undefined ? json(f.patch, 'patch') : undefined }) }
    case 'debug':
      need(1, 'tree, events, or errors')
      return { method: 'debug', params: clean({ what: p[0], limit: num(f.limit) }) }
    default:
      throw new Error(`E_USAGE: unknown command "${command}"\n${USAGE}`)
  }
}

function format(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result)
}

function isAssertResult(r: unknown): r is { pass: boolean; detail?: string } {
  return r !== null && typeof r === 'object' && typeof (r as { pass?: unknown }).pass === 'boolean'
}

async function runOne(io: CliIO, command: string, args: string[]): Promise<number> {
  const { method, params } = toCall(command, args)
  const result = await io.request(method, params)
  if (method === 'assert' && isAssertResult(result)) {
    if (result.pass) {
      io.out('pass')
      return EXIT.ok
    }
    io.out(`fail: ${result.detail ?? ''}`)
    return EXIT.failed
  }
  io.out(format(result))
  return EXIT.ok
}

type Step = Record<string, unknown>

/** Turn one script step ({"act": ["e5","click"]}) into CLI-style args. */
function stepArgs(step: Step): [string, string[]] {
  const keys = Object.keys(step)
  if (keys.length !== 1) throw new Error(`E_SCRIPT: each step needs exactly one command key, got ${JSON.stringify(keys)}`)
  const command = keys[0]!
  const value = step[command]
  if (command === 'assert' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const { not, timeout, ...rest } = value as Record<string, unknown>
    const args = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    if (not) args.push('--not')
    if (timeout !== undefined) args.push('--timeout', String(timeout))
    return [command, args]
  }
  if (command === 'see' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const args: string[] = []
    for (const [k, v] of Object.entries(value)) args.push(v === true ? `--${k}` : `--${k}=${v}`)
    return [command, args]
  }
  if (command === 'invoke' && Array.isArray(value)) {
    const [action, payload, opts] = value as [string, unknown, { confirm?: boolean }?]
    const args = [action]
    if (payload !== undefined) args.push(JSON.stringify(payload))
    if (opts?.confirm) args.push('--confirm')
    return [command, args]
  }
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return [command, list.map(v => (typeof v === 'string' ? v : JSON.stringify(v)))]
}

async function runScript(io: CliIO, path: string, verbose: boolean): Promise<number> {
  const read = io.readFile ?? ((p: string) => readFile(p, 'utf8'))
  let steps: Step[]
  try {
    const doc = JSON.parse(await read(path)) as { steps?: Step[] } | Step[]
    steps = Array.isArray(doc) ? doc : doc.steps ?? []
  } catch (err) {
    io.err(`E_SCRIPT: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`)
    return EXIT.error
  }
  for (let i = 0; i < steps.length; i++) {
    let label = `step ${i + 1}`
    try {
      const [command, args] = stepArgs(steps[i]!)
      label = `${i + 1} ${command} ${args.join(' ')}`.trim()
      const lines: string[] = []
      const code = await runOne({ ...io, out: t => lines.push(t) }, command, args)
      if (code !== EXIT.ok) {
        io.out(`✗ ${label}\n  ${lines.join('\n  ')}`)
        return code
      }
      io.out(`✓ ${label}`)
      if (verbose && lines.length) io.out('  ' + lines.join('\n').split('\n').join('\n  '))
    } catch (err) {
      io.out(`✗ ${label}\n  ${err instanceof Error ? err.message : String(err)}`)
      return EXIT.error
    }
  }
  io.out(`${steps.length} steps passed`)
  return EXIT.ok
}

/** Run one CLI invocation (everything after the binary name). */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  const [command, ...args] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.out(USAGE)
    return EXIT.ok
  }
  try {
    if (command === 'run') {
      const { positional, flags } = parse(args)
      if (!positional[0]) throw new Error('E_USAGE: run needs a script path')
      return await runScript(io, positional[0], flags.verbose === true)
    }
    return await runOne(io, command, args)
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err))
    return EXIT.error
  }
}

/** HTTP transport to the control endpoint of `vio serve` / the MCP server. */
export function httpRequest(port: number, token?: string): Request {
  return async (method, params) => {
    let res: Response
    try {
      res = await fetch(`http://127.0.0.1:${port}/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-vio-token': token } : {}) },
        body: JSON.stringify({ method, params })
      })
    } catch {
      throw new Error(`E_NO_SERVER: nothing on 127.0.0.1:${port}; run \`vio serve\` (or the MCP server) and open the app`)
    }
    const body = await res.json() as { result?: unknown; error?: { message: string } }
    if (body.error) throw new Error(body.error.message)
    return body.result
  }
}
