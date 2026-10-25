export function importStorage() {
  const objects = new Map<string, { bytes: Uint8Array; sha256: ArrayBuffer }>()
  let lostReply = false
  const metadata = (key: string) => {
    const value = objects.get(key)
    return value
      ? {
          key,
          size: value.bytes.length,
          etag: 'fictional-' + value.bytes.length,
          checksums: { sha256: value.sha256 },
        }
      : null
  }
  const storage = {
    async head(key: string) {
      return metadata(key)
    },
    async put(key: string, input: Uint8Array | ReadableStream<Uint8Array>, options?: R2PutOptions) {
      if (objects.has(key) && options?.onlyIf) return null
      const bytes =
        input instanceof Uint8Array
          ? input
          : new Uint8Array(await new Response(input).arrayBuffer())
      const sha256 = await crypto.subtle.digest('SHA-256', bytes)
      const hex = Array.from(new Uint8Array(sha256), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      if (typeof options?.sha256 === 'string' && options.sha256 !== hex)
        throw new Error('Fictional checksum mismatch')
      objects.set(key, { bytes: new Uint8Array(bytes), sha256 })
      if (lostReply) {
        lostReply = false
        throw new Error('Fictional lost R2 reply')
      }
      return metadata(key)
    },
    async get(key: string, options?: { range?: { offset: number } }) {
      const value = objects.get(key),
        meta = metadata(key)
      if (!value || !meta) return null
      const response = new Response(value.bytes.subarray(options?.range?.offset ?? 0))
      return {
        ...meta,
        body: response.body!,
        arrayBuffer: () => response.arrayBuffer(),
        text: () => response.text(),
      }
    },
  } as unknown as R2Bucket
  return {
    storage,
    objects,
    loseNextReply: () => {
      lostReply = true
    },
  }
}
