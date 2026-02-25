import type { VioNodeDescriptor } from '../core/types'

interface FieldDef {
  initial: unknown
  validate?: (value: unknown) => string | null
  label?: string
  type?: string
}

interface FormConfig {
  fields: Record<string, FieldDef>
  onSubmit?: (values: Record<string, unknown>) => void
}

export interface VioForm {
  getValues(): Record<string, unknown>
  setValue(field: string, value: unknown): void
  validate(): Record<string, string | null>
  isValid(): boolean
  reset(): void
  toNodeDescriptor(): VioNodeDescriptor
}

export function createForm(config: FormConfig): VioForm {
  const values: Record<string, unknown> = {}
  const fieldDefs = config.fields

  for (const [key, def] of Object.entries(fieldDefs)) {
    values[key] = def.initial
  }

  return {
    getValues() {
      return { ...values }
    },

    setValue(field, value) {
      if (field in fieldDefs) {
        values[field] = value
      }
    },

    validate() {
      const errors: Record<string, string | null> = {}
      for (const [key, def] of Object.entries(fieldDefs)) {
        errors[key] = def.validate ? def.validate(values[key]) : null
      }
      return errors
    },

    isValid() {
      for (const [key, def] of Object.entries(fieldDefs)) {
        if (def.validate && def.validate(values[key]) !== null) {
          return false
        }
      }
      return true
    },

    reset() {
      for (const [key, def] of Object.entries(fieldDefs)) {
        values[key] = def.initial
      }
    },

    toNodeDescriptor() {
      const children: VioNodeDescriptor[] = []
      for (const [key, def] of Object.entries(fieldDefs)) {
        const fieldChildren: (VioNodeDescriptor | string)[] = []
        if (def.label) {
          fieldChildren.push({ tag: 'label', props: { for: key }, children: [def.label] })
        }
        fieldChildren.push({
          tag: 'input',
          props: {
            type: def.type ?? 'text',
            name: key,
            id: key,
            value: String(values[key] ?? '')
          }
        })
        children.push({ tag: 'div', props: { class: 'form-field' }, children: fieldChildren })
      }
      return { tag: 'form', children }
    }
  }
}
