import { z, ZodType } from 'zod'

export interface ToolDef {
  name: string
  description: string
  wsMethod: string
  inputSchema: Record<string, ZodType>
}

// Kept deliberately small: every schema is paid for in tokens on every turn.
export const TOOLS: ToolDef[] = [
  {
    name: 'vio_manifest',
    description: 'Routes, store actions, components. Call first.',
    wsMethod: 'manifest',
    inputSchema: {}
  },
  {
    name: 'vio_see',
    description: 'UI as text lines like: e5 button "Add". diff: only changes since last see.',
    wsMethod: 'see',
    inputSchema: {
      diff: z.boolean().optional(),
      ref: z.string().optional(),
      depth: z.number().optional(),
      page: z.number().optional()
    }
  },
  {
    name: 'vio_act',
    description: 'Act on an element by ref. Returns UI diff.',
    wsMethod: 'act',
    inputSchema: {
      ref: z.string(),
      action: z.enum(['click', 'fill', 'check', 'uncheck', 'select', 'press', 'focus', 'blur', 'hover', 'submit']),
      value: z.string().optional().describe('fill text, select option, press key')
    }
  },
  {
    name: 'vio_invoke',
    description: 'Run a store action. Returns UI diff. Prefer over clicking.',
    wsMethod: 'invoke',
    inputSchema: {
      action: z.string(),
      payload: z.unknown().optional(),
      confirm: z.boolean().optional().describe('only after user approval')
    }
  },
  {
    name: 'vio_assert',
    description: 'Wait up to timeout ms (1000) for all conditions. state: JSON Pointer into store, or into component "of". equals: state value, or ref input value. count: lines with role. Returns {pass, detail}.',
    wsMethod: 'assert',
    inputSchema: {
      text: z.string().optional(),
      route: z.string().optional(),
      state: z.string().optional(),
      of: z.string().optional(),
      equals: z.unknown().optional(),
      ref: z.string().optional(),
      checked: z.boolean().optional(),
      role: z.string().optional(),
      count: z.number().optional(),
      not: z.boolean().optional(),
      timeout: z.number().optional()
    }
  },
  {
    name: 'vio_state',
    description: 'Read store (or component id) at JSON Pointer path. set: merge into component state.',
    wsMethod: 'state',
    inputSchema: {
      id: z.string().optional(),
      path: z.string().optional(),
      set: z.record(z.unknown()).optional()
    }
  },
  {
    name: 'vio_nav',
    description: 'Go to a route path. Returns UI diff.',
    wsMethod: 'nav',
    inputSchema: {
      path: z.string()
    }
  },
  {
    name: 'vio_debug',
    description: 'tree: component ids and state. events/errors: recent bus events.',
    wsMethod: 'debug',
    inputSchema: {
      what: z.enum(['tree', 'events', 'errors']),
      limit: z.number().optional()
    }
  }
]
