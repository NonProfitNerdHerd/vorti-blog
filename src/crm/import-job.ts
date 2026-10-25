import { CRMJobPermanentError, type CRMJobHandler } from './jobs'
import { importApplyJob } from './import-apply-job'
import { importStageJob } from './import-stage-job'
export function importJob(db: D1Database, storage: R2Bucket): CRMJobHandler {
  const stage = importStageJob(db, storage),
    apply = importApplyJob(db)
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
      throw new CRMJobPermanentError('invalid-request')
    },
  }
}
