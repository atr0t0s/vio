import type { Route, ComponentDef } from '../core/types'
import { EventBus } from '../runtime/event-bus'

export interface RouteMatch {
  component: ComponentDef
  params: Record<string, string>
  path: string
  query: Record<string, string>
}

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

  resolve(path: string): RouteMatch | null {
    const [pathname, search] = path.split('?')
    const query = parseQuery(search ?? '')

    for (const route of this.routes) {
      if (route.path === '*') {
        if (route.guard && this.storeGetter && !route.guard(this.storeGetter())) {
          continue
        }
        return { component: route.component, params: {}, path: pathname!, query }
      }

      const params = matchPath(route.path, pathname!)
      if (params !== null) {
        if (route.guard && this.storeGetter && !route.guard(this.storeGetter())) {
          continue
        }
        return { component: route.component, params, path: pathname!, query }
      }
    }

    return null
  }

  navigate(path: string): RouteMatch | null {
    const prev = this.current
    const match = this.resolve(path)

    if (match) {
      this.bus.emit('route:before', { from: prev?.path ?? null, to: path })
      this.current = match
      this.bus.emit('route:change', { from: prev?.path ?? null, to: path, params: match.params })
      this.bus.emit('route:after', { path, params: match.params })
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
      params[pat.slice(1)] = val
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
    const [key, val] = pair.split('=')
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val ?? '')
  }
  return params
}
