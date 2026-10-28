export const INTERNAL_MEDIA_PREFIX = '__intranet__/'

/** Keep the existing upload adapter, but segregate internal objects physically.
 * Public file handlers can only read the public bucket. Protected reads use the
 * separately authorized publishing endpoint and the private bucket directly.
 */
export function publishingStorage(publicBucket: R2Bucket, privateBucket: R2Bucket): R2Bucket {
  return new Proxy(publicBucket, {
    get(target, property) {
      if (property === 'put') return (...args: Parameters<R2Bucket['put']>) =>
        (args[0].startsWith(INTERNAL_MEDIA_PREFIX) ? privateBucket : target).put(...args)
      if (property === 'delete') return async (keys: string | string[]) => {
        const values = Array.isArray(keys) ? keys : [keys]
        const internal = values.filter(key => key.startsWith(INTERNAL_MEDIA_PREFIX))
        const external = values.filter(key => !key.startsWith(INTERNAL_MEDIA_PREFIX))
        if (internal.length) await privateBucket.delete(internal)
        if (external.length) await target.delete(external)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
