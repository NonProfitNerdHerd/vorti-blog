import type { DocumentViewServerProps } from 'payload'
import { MenuWorkspaceClient } from './MenuWorkspaceClient'
export function MenuWorkspace({ user }: DocumentViewServerProps) {
  return user ? <MenuWorkspaceClient /> : <p>Sign in to manage menus.</p>
}
