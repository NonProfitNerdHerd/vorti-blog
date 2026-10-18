'use client'
import Link from 'next/link'
import { useConfig } from '@payloadcms/ui'
export function SettingsHubLink() {
  const { config } = useConfig()
  return (
    <p>
      Manage site identity, dates, pages, and features in{' '}
      <Link href={`${config.routes.admin}/globals/system-settings`}>Site → Settings</Link>.
    </p>
  )
}
