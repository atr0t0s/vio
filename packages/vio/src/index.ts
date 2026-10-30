export const VERSION = '2.0.0'

// Core
export { createApp } from './core/app'
export type { VioApp, Manifest } from './core/app'
export type { SeeOptions, ActKind } from './agent/snapshot'
export type { AssertCondition, AssertResult } from './agent/protocol'
export { defineComponent, ComponentRegistry } from './core/component'
export { createElement } from './core/node'
export { Renderer, VioError } from './core/renderer'
export type { RendererOptions } from './core/renderer'
export { diff, patch } from './core/diff'

// Types
export type {
  VioNodeDescriptor,
  VioChild,
  ComponentDef,
  ComponentContext,
  ComponentInstance,
  ComponentTreeNode,
  RouteInfo,
  RouteGuard,
  RenderFunction,
  Route,
  StoreConfig,
  ActionMeta,
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
