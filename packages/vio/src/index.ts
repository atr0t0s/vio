export const VERSION = '2.0.0'

// Core
export { createApp } from './core/app'
export type { VioApp } from './core/app'
export { defineComponent, ComponentRegistry } from './core/component'
export { createElement } from './core/node'
export { Renderer } from './core/renderer'
export { diff, patch } from './core/diff'

// Types
export type {
  VioNodeDescriptor,
  VioChild,
  ComponentDef,
  ComponentContext,
  ComponentInstance,
  Route,
  StoreConfig,
  AppConfig,
  VioEvent,
  BatchOperation
} from './core/types'

// Runtime
export { EventBus } from './runtime/event-bus'

// Reactivity
export { Store } from './reactivity/store'

// Router
export { Router } from './router/router'

// HTTP
export { HttpClient } from './http/client'

// Forms
export { createForm } from './forms/form'
export type { VioForm } from './forms/form'
