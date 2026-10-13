import type { PayloadRequest } from 'payload'
import type { MalwareScanner } from './maintenance'
export interface FormPlatform {
  db: D1Database
  storage: R2Bucket
  resolveSite?: (request: PayloadRequest) => string
  local?: boolean
  defer?: (work: () => Promise<void>) => void
  scanner?: MalwareScanner
  exportLimits?: { rows?: number; bytes?: number }
}
