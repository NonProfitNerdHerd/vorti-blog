import type { DocumentViewServerProps } from 'payload'
import { SettingsHubClient } from './SettingsHubClient'

export async function SettingsHub({ user, payload }: DocumentViewServerProps) {
  if (user?.role !== 'administrator') return <p>You do not have access to Settings.</p>
  const [site, system] = await Promise.all([
    payload.findGlobal({ slug: 'site-settings', depth: 1, user, overrideAccess: false }),
    payload.findGlobal({ slug: 'system-settings', depth: 0, user, overrideAccess: false }),
  ])
  return <SettingsHubClient initialSite={site} initialSystem={system} />
}
