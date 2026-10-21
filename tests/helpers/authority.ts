import { SERVER_AUTHORITY, type AuthorityClaim } from '../../src/organizations/claims'
import type { SiteOperation } from '../../src/organizations/policy'

/** Explicit server-derived fixture claims; production code never infers these from legacy roles. */
export function fixtureUser(role = 'editor', id = 3, site = 'default') {
  const all: SiteOperation[] = ['read', 'edit', 'publish', 'export', 'configure']
  const claim: AuthorityClaim = {
    actor: id,
    site,
    organization: site,
    epoch: 1,
    operator: role === 'administrator',
    bootstrap: false,
    allowed: {
      content: all,
      workspace: all,
      forms:
        role === 'administrator' ? all : role === 'designer' ? ['read', 'edit', 'publish'] : [],
      'form-submissions': role === 'administrator' ? all : role === 'editor' ? ['read'] : [],
    },
  }
  return { id, role, [SERVER_AUTHORITY]: claim }
}
