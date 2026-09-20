import { describe, expect, it } from 'vitest'
import { coreEditorElements, searchEditorElements, toLibraryItem } from './editor-registry'

describe('editor registry', () => {
  it('provides unique registered element identities', () => {
    const identities = coreEditorElements.map((element) => `${element.kind}:${element.value}`)
    expect(new Set(identities).size).toBe(identities.length)
  })

  it('supports quick inserter search across labels, descriptions, and keywords', () => {
    expect(searchEditorElements(coreEditorElements, 'heading').map(toLibraryItem)).toContainEqual(expect.objectContaining({ value: 'shortText' }))
    expect(searchEditorElements(coreEditorElements, 'responsive').map(toLibraryItem)).toContainEqual(expect.objectContaining({ value: 'columns' }))
    expect(searchEditorElements(coreEditorElements, 'payload').map(toLibraryItem)).toContainEqual(expect.objectContaining({ value: 'relationship' }))
  })
})
