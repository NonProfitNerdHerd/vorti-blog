import { describe, expect, it } from 'vitest'
import {
  assertSiteMove,
  evaluateSiteAuthority,
  sitePath,
  type PolicySnapshot,
  type SiteNode,
} from '../../src/organizations/policy'

const node = (id: string, parent: string | null, organization = 'network'): SiteNode => ({
  id,
  parent,
  organization,
  archived: false,
})
function fixture(): PolicySnapshot {
  return {
    sites: [
      node('national', null),
      node('region-a', 'national'),
      node('region-b', 'national'),
      node('local-a', 'region-a'),
      node('local-b', 'region-b'),
      node('other', null, 'unrelated'),
    ],
    memberships: [
      { user: 'national-admin', site: 'national', role: 'administrator', active: true },
      { user: 'local-admin', site: 'local-a', role: 'administrator', active: true },
      { user: 'regional-admin', site: 'region-a', role: 'administrator', active: true },
      { user: 'other-admin', site: 'other', role: 'administrator', active: true },
    ],
    rules: [],
    grants: [],
  }
}
const decide = (
  snapshot: PolicySnapshot,
  user = 'local-admin',
  owningSite = 'local-a',
  operation: 'read' | 'edit' | 'configure' | 'export' = 'read',
) =>
  evaluateSiteAuthority({
    snapshot,
    user,
    owningSite,
    operation,
    category: 'finances',
    installationOperator: false,
  })

describe('organization authority', () => {
  it('requires a grant; site context alone and unrelated membership confer no access', () => {
    const snapshot = fixture()
    expect(decide(snapshot).allowed).toBe(true)
    expect(decide(snapshot, 'unknown').allowed).toBe(false)
    expect(decide(snapshot, 'other-admin').allowed).toBe(false)
    expect(decide(snapshot, 'national-admin').allowed).toBe(false)
  })
  it('separates ancestor oversight by category and operation without sibling access', () => {
    const snapshot = fixture()
    snapshot.rules.push({
      site: 'national',
      category: 'finances',
      operation: 'read',
      descendantsAllowed: true,
      overseeDescendants: true,
    })
    expect(decide(snapshot, 'national-admin').reason).toBe('ancestor-oversight')
    expect(decide(snapshot, 'national-admin', 'local-a', 'edit').allowed).toBe(false)
    expect(decide(snapshot, 'regional-admin', 'local-b').allowed).toBe(false)
  })
  it('enforces the highest locked ancestor ceiling against child and sharing grants', () => {
    const snapshot = fixture()
    snapshot.rules.push(
      {
        site: 'national',
        category: 'finances',
        operation: 'edit',
        descendantsAllowed: false,
        overseeDescendants: false,
      },
      {
        site: 'region-a',
        category: 'finances',
        operation: 'edit',
        descendantsAllowed: true,
        overseeDescendants: true,
      },
    )
    expect(decide(snapshot, 'local-admin', 'local-a', 'edit')).toEqual({
      allowed: false,
      reason: 'ancestor-constraint',
      controllingSite: 'national',
    })
    expect(decide(snapshot, 'regional-admin', 'local-a', 'edit').allowed).toBe(false)
  })
  it('supports precise sharing and immediate revocation without sharing policy administration', () => {
    const snapshot = fixture()
    snapshot.grants.push({
      organization: 'network',
      source: 'local-b',
      receiver: 'local-a',
      receiverDescendants: false,
      category: 'finances',
      operations: ['read', 'configure'],
      revoked: false,
    })
    expect(decide(snapshot, 'local-admin', 'local-b').reason).toBe('explicit-sharing')
    expect(decide(snapshot, 'local-admin', 'local-b', 'edit').allowed).toBe(false)
    expect(decide(snapshot, 'local-admin', 'local-b', 'configure').allowed).toBe(false)
    snapshot.grants[0].revoked = true
    expect(decide(snapshot, 'local-admin', 'local-b').allowed).toBe(false)
  })
  it('never accepts forged cross-root grants', () => {
    const snapshot = fixture()
    snapshot.grants.push({
      organization: 'network',
      source: 'local-a',
      receiver: 'other',
      receiverDescendants: true,
      category: 'finances',
      operations: ['read'],
      revoked: false,
    })
    expect(decide(snapshot, 'other-admin').allowed).toBe(false)
  })
  it('fails closed for cycles, missing ancestors and duplicate policy', () => {
    const snapshot = fixture()
    snapshot.sites[0].parent = 'local-a'
    expect(decide(snapshot).reason).toBe('invalid-policy')
    snapshot.sites = fixture().sites.filter((site) => site.id !== 'region-a')
    expect(decide(snapshot).reason).toBe('invalid-policy')
    snapshot.sites = fixture().sites
    const rule = {
      site: 'national',
      category: 'finances' as const,
      operation: 'read' as const,
      descendantsAllowed: true,
      overseeDescendants: true,
    }
    snapshot.rules.push(rule, rule)
    expect(decide(snapshot).reason).toBe('invalid-policy')
  })
  it('makes archived trees read-only even for installation operators', () => {
    const snapshot = fixture()
    snapshot.sites[1].archived = true
    expect(decide(snapshot).allowed).toBe(true)
    expect(decide(snapshot, 'local-admin', 'local-a', 'edit').reason).toBe('archived')
    expect(
      evaluateSiteAuthority({
        snapshot,
        user: 'operator',
        installationOperator: true,
        owningSite: 'local-a',
        category: 'finances',
        operation: 'edit',
      }).allowed,
    ).toBe(false)
  })
  it('supports arbitrary depth and prevents root/cycle/cross-root moves', () => {
    const snapshot = fixture()
    for (let index = 0; index < 100; index++)
      snapshot.sites.push(node(`deep-${index}`, index ? `deep-${index - 1}` : 'local-a'))
    expect(sitePath(snapshot.sites, 'deep-99')).toHaveLength(103)
    expect(() => assertSiteMove(snapshot.sites, 'region-a', 'deep-99')).toThrow('itself')
    expect(() => assertSiteMove(snapshot.sites, 'local-a', 'other')).toThrow(
      'between organizations',
    )
    expect(() => assertSiteMove(snapshot.sites, 'national', 'region-b')).toThrow('root')
  })
})
