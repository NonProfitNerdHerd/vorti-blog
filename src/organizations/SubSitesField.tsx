'use client'
import { OrganizationWorkspace } from './OrganizationWorkspace'

export function SubSitesField() {
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
          event.preventDefault()
      }}
    >
      <OrganizationWorkspace />
    </div>
  )
}
