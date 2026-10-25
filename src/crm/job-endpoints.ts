import type { Endpoint } from 'payload'
import { constantEqual } from '../forms/security'
import { CRMJobs } from './jobs'
import { correspondenceJob } from './correspondence-job'
import { cleanDocumentOrphans } from './document-maintenance'
import { EmailDispatcher } from './email-dispatch'
import { reconcileNextEmail } from './email-reconciliation'
import type { EmailRuntime } from './email-provider'
export function crmJobEndpoints(
  platform: { db: D1Database; storage: R2Bucket; email?: EmailRuntime },
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/jobs/tick',
      method: 'post',
      handler: async (req) => {
        // Reuse the existing scheduled-service secret; every job still checks its recorded actor.
        const secret = process.env.FORM_JOB_TOKEN
        if (
          !secret ||
          secret.length < 32 ||
          !constantEqual(req.headers?.get('authorization') || '', `Bearer ${secret}`)
        )
          return Response.json(
            { message: 'Job authentication is required.' },
            { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
          )
        try {
          const runner = new CRMJobs(platform.db),
            handlers = { correspondence: correspondenceJob(platform.db, platform.storage) }
          let processed = 0
          for (let count = 0; count < 3; count++) {
            if (!(await runner.tick(handlers))) break
            processed++
          }
          const maintenance = await cleanDocumentOrphans(platform.db, platform.storage)
          const runtime = platform.email || {
            environment: 'development' as const,
            local: true,
            liveSendingEnabled: false,
          }
          const dispatcher = new EmailDispatcher(platform.db, platform.storage, runtime)
          let emailProcessed = 0,
            statusesChecked = 0
          for (let count = 0; count < 3; count++) {
            if (!(await dispatcher.tick())) break
            emailProcessed++
          }
          for (let count = 0; count < 2; count++) {
            if (!(await reconcileNextEmail(platform.db, runtime))) break
            statusesChecked++
          }
          return Response.json(
            { processed, maintenance, emailProcessed, statusesChecked },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
