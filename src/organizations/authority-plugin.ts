import type { Config } from 'payload'
import { claimRequest, confirmRequestAuthority } from './identity-authority'
import { rejectMutationProofQuery } from './mutation-query'
/** Only an audited atomic authority mutation may acknowledge its intentional epoch change. */
export const AUTHORITY_MUTATION_COMMITTED = Symbol('atomic-authority-mutation-committed')

/** Populate capabilities from current D1 authority before any custom/native staff access checks. */
export const tenantAuthority = (config: Config): Config => {
  const endpoints = (values: NonNullable<Config['endpoints']>) =>
    values.map((endpoint) => ({
      ...endpoint,
      handler: async (...args: Parameters<typeof endpoint.handler>) => {
        await claimRequest(args[0])
        const response = await endpoint.handler(...args)
        if (!(args[0].context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED])
          await confirmRequestAuthority(args[0])
        return response
      },
    }))
  return {
    ...config,
    endpoints: endpoints(config.endpoints || []),
    collections: (config.collections || []).map((collection) => ({
      ...collection,
      endpoints: collection.endpoints === false ? false : endpoints(collection.endpoints || []),
      hooks: {
        ...collection.hooks,
        beforeOperation: [
          async ({ req, args }) => {
            rejectMutationProofQuery(args)
            await claimRequest(req)
          },
          ...(collection.hooks?.beforeOperation || []),
        ],
        afterOperation: [
          ...(collection.hooks?.afterOperation || []),
          async ({ req, result, operation }) => {
            if (['read', 'count', 'readDistinct'].includes(operation))
              await confirmRequestAuthority(req)
            return result
          },
        ],
      },
    })),
  }
}
