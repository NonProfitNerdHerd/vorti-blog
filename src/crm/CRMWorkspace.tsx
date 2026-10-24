'use client'
import { useState } from 'react'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { ContactWorkspace } from './ContactWorkspace'
import { HouseholdWorkspace } from './HouseholdWorkspace'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { FundraisingWorkspace } from './FundraisingWorkspace'
import { CommitmentWorkspace } from './CommitmentWorkspace'
import { MembershipWorkspace } from './MembershipWorkspace'
import { Gutter, useConfig } from '@payloadcms/ui'
export function CRMWorkspace() {
  const [view, setView] = useState<
    'contacts' | 'households' | 'fundraising' | 'giving' | 'memberships'
  >('contacts')
  const { config } = useConfig()
  const { binding } = useAdminSite()
  const navigate = (next: typeof view) => {
    if (
      next !== view &&
      (!hasUnsavedSiteChanges() ||
        window.confirm('Discard unsaved changes before changing CRM sections?'))
    )
      setView(next)
  }
  return (
    <>
      <nav
        aria-label="CRM sections"
        className="vc-crm-toolbar vc-crm-modules"
        style={{ padding: '16px 24px' }}
      >
        <button
          type="button"
          aria-pressed={view === 'contacts'}
          onClick={() => navigate('contacts')}
        >
          Contacts
        </button>
        <button
          type="button"
          aria-pressed={view === 'households'}
          onClick={() => navigate('households')}
        >
          Households
        </button>
        <button
          type="button"
          aria-pressed={view === 'fundraising'}
          onClick={() => navigate('fundraising')}
        >
          Fundraising
        </button>
        <button type="button" aria-pressed={view === 'giving'} onClick={() => navigate('giving')}>
          Pledges and recurring
        </button>
        <button
          type="button"
          aria-pressed={view === 'memberships'}
          onClick={() => navigate('memberships')}
        >
          Memberships
        </button>
      </nav>
      {view === 'contacts' ? (
        <ContactWorkspace />
      ) : view === 'households' ? (
        <HouseholdWorkspace key={binding?.site.id} />
      ) : view === 'fundraising' ? (
        <FundraisingWorkspace key={binding?.site.id} />
      ) : view === 'giving' ? (
        <Gutter className="vc-crm">
          <CommitmentWorkspace
            key={binding?.site.id}
            api={config.routes.api}
            site={binding?.site.id || ''}
          />
        </Gutter>
      ) : (
        <Gutter className="vc-crm">
          <MembershipWorkspace
            key={binding?.site.id}
            api={config.routes.api}
            site={binding?.site.id || ''}
          />
        </Gutter>
      )}
    </>
  )
}
