import { describe, it, expect } from 'vitest'
import { createForm } from '../../forms/form'

describe('createForm', () => {
  it('creates form state from field definitions', () => {
    const form = createForm({
      fields: {
        name: { initial: '', validate: (v) => (v as string).length > 0 ? null : 'Required' },
        email: { initial: '' }
      }
    })
    expect(form.getValues()).toEqual({ name: '', email: '' })
  })

  it('sets field values', () => {
    const form = createForm({
      fields: { name: { initial: '' } }
    })
    form.setValue('name', 'Alice')
    expect(form.getValues().name).toBe('Alice')
  })

  it('validates fields', () => {
    const form = createForm({
      fields: {
        name: { initial: '', validate: (v) => (v as string).length > 0 ? null : 'Required' }
      }
    })
    const errors = form.validate()
    expect(errors.name).toBe('Required')

    form.setValue('name', 'Alice')
    const errors2 = form.validate()
    expect(errors2.name).toBeNull()
  })

  it('checks isValid', () => {
    const form = createForm({
      fields: {
        name: { initial: '', validate: (v) => (v as string).length > 0 ? null : 'Required' }
      }
    })
    expect(form.isValid()).toBe(false)
    form.setValue('name', 'Alice')
    expect(form.isValid()).toBe(true)
  })

  it('resets to initial values', () => {
    const form = createForm({
      fields: { name: { initial: 'default' } }
    })
    form.setValue('name', 'changed')
    form.reset()
    expect(form.getValues().name).toBe('default')
  })

  it('generates a node descriptor for the form', () => {
    const form = createForm({
      fields: {
        name: { initial: '', label: 'Name', type: 'text' }
      }
    })
    const node = form.toNodeDescriptor()
    expect(node.tag).toBe('form')
    expect(node.children).toBeDefined()
  })
})
