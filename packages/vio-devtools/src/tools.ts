import { z, ZodType } from 'zod'

export interface ToolDef {
  name: string
  description: string
  wsMethod: string
  inputSchema: Record<string, ZodType>
}

export const TOOLS: ToolDef[] = [
  {
    name: 'vio_get_state',
    description: 'Get the local state of a component by its instance ID',
    wsMethod: 'getState',
    inputSchema: {
      instanceId: z.string().describe('Component instance ID (e.g. "AppRoot-1")')
    }
  },
  {
    name: 'vio_set_state',
    description: 'Update the local state of a component (partial merge)',
    wsMethod: 'setState',
    inputSchema: {
      instanceId: z.string().describe('Component instance ID'),
      state: z.record(z.unknown()).describe('Partial state to merge')
    }
  },
  {
    name: 'vio_get_store',
    description: 'Get the global store state',
    wsMethod: 'getStore',
    inputSchema: {}
  },
  {
    name: 'vio_dispatch',
    description: 'Dispatch an action to the global store',
    wsMethod: 'dispatch',
    inputSchema: {
      action: z.string().describe('Action name (e.g. "addTodo")'),
      payload: z.unknown().optional().describe('Action payload')
    }
  },
  {
    name: 'vio_navigate',
    description: 'Navigate to a route path',
    wsMethod: 'navigate',
    inputSchema: {
      path: z.string().describe('Route path (e.g. "/dashboard")')
    }
  },
  {
    name: 'vio_get_component_tree',
    description: 'Get the component tree with IDs, names, and state',
    wsMethod: 'getComponentTree',
    inputSchema: {}
  },
  {
    name: 'vio_get_registered_components',
    description: 'List all registered component names',
    wsMethod: 'getRegisteredComponents',
    inputSchema: {}
  },
  {
    name: 'vio_remove_component',
    description: 'Unmount and remove a component by instance ID',
    wsMethod: 'removeComponent',
    inputSchema: {
      instanceId: z.string().describe('Component instance ID to remove')
    }
  },
  {
    name: 'vio_batch',
    description: 'Execute multiple operations atomically. Actions: setState, dispatch, removeComponent, navigate',
    wsMethod: 'batch',
    inputSchema: {
      operations: z.array(z.object({
        action: z.enum(['setState', 'dispatch', 'removeComponent', 'navigate']),
        target: z.string().optional().describe('Component ID or route path'),
        payload: z.unknown().optional().describe('Action-specific payload')
      })).describe('Array of operations to execute')
    }
  },
  {
    name: 'vio_emit',
    description: 'Emit an event on the event bus',
    wsMethod: 'emit',
    inputSchema: {
      event: z.string().describe('Event type (e.g. "state:change")'),
      payload: z.record(z.unknown()).optional().describe('Event payload')
    }
  },
  {
    name: 'vio_get_event_history',
    description: 'Get recent event bus history (last 100 events)',
    wsMethod: 'getEventHistory',
    inputSchema: {}
  }
]
