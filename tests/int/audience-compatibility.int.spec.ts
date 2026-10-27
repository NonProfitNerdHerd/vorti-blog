import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { AccessResult, CollectionConfig, Config, Field } from 'payload'
import { audienceCollections, audienceCompatibility } from '@/publishing/audience-compatibility'
import { cmsCollections } from '@/organizations/cms-collections'
import { up, down } from '@/migrations/20261027_230000_publishing_audience_compatibility'

const config = (read: AccessResult = true) => audienceCompatibility({ collections: [{
  slug: 'posts', fields: [], versions: { drafts: true },
  access: { read: () => read, update: () => true, delete: () => true, readVersions: () => true },
}] } as unknown as Config).collections![0]

describe('audience-compatible recovery build', () => {
  it('limits lists, mutations and history to public records while retaining existing predicates', async () => {
    const collection = config({ platformSite: { equals: 'chapter' } })
    const args = { req: { user: { id: 1 } } } as never
    expect(await collection.access!.read!(args)).toEqual({ and: [
      { platformSite: { equals: 'chapter' } }, { audience: { equals: 'public' } },
    ] })
    expect(await collection.access!.readVersions!(args)).toEqual({ 'version.audience': { equals: 'public' } })
    for (const action of ['update', 'delete'] as const)
      expect(await collection.access![action]!(args)).toEqual({ audience: { equals: 'public' } })
    expect(await config(false).access!.read!(args)).toBe(false)
  })
  it('rejects internal and missing audience documents even if a Local API path bypassed predicates', async () => {
    const hook = config().hooks!.beforeRead![0]
    for (const audience of ['intranet', undefined, 'invalid'])
      await expect(hook({ doc: { id: 1, audience } } as never)).rejects.toThrow('Content unavailable')
    expect(await hook({ doc: { id: 1, audience: 'public' } } as never)).toEqual({ id: 1, audience: 'public' })
  })
  it('prevents internal creation, updates and audience switches in the recovery build', async () => {
    const hook = config().hooks!.beforeChange![0]
    for (const args of [
      { data: { audience: 'intranet' } },
      { operation: 'update', data: { audience: 'public' }, originalDoc: { audience: 'intranet' } },
      { operation: 'update', data: {}, originalDoc: { audience: 'intranet' } },
    ]) await expect(hook(args as never)).rejects.toThrow('unified publisher')
    expect(await hook({ data: { title: 'Preserve' } } as never)).toEqual({ title: 'Preserve', audience: 'public' })
    expect(await hook({ operation: 'create', data: { title: 'New' }, originalDoc: {} } as never)).toEqual({ title: 'New', audience: 'public' })
  })
  it('keeps design definitions shared and protects every audience-owned supporting collection', () => {
    const collections = [...audienceCollections, 'site-templates', 'design-templates'].map(slug => ({ slug, fields: [] as Field[] })) as CollectionConfig[]
    const result = audienceCompatibility({ collections } as Config).collections!
    for (const collection of result) expect(collection.fields.some(field => 'name' in field && field.name === 'audience')).toBe(audienceCollections.has(collection.slug))
  })
  it('backfills populated records and versions without rewriting content, and is restart-safe', async () => {
    const database = new DatabaseSync(':memory:')
    for (const [slug, table, versions] of cmsCollections) {
      if (!audienceCollections.has(slug)) continue
      for (const target of [table, ...(versions ? [versions] : [])]) {
        database.exec(`CREATE TABLE "${target}"(id integer PRIMARY KEY,body text); INSERT INTO "${target}" VALUES(1,'preserve')`)
      }
    }
    const command = (statement: { queryChunks: { value: string[] }[] }) => statement.queryChunks.map(chunk => chunk.value.join('')).join('')
    const db = {
      all: async (statement: Parameters<typeof command>[0]) => database.prepare(command(statement)).all(),
      run: async (statement: Parameters<typeof command>[0]) => database.exec(command(statement)),
    }
    try {
      await up({ db } as never)
      await up({ db } as never)
      for (const [slug, table, versions] of cmsCollections) {
        if (!audienceCollections.has(slug)) continue
        expect(database.prepare(`SELECT body,audience FROM "${table}"`).get()).toEqual({ body: 'preserve', audience: 'public' })
        if (versions) expect(database.prepare(`SELECT body,version_audience FROM "${versions}"`).get()).toEqual({ body: 'preserve', version_audience: 'public' })
      }
      expect(() => database.exec("UPDATE posts SET audience='other'")).toThrow()
      await expect(down({ db } as never)).rejects.toThrow('audience-compatible')
    } finally { database.close() }
  })
})
