import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactRepository } from '../../src/crm/contacts'

it('finds every shared-email candidate without deduplicating and treats wildcard characters literally', async () => {
  const fixture = await crmTimelineFixture()
  try {
    const contacts = new ContactRepository(fixture.db, 1),
      ids = new Set<string>()
    for (let index = 0; index < 28; index++) {
      const result = await contacts.create({
        site: 'default',
        roles: ['donor'],
        operationKey: crypto.randomUUID(),
        profile: {
          kind: 'person',
          firstName: `Candidate ${String(index).padStart(2, '0')}`,
          methods: [
            { kind: 'email', value: 'shared@example.invalid', label: 'Household', primary: true },
          ],
        },
      })
      ids.add(String(result.id))
    }
    const seen: string[] = []
    let after: { label: string; id: string } | undefined
    do {
      const page = await contacts.list({
        site: 'default',
        search: 'SHARED@example.invalid',
        limit: 10,
        after,
      })
      expect(page.total).toBe(28)
      seen.push(...page.docs.map((contact) => contact.id))
      after = page.next || undefined
    } while (after)
    expect(new Set(seen)).toEqual(ids)
    expect(seen).toHaveLength(28)
    expect((await contacts.list({ site: 'default', search: '%' })).total).toBe(0)
    expect((await contacts.list({ site: 'default', search: 'Candidate 03' })).total).toBe(1)
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(seen[0])
    expect((await contacts.list({ site: 'default', search: 'shared@example.invalid' })).total).toBe(
      27,
    )
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(
      29,
    )
  } finally {
    fixture.sqlite.close()
  }
})
