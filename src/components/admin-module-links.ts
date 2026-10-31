import { crmSections, crmURL, crmView } from '../crm/navigation'
import { siteURL } from '../organizations/admin-site'
import { matchesAdminPath } from './navigation-state'
import type { SecondaryModule } from './secondary-modules'

export type NavEntity = { slug: string; type: string; label: string | Record<string, string> }
export type NavGroup = { label: string; entities: NavEntity[] }
export type ModuleLink = { id: string; label: string; href: string; active: boolean }

export function currentModule(pathname: string, params: URLSearchParams, admin: string, groups: NavGroup[]): SecondaryModule | null {
  if (matchesAdminPath(pathname, `${admin}/crm`)) return 'CRM'
  if (matchesAdminPath(pathname, `${admin}/collections/review-tasks`)) return 'Tasks'
  if (matchesAdminPath(pathname, `${admin}/workflows`) || matchesAdminPath(pathname, `${admin}/automations`)) return 'Workflows'
  if (matchesAdminPath(pathname, `${admin}/intranet/groups`)) return 'Intranet'
  if (matchesAdminPath(pathname, `${admin}/sites`)) return 'Admin'
  const audience = params.get('audience') === 'intranet' ? 'Intranet' : 'Content'
  if (new RegExp(`^${admin}/collections/(posts|pages|media|categories|tags|saved-views)(/|$)`).test(pathname)) return audience
  for (const group of groups) {
    if (!['Content', 'Forms', 'Site Design', 'Admin'].includes(group.label)) continue
    if (group.entities.some(entity => matchesAdminPath(pathname, entityURL(admin, entity))))
      return group.label === 'Site Design' ? audience : group.label as SecondaryModule
  }
  return null
}

export function entityURL(admin: string, entity: NavEntity) {
  return `${admin}/${entity.type === 'globals' ? 'globals' : 'collections'}/${entity.slug}`
}

export function moduleLinks(module: SecondaryModule, args: {
  admin: string
  site: string
  pathname: string
  params: URLSearchParams
  groups: NavGroup[]
  language: string
  categoriesEnabled: boolean
  groupManagement: boolean
}): ModuleLink[] {
  const { admin, site, pathname, params, groups, language, categoriesEnabled, groupManagement } = args
  const designLinks = (audience: 'public' | 'intranet'): ModuleLink[] =>
    (groups.find(group => group.label === 'Site Design')?.entities || []).map(entity => {
      const base = entityURL(admin, entity)
      const label = typeof entity.label === 'string' ? entity.label : entity.label[language] || Object.values(entity.label)[0] || entity.slug
      return {
        id: entity.slug, label,
        href: `${base}?site=${encodeURIComponent(site)}&audience=${audience}`,
        active: matchesAdminPath(pathname, base) && (params.get('audience') === 'intranet' ? 'intranet' : 'public') === audience,
      }
    })
  if (module === 'CRM') return crmSections.map(([id, label]) => ({
    id, label, href: crmURL(admin, id, site),
    active: matchesAdminPath(pathname, `${admin}/crm`) && crmView(params.get('view')) === id,
  }))
  if (module === 'Tasks') return ([
    ['inbox', 'Inbox', '?workspace=inbox'], ['assigned', 'My tasks', '?taskView=assigned'],
    ['all', 'All tasks', ''], ['projects', 'Projects', '?workspace=projects'],
    ['boards', 'Boards', '?workspace=boards'],
  ] as const).map(([id, label, query]) => ({ id, label, href: siteURL(`${admin}/collections/review-tasks${query}`, site, admin, 'https://admin.local'),
    active: matchesAdminPath(pathname, `${admin}/collections/review-tasks`) &&
      (params.get('workspace') || (params.get('taskView') === 'assigned' ? 'assigned' : 'all')) === id }))
  if (module === 'Workflows') return ([['create', 'Create Workflows'], ['my', 'My Workflows'], ['shared', 'Shared Workflows']] as const)
    .map(([id, label]) => ({ id, label, href: `${admin}/workflows?workflowView=${id}&site=${encodeURIComponent(site)}`,
      active: (matchesAdminPath(pathname, `${admin}/workflows`) || matchesAdminPath(pathname, `${admin}/automations`)) &&
        (params.get('workflowView') || 'my') === id }))
  if (module === 'Intranet') {
    const links: ModuleLink[] = ([['posts', 'Posts'], ['pages', 'Pages'], ['media', 'Media'],
      ['categories', 'Categories'], ['tags', 'Tags'], ['saved-views', 'Saved Views']] as const)
      .filter(([id]) => id !== 'categories' || categoriesEnabled)
      .map(([id, label]) => ({ id, label, href: `${admin}/collections/${id}?site=${encodeURIComponent(site)}&audience=intranet`,
        active: params.get('audience') === 'intranet' && matchesAdminPath(pathname, `${admin}/collections/${id}`) }))
    if (groupManagement) links.push({ id: 'groups', label: 'Sharing Groups',
      href: `${admin}/intranet/groups?site=${encodeURIComponent(site)}&audience=intranet`,
      active: matchesAdminPath(pathname, `${admin}/intranet/groups`) })
    return [...links, ...designLinks('intranet')]
  }
  const group = groups.find(value => value.label === module)
  const links = (group?.entities || []).filter(entity => categoriesEnabled || entity.slug !== 'categories').map(entity => {
    const base = entityURL(admin, entity)
    const label = typeof entity.label === 'string' ? entity.label : entity.label[language] || Object.values(entity.label)[0] || entity.slug
    const href = module === 'Content' ? `${base}?site=${encodeURIComponent(site)}&audience=public`
      : siteURL(base, site, admin, 'https://admin.local')
    return { id: entity.slug, label, href,
      active: matchesAdminPath(pathname, base) && (module !== 'Content' || params.get('audience') !== 'intranet') }
  })
  return module === 'Content' ? [...links, ...designLinks('public')] : links
}
