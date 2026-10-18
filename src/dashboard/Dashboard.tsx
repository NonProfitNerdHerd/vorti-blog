import type { AdminViewServerProps } from 'payload'
import { DashboardClient } from './DashboardClient'

/** Supported Payload Dashboard view; collection and task access stays in native APIs. */
export function Dashboard({ initPageResult }: AdminViewServerProps) {
  return <DashboardClient collections={initPageResult.visibleEntities.collections} />
}
