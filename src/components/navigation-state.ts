export type ExpansionState = { user: string; route: string; open: Record<string, boolean> }

/** Navigation state belongs only to the mounted, signed-in page. Never persist it. */
export function enterNavigation(
  previous: ExpansionState | undefined,
  user: string,
  route: string,
  active?: string,
): ExpansionState {
  if (previous?.user === user && previous.route === route) return previous
  const open = previous?.user === user ? { ...previous.open } : {}
  if (active) open[active] = true
  return { user, route, open }
}

export function matchesAdminPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}
