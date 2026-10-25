/** Immutable private import uploads. Workers stream through a fixed-length pipe;
 * Node development/tests use a bounded buffer when that Worker API is absent.
 * Publication in D1 happens separately, after current authorization is rechecked.
 */
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
export function verifyImportObject(
  object: R2Object | null,
  expected: { file_size: number; file_sha256: string },
) {
  if (
    !object ||
    object.size !== expected.file_size ||
    !object.checksums.sha256 ||
    hex(object.checksums.sha256) !== expected.file_sha256
  )
    throw new Error('Choose file data matching the staged size and checksum.')
  return object
}
export async function putImportUpload(
  storage: R2Bucket,
  key: string,
  body: ReadableStream<Uint8Array>,
  expected: { file_size: number; file_sha256: string; file_kind: 'csv' | 'xlsx' },
) {
  const existing = await storage.head(key)
  if (existing) {
    verifyImportObject(existing, expected)
    await body.cancel().catch(() => {})
    return
  }
  const options: R2PutOptions = {
    onlyIf: { etagDoesNotMatch: '*' },
    sha256: expected.file_sha256,
    httpMetadata: {
      contentType:
        expected.file_kind === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      cacheControl: 'private, no-store',
    },
  }
  let object: R2Object | null
  if (typeof FixedLengthStream !== 'undefined') {
    const fixed = new FixedLengthStream(expected.file_size),
      controller = new AbortController()
    let pipeError: unknown
    const pipe = body.pipeTo(fixed.writable, { signal: controller.signal }).catch((error) => {
      pipeError = error
    })
    try {
      object = await storage.put(key, fixed.readable, options)
      if (!object) controller.abort()
      await pipe
      if (object && pipeError) throw new Error('Choose file data matching the staged size.')
    } finally {
      controller.abort()
      await pipe
    }
  } else {
    const reader = body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const value = await reader.read()
        if (value.done) break
        size += value.value.length
        if (size > expected.file_size) throw new Error('Choose file data matching the staged size.')
        chunks.push(value.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (size !== expected.file_size) throw new Error('Choose file data matching the staged size.')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== expected.file_sha256)
      throw new Error('Choose file data matching the staged checksum.')
    object = await storage.put(key, bytes, options)
  }
  verifyImportObject(object ?? (await storage.head(key)), expected)
}
