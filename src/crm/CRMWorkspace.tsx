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
import { CRMSearchWorkspace } from './CRMSearchWorkspace'
import './workspace.css'
import { RecordAttachmentPage } from './RecordAttachmentPage'
import { RecordTaskPage } from './RecordTaskPage'
export function CRMWorkspace() {
  const { config } = useConfig()
  const { binding } = useAdminSite()
  const params = useSearchParams()
  const view = crmView(params.get('view'))
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
      <div className="vc-crm-main" key={`${binding?.site.id}:${view}`}>
        {view === 'search' ? (
          <Gutter className="vc-crm"><CRMSearchWorkspace api={config.routes.api} admin={config.routes.admin} site={binding?.site.id || ''} /></Gutter>
        ) : view === 'overview' ? (
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
        ) : view === 'contacts' || view === 'organizations' ? (
          <ContactWorkspace kind={view === 'organizations' ? 'organization' : 'person'} />
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
              initialRecord={params.get('result') || undefined}
              initialKind={params.get('resultType') === 'recurring' ? 'recurring' : 'pledge'}
            />
          </Gutter>
        ) : view === 'opportunities' ? (
          <Gutter className="vc-crm">
            <OpportunityWorkspace
              key={binding?.site.id}
              api={config.routes.api}
              site={binding?.site.id || ''}
              initialRecord={params.get('result') || undefined}
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
              initialView={params.get('volunteerView') === 'hours' ? 'hours' : params.get('volunteerView') === 'activities' ? 'activities' : 'profiles'}
              initialRecord={params.get('result') || undefined}
              initialType={params.get('resultType') || undefined}
            />
          </Gutter>
        ) : (
          <Gutter className="vc-crm">
            <MembershipWorkspace
              key={binding?.site.id}
              api={config.routes.api}
              site={binding?.site.id || ''}
              initialRecord={params.get('result') || undefined}
            />
          </Gutter>
        )}
      </div>
    </div>
  )
}
