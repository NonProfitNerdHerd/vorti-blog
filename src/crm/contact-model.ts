export type ConstituentKind = 'person' | 'organization'
export const constituentRoles = [
  'donor',
  'member',
  'volunteer',
  'sponsor',
  'partner',
  'contact',
] as const
export type ConstituentRole = (typeof constituentRoles)[number]
export interface ContactMethod {
  kind: 'email' | 'phone'
  value: string
  label: string
  primary: boolean
}
export interface ContactAddress {
  label: string
  lines: string
  city: string
  region: string
  postalCode: string
  country: string
}
export interface ContactProfile {
  kind: ConstituentKind
  firstName: string
  lastName: string
  organizationName: string
  preferredName: string
  methods: ContactMethod[]
  addresses: ContactAddress[]
  communication: {
    emailAllowed: boolean
    phoneAllowed: boolean
    mailAllowed: boolean
    volunteerAllowed: boolean
  }
}
const fail = (message: string): never => {
  throw new Error(message)
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail('Enter valid contact details.')
}
const string = (value: unknown, maximum: number): string => {
  if (value == null) return ''
  if (
    typeof value !== 'string' ||
    value.trim().length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail('A contact field contains invalid text.')
  return (value as string).trim()
}
const bool = (value: unknown, fallback: boolean): boolean =>
  value === undefined
    ? fallback
    : typeof value === 'boolean'
      ? value
      : fail('Choose an allowed contact preference.')
export function validateContactProfile(input: unknown): ContactProfile {
  const data = record(input)
  if (!['person', 'organization'].includes(String(data.kind)))
    fail('Choose Person or Organization.')
  const profile: ContactProfile = {
    kind: data.kind as ConstituentKind,
    firstName: string(data.firstName, 120),
    lastName: string(data.lastName, 120),
    organizationName: string(data.organizationName, 200),
    preferredName: string(data.preferredName, 120),
    methods: [],
    addresses: [],
    communication: {
      emailAllowed: true,
      phoneAllowed: true,
      mailAllowed: true,
      volunteerAllowed: true,
    },
  }
  if (profile.kind === 'person' && !profile.firstName && !profile.lastName)
    fail('Enter the person’s name.')
  if (profile.kind === 'organization' && !profile.organizationName)
    fail('Enter the organization’s name.')
  if (data.methods !== undefined) {
    if (!Array.isArray(data.methods) || data.methods.length > 20)
      fail('Use at most 20 contact methods.')
    const seen = new Set<string>(),
      primaries = new Set<string>()
    profile.methods = (data.methods as unknown[]).map((item) => {
      const method = record(item)
      if (!['email', 'phone'].includes(String(method.kind))) fail('Choose Email or Phone.')
      const value = string(method.value, 254)
      if (!value || (method.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))
        fail('Enter a valid contact method.')
      const key = `${method.kind}:${value.toLowerCase()}`
      if (seen.has(key)) fail('Remove duplicate contact methods.')
      seen.add(key)
      const primary = bool(method.primary, false)
      if (primary && primaries.has(String(method.kind)))
        fail('Choose one primary method of each type.')
      if (primary) primaries.add(String(method.kind))
      return {
        kind: method.kind as 'email' | 'phone',
        value,
        label: string(method.label, 80),
        primary,
      }
    })
  }
  if (data.addresses !== undefined) {
    if (!Array.isArray(data.addresses) || data.addresses.length > 10)
      fail('Use at most 10 addresses.')
    profile.addresses = (data.addresses as unknown[]).map((item) => {
      const address = record(item)
      return {
        label: string(address.label, 80),
        lines: string(address.lines, 500),
        city: string(address.city, 120),
        region: string(address.region, 120),
        postalCode: string(address.postalCode, 40),
        country: string(address.country, 80),
      }
    })
  }
  if (data.communication !== undefined) {
    const communication = record(data.communication)
    profile.communication = {
      emailAllowed: bool(communication.emailAllowed, true),
      phoneAllowed: bool(communication.phoneAllowed, true),
      mailAllowed: bool(communication.mailAllowed, true),
      volunteerAllowed: bool(communication.volunteerAllowed, true),
    }
  }
  return profile
}
export function contactLabel(profile: ContactProfile): string {
  return profile.kind === 'organization'
    ? profile.organizationName
    : [profile.firstName, profile.lastName].filter(Boolean).join(' ')
}
export function validateRoles(input: unknown): ConstituentRole[] {
  if (
    !Array.isArray(input) ||
    input.some((role) => !constituentRoles.includes(role as ConstituentRole))
  )
    fail('Choose valid constituent roles.')
  return [...new Set(input as ConstituentRole[])]
}
export function validateContactTags(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 30) fail('Choose at most 30 contact tags.')
  const values = new Map<string, string>()
  for (const item of input as unknown[]) {
    const value = string(item, 80)
    if (!value) fail('Enter a nonblank tag.')
    values.set(value.toLocaleLowerCase('en-US'), value)
  }
  return [...values.values()]
}
