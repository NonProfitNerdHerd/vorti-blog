import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const state = vi.hoisted(() => ({
  document: {} as Record<string, unknown>,
  auth: {} as Record<string, unknown>,
}))
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => state.auth,
  useDocumentInfo: () => state.document,
}))
import { useCollectionEditorAccess } from '../../src/content-framework/useCollectionEditorAccess'

describe('Shared collection editing permissions', () => {
  it.each([
    ['unsaved lock flag', undefined, true, undefined, true],
    ['own lock', 12, true, { id: 1 }, true],
    ['another editor', 12, true, { id: 2 }, false],
    ['unlocked document', 12, false, { id: 2 }, true],
  ])('%s', (_, id, documentIsLocked, currentEditor, expected) => {
    state.auth = { user: { id: 1 } }
    state.document = {
      id,
      documentIsLocked,
      currentEditor,
      docPermissions: { create: true, update: true, fields: true },
    }
    function Probe() {
      return String(useCollectionEditorAccess('forms').canWrite('singular'))
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe(String(expected))
  })
  it('respects explicit read-only and individual field permissions', () => {
    state.auth = { user: { id: 1 } }
    state.document = {
      id: 12,
      docPermissions: {
        update: true,
        fields: {
          singular: { update: true },
          prefix: { update: false },
        },
      },
    }
    function Probe() {
      const access = useCollectionEditorAccess('forms')
      const readOnly = useCollectionEditorAccess('forms', true)
      return JSON.stringify([
        access.canWrite('singular'),
        access.canWrite('prefix'),
        readOnly.writable,
      ])
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe('[true,false,false]')
  })
})
