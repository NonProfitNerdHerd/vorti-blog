'use client'
import Link from 'next/link'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { ContactWorkspace } from './ContactWorkspace'
import { HouseholdWorkspace } from './HouseholdWorkspace'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { FundraisingWorkspace } from './FundraisingWorkspace'
import { CommitmentWorkspace } from './CommitmentWorkspace'
import { MembershipWorkspace } from './MembershipWorkspace'
import { OpportunityWorkspace } from './OpportunityWorkspace'
import { VolunteerWorkspace } from './VolunteerWorkspace'
import { CorrespondenceWorkspace } from './CorrespondenceWorkspace'
import { Gutter, useConfig } from '@payloadcms/ui'
import { usePathname, useSearchParams } from 'next/navigation'
import { OverviewWorkspace } from './OverviewWorkspace'
import { DonationWorkspace } from './DonationWorkspace'
import { ImportWorkspace } from './ImportWorkspace'
import './workspace.css'
import { RecordAttachmentPage } from './RecordAttachmentPage'
import { RecordTaskPage } from './RecordTaskPage'
export function CRMWorkspace() {
  const { config } = useConfig()
  const { binding } = useAdminSite()
  const params = useSearchParams()
  const pathname = usePathname()
  const sections = [
    ['overview', 'Overview'],
    ['contacts', 'Constituents'],
    ['donations', 'Donations'],
    ['households', 'Households'],
    ['fundraising', 'Campaigns, funds and appeals'],
    ['giving', 'Pledges and recurring'],
    ['memberships', 'Memberships'],
    ['opportunities', 'Opportunities'],
    ['volunteers', 'Volunteers'],
    ['correspondence', 'Receipts and correspondence'],
    ['imports', 'Imports'],
  ] as const
  const view = sections.some(([id]) => id === params.get('view')) ? params.get('view')! : 'overview'
  const href = (next: string) =>
    `${pathname}?${new URLSearchParams({ view: next, ...(binding?.site.id ? { site: binding.site.id } : {}) })}`
  if (params.get('view') === 'attachments' || params.get('view') === 'record-tasks') {
    const requested = params.get('site')
    if (!requested || requested !== binding?.site.id)
      return (
        <Gutter>
          <p role="alert">Open record tools with their authorized chapter selected.</p>
        </Gutter>
      )
    return params.get('view') === 'record-tasks' ? (
      <RecordTaskPage
        site={requested}
        type={params.get('recordType')}
        id={params.get('recordID')}
      />
    ) : (
      <RecordAttachmentPage
        site={requested}
        type={params.get('recordType')}
        id={params.get('recordID')}
      />
    )
  }
  if (params.get('site') && binding?.site.id && params.get('site') !== binding.site.id)
    return (
      <Gutter>
        <p role="alert">Select the chapter in this link before opening its CRM records.</p>
      </Gutter>
    )
  return (
    <div className="vc-crm-shell">
      <aside className="vc-crm-sidebar">
        <strong>Donor CRM</strong>
        <p>{binding?.site.name || 'Chapter workspace'}</p>
        <nav aria-label="CRM sections" className="vc-crm-modules">
          {sections.map(([id, label]) => (
            <Link
              key={id}
              href={href(id)}
              data-vc-crm-navigation="true"
              aria-current={view === id ? 'page' : undefined}
              onClick={(event) => {
                if (
                  hasUnsavedSiteChanges() &&
                  !window.confirm('Discard unsaved changes before changing CRM sections?')
                )
                  event.preventDefault()
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="vc-crm-main" key={`${binding?.site.id}:${view}`}>
        {view === 'overview' ? (
          <Gutter className="vc-crm">
            <OverviewWorkspace api={config.routes.api} site={binding?.site.id || ''} href={href} />
          </Gutter>
        ) : view === 'donations' ? (
          <Gutter className="vc-crm">
            <DonationWorkspace api={config.routes.api} site={binding?.site.id || ''} />
          </Gutter>
        ) : view === 'imports' ? (
          <Gutter className="vc-crm">
            <ImportWorkspace api={config.routes.api} site={binding?.site.id || ''} />
          </Gutter>
        ) : view === 'contacts' ? (
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
        ) : view === 'opportunities' ? (
          <Gutter className="vc-crm">
            <OpportunityWorkspace
              key={binding?.site.id}
              api={config.routes.api}
              site={binding?.site.id || ''}
            />
          </Gutter>
        ) : view === 'correspondence' ? (
          <Gutter className="vc-crm">
            <CorrespondenceWorkspace
              key={binding?.site.id}
              api={config.routes.api}
              site={binding?.site.id || ''}
            />
          </Gutter>
        ) : view === 'volunteers' ? (
          <Gutter className="vc-crm">
            <VolunteerWorkspace
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
      </div>
    </div>
  )
}
