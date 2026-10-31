export const secondaryModules = ['Tasks', 'Content', 'Intranet', 'CRM', 'Forms', 'Workflows', 'Admin'] as const
export type SecondaryModule = (typeof secondaryModules)[number]
