import { organizationSchema as v1 } from './schema-v1'
import { organizationSchemaV2 } from './schema-v2'
import { organizationSchemaV3 } from './schema-v3'
export { defaultOrganizationSeed } from './schema-v1'
export const organizationSchema = [...v1, ...organizationSchemaV2, ...organizationSchemaV3] as const
