import { contactLabel, validateContactProfile, type ContactProfile } from './contact-model'

/** Every mutable identity field needs a staff decision. Domain records and
 * chapter preferences are deliberately outside this identity-only contract. */
export const mergeProfileFields = [
  'firstName',
  'lastName',
  'preferredName',
  'organizationName',
  'methods',
  'addresses',
  'communication.emailAllowed',
  'communication.phoneAllowed',
  'communication.mailAllowed',
  'communication.volunteerAllowed',
] as const
export type MergeProfileField = (typeof mergeProfileFields)[number]
export type MergeProfileChoices = Record<MergeProfileField, 'survivor' | 'duplicate'>
export type MergeIdentitySnapshot = {
  id: string
  organization: string
  revision: number
  profile: ContactProfile
}

function value(profile: ContactProfile, field: MergeProfileField): unknown {
  return field.startsWith('communication.')
    ? profile.communication[
        field.slice('communication.'.length) as keyof ContactProfile['communication']
      ]
    : profile[field as keyof ContactProfile]
}

/** Pure preparation only: does not authorize, persist, approve or resolve any
 * reference. The eventual approval must also fence every domain impact and the
 * actor's live authority, not just these two profile revisions. */
export function prepareMergeProfile(input: {
  survivor: MergeIdentitySnapshot
  duplicate: MergeIdentitySnapshot
  choices: unknown
}) {
  const { survivor, duplicate } = input
  if (!survivor.id || !duplicate.id || survivor.id === duplicate.id)
    throw new Error('Choose two different constituents and an explicit survivor.')
  if (!survivor.organization || survivor.organization !== duplicate.organization)
    throw new Error('Constituents from unrelated organization roots cannot be merged.')
  if (
    ![survivor.revision, duplicate.revision].every(
      (revision) => Number.isSafeInteger(revision) && revision > 0,
    )
  )
    throw new Error('Reload both constituents before preparing a merge.')
  const before = validateContactProfile(survivor.profile)
  const incoming = validateContactProfile(duplicate.profile)
  if (before.kind !== incoming.kind)
    throw new Error('A person and an organization cannot be combined into one identity.')
  if (!input.choices || typeof input.choices !== 'object' || Array.isArray(input.choices))
    throw new Error('Choose the retained value for every profile field.')
  const choices = input.choices as Record<string, unknown>
  if (
    Object.keys(choices).length !== mergeProfileFields.length ||
    Object.keys(choices).some((field) => !(mergeProfileFields as readonly string[]).includes(field))
  )
    throw new Error('Choose exactly the supported profile fields.')
  const profile: ContactProfile = structuredClone(before)
  const decisions = mergeProfileFields.map((field) => {
    if (
      !Object.hasOwn(choices, field) ||
      (choices[field] !== 'survivor' && choices[field] !== 'duplicate')
    )
      throw new Error('Choose the retained value for every profile field.')
    const source = choices[field] as 'survivor' | 'duplicate'
    const selected = structuredClone(value(source === 'survivor' ? before : incoming, field))
    if (field.startsWith('communication.')) {
      const preference = field.slice(
        'communication.'.length,
      ) as keyof ContactProfile['communication']
      // Combining duplicate records cannot turn an existing opt-out into consent.
      // A later, separately recorded preference change remains a distinct action.
      if (
        selected === true &&
        (!before.communication[preference] || !incoming.communication[preference])
      )
        throw new Error('Retain recorded communication opt-outs when combining constituents.')
      profile.communication[preference] = selected as boolean
    } else {
      Object.assign(profile, { [field]: selected })
    }
    return {
      field,
      source,
      survivorValue: value(before, field),
      duplicateValue: value(incoming, field),
      retainedValue: selected,
    }
  })
  const validated = validateContactProfile(profile)
  return {
    survivor: survivor.id,
    duplicate: duplicate.id,
    organization: survivor.organization,
    expectedRevisions: { survivor: survivor.revision, duplicate: duplicate.revision },
    profile: validated,
    label: contactLabel(validated),
    decisions,
  }
}
