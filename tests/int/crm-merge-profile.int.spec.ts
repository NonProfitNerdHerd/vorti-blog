import { expect, it } from 'vitest'
import { validateContactProfile } from '../../src/crm/contact-model'
import {
  mergeProfileFields,
  prepareMergeProfile,
  type MergeProfileChoices,
} from '../../src/crm/merge-profile'

const choices = (): MergeProfileChoices =>
  Object.fromEntries(mergeProfileFields.map((field) => [field, 'survivor'])) as MergeProfileChoices
const identities = () => ({
  survivor: {
    id: 'retained',
    organization: 'root-a',
    revision: 3,
    profile: validateContactProfile({
      kind: 'person',
      firstName: 'River',
      lastName: 'Original',
      methods: [{ kind: 'email', value: 'river@example.invalid', primary: true }],
      addresses: [{ label: 'Home', lines: '100 Fictional Road' }],
    }),
  },
  duplicate: {
    id: 'duplicate',
    organization: 'root-a',
    revision: 7,
    profile: validateContactProfile({
      kind: 'person',
      firstName: 'R.',
      lastName: 'Revised',
      methods: [{ kind: 'phone', value: '555-0100', primary: true }],
      addresses: [],
      communication: { emailAllowed: false },
    }),
  },
})

it('requires explicit field decisions, preserves whole chosen values and records empty-address decisions without mutating snapshots', () => {
  const input = identities()
  const original = structuredClone(input)
  const selected = choices()
  selected.lastName = 'duplicate'
  selected.methods = 'duplicate'
  selected.addresses = 'duplicate'
  selected['communication.emailAllowed'] = 'duplicate'
  const prepared = prepareMergeProfile({ ...input, choices: selected })
  expect(prepared.label).toBe('River Revised')
  expect(prepared.profile.addresses).toEqual([])
  expect(prepared.profile.methods).toEqual(input.duplicate.profile.methods)
  expect(prepared.expectedRevisions).toEqual({ survivor: 3, duplicate: 7 })
  expect(prepared.decisions.find((decision) => decision.field === 'addresses')).toMatchObject({
    source: 'duplicate',
    survivorValue: input.survivor.profile.addresses,
    retainedValue: [],
  })
  prepared.profile.methods[0].value = 'changed-after-preparation'
  expect(input).toEqual(original)
})

it('rejects missing, unsupported and inherited choices instead of guessing overwrite decisions', () => {
  const input = identities()
  expect(() => prepareMergeProfile({ ...input, choices: {} })).toThrow()
  const selected = { ...choices(), unknown: 'survivor' }
  expect(() => prepareMergeProfile({ ...input, choices: selected })).toThrow()
  expect(() => prepareMergeProfile({ ...input, choices: Object.create(choices()) })).toThrow()
  expect(() =>
    prepareMergeProfile({
      ...input,
      choices: { ...choices(), firstName: { toString: () => 'survivor' } },
    }),
  ).toThrow()
})

it('retains existing opt-outs regardless of which identity survives', () => {
  const input = identities()
  expect(() => prepareMergeProfile({ ...input, choices: choices() })).toThrow(/opt-outs/)
  const swapped = { survivor: input.duplicate, duplicate: input.survivor }
  const selected = choices()
  selected['communication.emailAllowed'] = 'duplicate'
  expect(() => prepareMergeProfile({ ...swapped, choices: selected })).toThrow(/opt-outs/)
})

it('rejects self-merges, unrelated roots, incompatible identity kinds and invalid revisions', () => {
  const input = identities()
  const selected = choices()
  selected['communication.emailAllowed'] = 'duplicate'
  expect(() =>
    prepareMergeProfile({ ...input, duplicate: input.survivor, choices: selected }),
  ).toThrow(/different/)
  expect(() =>
    prepareMergeProfile({
      ...input,
      duplicate: { ...input.duplicate, organization: 'root-b' },
      choices: selected,
    }),
  ).toThrow(/roots/)
  expect(() =>
    prepareMergeProfile({
      ...input,
      duplicate: {
        ...input.duplicate,
        profile: validateContactProfile({
          kind: 'organization',
          organizationName: 'Fictional organization',
        }),
      },
      choices: selected,
    }),
  ).toThrow(/person and an organization/)
  expect(() =>
    prepareMergeProfile({
      ...input,
      survivor: { ...input.survivor, revision: 0 },
      choices: selected,
    }),
  ).toThrow(/Reload/)
})
