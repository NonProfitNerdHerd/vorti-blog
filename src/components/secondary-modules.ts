export const secondaryModules = ['Tasks', 'Content', 'Intranet', 'CRM', 'Forms', 'Workflows', 'Site Design', 'Admin'] as const
export type SecondaryModule = (typeof secondaryModules)[number]
