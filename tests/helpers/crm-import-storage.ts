export function importStorage() {
  const objects = new Map<
    string,
    {
      bytes: Uint8Array
      sha256: ArrayBuffer
      customMetadata?: Record<string, string>
      uploaded: Date
    }
  >()
  const uploads = new Map<
    string,
    {
      key: string
      options?: R2MultipartOptions
      parts: Map<number, { bytes: Uint8Array; etag: string }>
    }
  >()
  let lostPartReply = false,
    lostCompleteReply = false
  let lostReply = false
  const metadata = (key: string) => {
    const value = objects.get(key)
    return value
      ? {
          key,
          size: value.bytes.length,
          etag: 'fictional-' + value.bytes.length,
          checksums: { sha256: value.sha256 },
          customMetadata: value.customMetadata,
          uploaded: value.uploaded,
        }
      : null
  }
  const storage = {
    async list(options: { prefix: string; limit: number; cursor?: string }) {
      const matching = [...objects.keys()]
        .filter(
          (key) => key.startsWith(options.prefix) && (!options.cursor || key > options.cursor),
        )
        .sort()
      const keys = matching.slice(0, options.limit)
      return {
        objects: keys.map((key) => metadata(key)!),
        truncated: matching.length > keys.length,
        cursor: keys.at(-1) || '',
      }
    },
    async createMultipartUpload(key: string, options?: R2MultipartOptions) {
      const id = crypto.randomUUID()
      uploads.set(id, { key, options, parts: new Map() })
      return storage.resumeMultipartUpload(key, id)
    },
    resumeMultipartUpload(key: string, id: string) {
      const session = () => {
        const upload = uploads.get(id)
        if (!upload || upload.key !== key) throw Error('Fictional multipart upload missing')
        return upload
      }
      return {
        key,
        uploadId: id,
        async uploadPart(partNumber: number, input: Uint8Array) {
          const bytes = new Uint8Array(input),
            etag = Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join('')
          session().parts.set(partNumber, { bytes, etag })
          if (lostPartReply) {
            lostPartReply = false
            throw Error('Fictional lost multipart part reply')
          }
          return { partNumber, etag }
        },
        async complete(parts: R2UploadedPart[]) {
          const upload = session()
          const values = parts.map((part, index) => {
            const value = upload.parts.get(part.partNumber)
            if (!value || value.etag !== part.etag || part.partNumber !== index + 1)
              throw Error('Fictional invalid multipart manifest')
            return value.bytes
          })
          if (values.slice(0, -1).some((bytes) => bytes.length !== 8 * 1024 * 1024))
            throw Error('Fictional non-final part size mismatch')
          const joined = new Uint8Array(values.reduce((sum, bytes) => sum + bytes.length, 0))
          let offset = 0
          for (const bytes of values) {
            joined.set(bytes, offset)
            offset += bytes.length
          }
          objects.set(key, {
            bytes: joined,
            sha256: await crypto.subtle.digest('SHA-256', joined),
            customMetadata: upload.options?.customMetadata,
            uploaded: new Date(),
          })
          uploads.delete(id)
          if (lostCompleteReply) {
            lostCompleteReply = false
            throw Error('Fictional lost multipart completion reply')
          }
          return metadata(key)!
        },
        async abort() {
          uploads.delete(id)
        },
      }
    },
    async head(key: string) {
      return metadata(key)
    },
    async delete(key: string | string[]) {
      for (const item of typeof key === 'string' ? [key] : key) objects.delete(item)
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
      objects.set(key, { bytes: new Uint8Array(bytes), sha256, uploaded: new Date() })
      if (lostReply) {
        lostReply = false
        throw new Error('Fictional lost R2 reply')
      }
      return metadata(key)
    },
    async get(key: string, options?: { range?: { offset: number; length?: number } }) {
      const value = objects.get(key),
        meta = metadata(key)
      if (!value || !meta) return null
      const offset = options?.range?.offset ?? 0
      const response = new Response(
        value.bytes.subarray(
          offset,
          options?.range?.length === undefined ? undefined : offset + options.range.length,
        ),
      )
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
    uploads,
    loseNextPartReply: () => {
      lostPartReply = true
    },
    loseNextCompleteReply: () => {
      lostCompleteReply = true
    },
    loseNextReply: () => {
      lostReply = true
    },
  }
}
