import { maintenanceResponse, type OperationsEnvironment } from './maintenance'
import { reconcileRetiredCallback } from './reconciliation'

/** Transitional Worker for releases whose previous application has no maintenance
 * support. It never imports the application, accepts writes, or dispatches jobs. */
export default {
  async fetch(request: Request, env: OperationsEnvironment & {STRIPE_TEST_WEBHOOK_SECRET?: string}) {
    try {
      return await reconcileRetiredCallback(request, env) || maintenanceResponse()
    } catch { return maintenanceResponse() }
  },
  async queue(batch: MessageBatch) { batch.retryAll({delaySeconds: 60}) },
  async scheduled() {},
}
