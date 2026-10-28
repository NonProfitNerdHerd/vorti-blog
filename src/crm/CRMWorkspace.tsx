'use client'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { ContactWorkspace } from './ContactWorkspace'
import { HouseholdWorkspace } from './HouseholdWorkspace'
import { crmURL, crmView } from './navigation'
import { FundraisingWorkspace } from './FundraisingWorkspace'
import { CommitmentWorkspace } from './CommitmentWorkspace'
import { MembershipWorkspace } from './MembershipWorkspace'
import { OpportunityWorkspace } from './OpportunityWorkspace'
import { VolunteerWorkspace } from './VolunteerWorkspace'
import { CorrespondenceWorkspace } from './CorrespondenceWorkspace'
import { Gutter, useConfig } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
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
  const view = crmView(params.get('view'))
  const constituentOpen = view === 'contacts' && Boolean(params.get('contact') || params.get('newContact') === '1')
  const href = (next: string) => crmURL(config.routes.admin, next, binding?.site.id)
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
      {!constituentOpen && <Gutter className="vc-crm-heading">
        <header aria-label="Donor CRM">
          <strong>Donor CRM</strong>
          <p>{binding?.site.name || 'Chapter workspace'}</p>
        </header>
      </Gutter>}

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
