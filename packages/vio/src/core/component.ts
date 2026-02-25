import type { ComponentDef, RenderFunction } from './types'

export function defineComponent(def: {
  name: string
  state?: Record<string, unknown>
  render: RenderFunction
  onMount?: ComponentDef['onMount']
  onUpdate?: ComponentDef['onUpdate']
  onUnmount?: ComponentDef['onUnmount']
}): ComponentDef {
  return {
    name: def.name,
    state: def.state ? { ...def.state } : {},
    render: def.render,
    onMount: def.onMount,
    onUpdate: def.onUpdate,
    onUnmount: def.onUnmount
  }
}

export class ComponentRegistry {
  private components = new Map<string, ComponentDef>()

  register(def: ComponentDef): void {
    if (this.components.has(def.name)) {
      throw new Error(`Component "${def.name}" is already registered`)
    }
    this.components.set(def.name, def)
  }

  get(name: string): ComponentDef | undefined {
    return this.components.get(name)
  }

  has(name: string): boolean {
    return this.components.has(name)
  }

  list(): string[] {
    return [...this.components.keys()]
  }
}
