import type { Route, ComponentDef } from '../core/types'
import { EventBus } from '../runtime/event-bus'

export interface RouteMatch {
  component: ComponentDef
  params: Record<string, string>
  path: string
  query: Record<string, string>
}

const MAX_REDIRECTS = 10

export class Router {
  private routes: Route[]
  private bus: EventBus
  private current: RouteMatch | null = null
  private storeGetter: (() => Record<string, unknown>) | null = null

  constructor(routes: Route[], bus: EventBus) {
    this.routes = routes
    this.bus = bus
  }

  setStoreGetter(getter: () => Record<string, unknown>): void {
    this.storeGetter = getter
  }

  /**
   * Find the route for `path`. Guards always run (against `{}` when no store
   * is configured); a guard returning a string redirects, up to 10 hops.
   */
  resolve(path: string): RouteMatch | null {
    let target = path
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const result = this.match(target)
      if (result === null || typeof result === 'object') return result
      target = result
    }
    throw new Error(`E_REDIRECT_LOOP: more than ${MAX_REDIRECTS} redirects starting at "${path}"`)
  }

  private match(path: string): RouteMatch | string | null {
    const [pathname = '/', search] = path.split('?')
    const query = parseQuery(search ?? '')
    const store = this.storeGetter ? this.storeGetter() : {}

    for (const route of this.routes) {
      const params = route.path === '*' ? {} : matchPath(route.path, pathname)
      if (params === null) continue
      if (route.guard) {
        const verdict = route.guard(store)
        if (typeof verdict === 'string') return verdict
        if (verdict !== true) continue
      }
      return { component: route.component, params, path: pathname, query }
    }

    return null
  }

  navigate(path: string): RouteMatch | null {
    const prev = this.current
    const match = this.resolve(path)

    if (match) {
      this.bus.emit('route:before', { from: prev?.path ?? null, to: match.path })
      this.current = match
      this.bus.emit('route:change', { from: prev?.path ?? null, to: match.path, params: match.params })
      this.bus.emit('route:after', { path: match.path, params: match.params })
    }

    return match
  }

  getCurrentRoute(): RouteMatch | null {
    return this.current
  }
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)

  if (patternParts.length !== pathParts.length) return null

  const params: Record<string, string> = {}

  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i]!
    const val = pathParts[i]!

    if (pat.startsWith(':')) {
      params[pat.slice(1)] = safeDecode(val)
    } else if (pat !== val) {
      return null
    }
  }

  return params
}

function parseQuery(search: string): Record<string, string> {
  const params: Record<string, string> = {}
  if (!search) return params
  for (const pair of search.split('&')) {
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    const val = eq < 0 ? '' : pair.slice(eq + 1)
    if (key) params[safeDecode(key.replace(/\+/g, ' '))] = safeDecode(val.replace(/\+/g, ' '))
  }
  return params
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
