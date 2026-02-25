import type { VioNodeDescriptor, ComponentDef, ComponentInstance, ComponentContext } from './types'
import { diff, patch } from './diff'
import { EventBus } from '../runtime/event-bus'

let instanceIdCounter = 0

export class Renderer {
  private container: HTMLElement
  private bus: EventBus
  private instances = new Map<string, ComponentInstance>()
  private rootInstanceId: string | null = null

  constructor(container: HTMLElement, bus: EventBus) {
    this.container = container
    this.bus = bus

    // Re-render all mounted components when the global store changes
    this.bus.on('store:change', () => {
      for (const instance of this.instances.values()) {
        this.rerender(instance)
      }
    })
  }

  mount(def: ComponentDef, parentEl?: HTMLElement): ComponentInstance {
    const id = `${def.name}-${++instanceIdCounter}`
    const state = { ...(def.state ?? {}) }
    const target = parentEl ?? this.container

    const tree = this.renderTree(def, state)
    const element = this.createElementRecursive(tree)

    const instance: ComponentInstance = { id, def, state, node: tree, element }
    this.instances.set(id, instance)

    if (!parentEl) {
      this.rootInstanceId = id
      target.innerHTML = ''
      if (element) target.appendChild(element)
    }

    this.bus.emit('component:mount', { name: def.name, id, state: { ...state } })

    if (def.onMount) {
      const ctx = this.createContext(id)
      const cleanup = def.onMount(ctx)
      if (typeof cleanup === 'function') {
        instance.cleanup = cleanup
      }
    }

    return instance
  }

  setState(instanceId: string, partial: Record<string, unknown>): void {
    const instance = this.instances.get(instanceId)
    if (!instance) throw new Error(`No instance with id "${instanceId}"`)

    const prevState = { ...instance.state }
    instance.state = { ...instance.state, ...partial }

    this.bus.emit('state:change', {
      component: instance.def.name,
      id: instanceId,
      prev: prevState,
      next: { ...instance.state }
    })

    this.rerender(instance)

    if (instance.def.onUpdate) {
      const ctx = this.createContext(instanceId)
      instance.def.onUpdate(ctx, prevState)
    }
  }

  unmount(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    if (instance.cleanup) instance.cleanup()
    if (instance.def.onUnmount) {
      const ctx = this.createContext(instanceId)
      instance.def.onUnmount(ctx)
    }

    if (instance.element?.parentNode) {
      instance.element.parentNode.removeChild(instance.element)
    }

    this.bus.emit('component:unmount', { name: instance.def.name, id: instanceId })
    this.instances.delete(instanceId)
  }

  getInstance(instanceId: string): ComponentInstance | undefined {
    return this.instances.get(instanceId)
  }

  private rerender(instance: ComponentInstance): void {
    const newTree = this.renderTree(instance.def, instance.state)
    const oldTree = instance.node

    if (oldTree && instance.element) {
      const patches = diff(oldTree, newTree)
      if (patches.length > 0) {
        patch(instance.element, patches)
      }
    } else {
      const newEl = this.createElementRecursive(newTree)
      if (instance.element?.parentNode && newEl) {
        instance.element.parentNode.replaceChild(newEl, instance.element)
      }
      instance.element = newEl
    }

    instance.node = newTree
  }

  private renderTree(def: ComponentDef, state: Record<string, unknown>): VioNodeDescriptor {
    return this.resolveTree(def.render(state))
  }

  /** Recursively resolve ComponentDef tags into plain HTML descriptor trees. */
  private resolveTree(desc: VioNodeDescriptor): VioNodeDescriptor {
    // ComponentDef tag — call its render and resolve recursively
    if (typeof desc.tag === 'object' && 'render' in desc.tag) {
      const childDef = desc.tag as ComponentDef
      const childState = { ...(childDef.state ?? {}), ...(desc.props ?? {}) }
      return this.resolveTree(childDef.render(childState))
    }

    // String tag — resolve children recursively and strip empties
    // so the virtual tree matches what createElementRecursive produces
    if (desc.children) {
      const resolvedChildren = desc.children
        .filter(child => child !== null && child !== undefined && child !== false && child !== true && child !== '')
        .map(child => {
          if (child && typeof child === 'object' && 'tag' in child) {
            return this.resolveTree(child)
          }
          return child
        })
      return { ...desc, children: resolvedChildren }
    }

    return desc
  }

  private createElementRecursive(desc: VioNodeDescriptor): HTMLElement | null {
    // String tag - regular HTML element
    if (typeof desc.tag === 'string') {
      const el = document.createElement(desc.tag)

      // Apply props
      if (desc.props) {
        for (const [key, value] of Object.entries(desc.props)) {
          if (key.startsWith('on') && typeof value === 'function') {
            (el as any)[key.toLowerCase()] = value
          } else if (key === 'class') {
            el.className = String(value)
          } else if (key === 'style' && typeof value === 'object' && value !== null) {
            Object.assign(el.style, value)
          } else if (key === 'ref') {
            // skip
          } else if (value !== null && value !== undefined && value !== false) {
            el.setAttribute(key, String(value))
          }
        }
      }

      // Process children
      if (desc.children) {
        for (const child of desc.children) {
          if (child === null || child === undefined || child === false || child === true || child === '') continue
          if (typeof child === 'string') {
            el.appendChild(document.createTextNode(child))
          } else if (typeof child === 'number') {
            el.appendChild(document.createTextNode(String(child)))
          } else if (typeof child === 'object' && 'tag' in child) {
            const childEl = this.createElementRecursive(child)
            if (childEl) el.appendChild(childEl)
          }
        }
      }

      return el
    }

    // ComponentDef tag - resolve the component
    if (typeof desc.tag === 'object' && 'render' in desc.tag) {
      const childDef = desc.tag as ComponentDef
      const childState = { ...(childDef.state ?? {}), ...(desc.props ?? {}) }
      const childTree = childDef.render(childState)
      return this.createElementRecursive(childTree)
    }

    return null
  }

  private createContext(instanceId: string): ComponentContext {
    return {
      setState: (partial) => this.setState(instanceId, partial),
      getState: () => {
        const inst = this.instances.get(instanceId)
        return inst ? { ...inst.state } : {}
      },
      emit: (event, payload) => {
        const payloadObj = typeof payload === 'object' && payload !== null
          ? payload as Record<string, unknown>
          : { value: payload }
        this.bus.emit(event, { component: instanceId, ...payloadObj })
      },
      getRef: (_name) => null // TODO: implement ref system
    }
  }
}
