import { CRMJobPermanentError, type CRMJobHandler } from './jobs'
import { importApplyJob } from './import-apply-job'
import { importStageJob } from './import-stage-job'
import { importReviewJob } from './import-review-job'
import { importExportJob } from './import-export-job'
export function importJob(db: D1Database, storage: R2Bucket): CRMJobHandler {
  const stage = importStageJob(db, storage),
    apply = importApplyJob(db),
    review = importReviewJob(db),
    results = importExportJob(db, storage)
  return {
    async prepare(job) {
      let payload: { phase?: unknown }
      try {
        payload = JSON.parse(job.payload)
      } catch {
        throw new CRMJobPermanentError('invalid-request')
      }
      if (payload.phase === 'stage') return stage.prepare(job)
      if (payload.phase === 'apply') return apply.prepare(job)
      if (payload.phase === 'review') return review.prepare(job)
      if (payload.phase === 'results') return results.prepare(job)
      throw new CRMJobPermanentError('invalid-request')
    },
  }
}
