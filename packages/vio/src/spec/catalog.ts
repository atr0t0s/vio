import type { ComponentDef } from '../core/types'

/** Literal prop types an agent can satisfy; an array is an enum of allowed values. */
export type PropType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'action' | 'any' | readonly (string | number)[]

export interface PropDef {
  type: PropType
  required?: boolean
}

export interface CatalogEntry {
  component: ComponentDef
  /** One line for agents. */
  doc?: string
  /** Allowed props. Append `!` to the name (`'items!'`) or use `{ required: true }` for required ones. */
  props?: Record<string, PropType | PropDef>
  /** Whether spec children are passed through as `ctx.props.children`. */
  children?: boolean
}

export interface Catalog {
  components: Record<string, { component: ComponentDef; doc?: string; props: Record<string, PropDef>; children: boolean }>
  html: Set<string>
}

/** Tags a generated spec may use by default. No scripts, frames, embeds, forms posting elsewhere, or SVG. */
export const DEFAULT_HTML = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'button', 'input', 'textarea',
  'select', 'option', 'label', 'form', 'fieldset', 'legend', 'section', 'article', 'header', 'footer', 'nav', 'main',
  'aside', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'img', 'figure', 'figcaption', 'strong',
  'em', 'b', 'i', 'small', 'code', 'pre', 'blockquote', 'br', 'hr', 'details', 'summary', 'dialog', 'progress', 'time', 'mark'
]

export function defineCatalog(def: { components?: Record<string, CatalogEntry>; html?: string[] }): Catalog {
  const components: Catalog['components'] = {}
  for (const [name, entry] of Object.entries(def.components ?? {})) {
    const props: Record<string, PropDef> = {}
    for (const [raw, t] of Object.entries(entry.props ?? {})) {
      const required = raw.endsWith('!')
      const key = required ? raw.slice(0, -1) : raw
      const prop = typeof t === 'object' && !Array.isArray(t) ? { ...(t as PropDef) } : { type: t as PropType }
      if (required) prop.required = true
      props[key] = prop
    }
    components[name] = { component: entry.component, doc: entry.doc, props, children: entry.children ?? false }
  }
  return { components, html: new Set(def.html ?? DEFAULT_HTML) }
}

function typeText(t: PropType): string {
  return Array.isArray(t) ? t.join('|') : (t as string)
}

/** Compact catalog + spec grammar for an agent's prompt. */
export function describeCatalog(catalog: Catalog): string {
  const lines = ['Spec: {root, nodes:{id:{type, props?, text?, children?:[ids], each?:"/ptr", key?:"field"}}}']
  lines.push('Values: {$state:"/ptr"} {$item:"/field"} (inside each) {$action:"name", args?} {$event:"value"|"checked"} (in args)')
  for (const [name, c] of Object.entries(catalog.components)) {
    const props = Object.entries(c.props).map(([k, p]) => `${k}${p.required ? '!' : ''}:${typeText(p.type)}`).join(', ')
    lines.push(`${name}(${props})${c.children ? ' +children' : ''}${c.doc ? ' ' + c.doc : ''}`)
  }
  lines.push(`HTML: ${[...catalog.html].join(' ')}; on* props take {$action}`)
  return lines.join('\n')
}
