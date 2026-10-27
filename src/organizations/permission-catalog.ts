export const crmPermissionCategories = ['identity', 'affiliations', 'finances', 'memberships', 'volunteer-experience', 'volunteer-hours', 'communications', 'restricted-activity', 'reports'] as const
const crmCategoryActions = crmPermissionCategories.flatMap(category => [`read-${category}`, `edit-${category}`, `export-${category}`] as const)
/** Catalog entries describe authority; they never enable an unimplemented operation. */
export const permissionCatalog = {
  pages: [
    'read-published',
    'read-history',
    'create',
    'edit',
    'delete',
    'publish',
    'import',
    'export',
  ],
  posts: [
    'read-published',
    'read-history',
    'create',
    'edit',
    'delete',
    'publish',
    'import',
    'export',
  ],
  tasks: [
    'read',
    'create',
    'edit',
    'delete',
    'comment',
    'assign',
    'manage-projects',
    'share',
    'configure',
  ],
  crm: [
    'read',
    'create',
    'edit',
    'archive',
    'delete',
    'import',
    'export',
    'merge',
    'assign',
    'configure',
    ...crmCategoryActions,
  ],
  forms: [
    'read',
    'create',
    'edit',
    'delete',
    'publish',
    'read-submissions',
    'update-submissions',
    'delete-submissions',
    'read-sensitive',
    'export',
    'configure-integrations',
  ],
  workflows: [
    'read',
    'create',
    'edit',
    'delete',
    'publish',
    'execute',
    'share-templates',
    'diagnostics',
    'cancel',
  ],
  wiki: [
    'read-published',
    'read-private',
    'read-history',
    'create',
    'edit',
    'delete',
    'publish',
    'manage-hierarchy',
  ],
  intranet: ['read', 'read-history', 'create', 'edit', 'delete', 'publish', 'manage-hierarchy'],
  administration: [
    'media',
    'categories',
    'tags',
    'menus',
    'designs',
    'templates',
    'saved-views',
    'redirects',
    'settings',
    'subsites',
    'website-publication',
    'features',
    'roles',
    'assignments',
    'tenant-administrators',
    'read-audit',
  ],
} as const

export type PermissionResource = keyof typeof permissionCatalog
export type Permission = {
  [R in PermissionResource]: `${R}:${(typeof permissionCatalog)[R][number]}`
}[PermissionResource]
export const permissions = Object.entries(permissionCatalog).flatMap(([resource, actions]) =>
  actions.map((action) => `${resource}:${action}` as Permission),
)
const knownPermissions = new Set<string>(permissions)
export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && knownPermissions.has(value)

export const applicationFeatures = [
  'pages',
  'posts',
  'tasks',
  'crm',
  'forms',
  'workflows',
  'wiki',
  'intranet',
] as const
export type ApplicationFeature = (typeof applicationFeatures)[number]
export type FeatureOverride = 'inherit' | 'enabled' | 'disabled'

/** These classify read operations only: exports and diagnostics need their own grants. */
export const readPermissions = new Set<Permission>([
  ...crmPermissionCategories.map(category => `crm:read-${category}` as Permission),
  'pages:read-published',
  'pages:read-history',
  'posts:read-published',
  'posts:read-history',
  'tasks:read',
  'crm:read',
  'forms:read',
  'forms:read-submissions',
  'forms:read-sensitive',
  'workflows:read',
  'wiki:read-published',
  'wiki:read-private',
  'wiki:read-history',
  'intranet:read',
  'intranet:read-history',
  'administration:read-audit',
])
