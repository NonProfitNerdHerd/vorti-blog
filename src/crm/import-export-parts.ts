/** Bounded assembly of fixed-size multipart pieces from immutable private CSV chunks. */
export const importResultPartBytes = 8 * 1024 * 1024
export type ImportResultChunk = {
  ordinal: number
  object_key: string
  bytes: number
  sha256: string
}
export type ImportResultPosition = { ordinal: number; offset: number }
const hash = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
export async function readImportResultPart(
  storage: R2Bucket,
  input: {
    chunks: ImportResultChunk[]
    totalChunks: number
    position: ImportResultPosition
    prefix?: Uint8Array
    partBytes?: number
  },
) {
  const capacity = input.partBytes ?? importResultPartBytes
  let { ordinal, offset } = input.position
  const prefix = input.prefix ?? new Uint8Array()
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > importResultPartBytes ||
    !Number.isSafeInteger(input.totalChunks) ||
    input.totalChunks < 1 ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0 ||
    ordinal > input.totalChunks ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (ordinal === input.totalChunks && offset !== 0) ||
    prefix.length >= capacity ||
    input.chunks.length > 12
  )
    throw Error('Invalid import result assembly position.')
  const output = new Uint8Array(capacity)
  output.set(prefix)
  let length = prefix.length,
    reads = 0
  for (const chunk of input.chunks) {
    if (length === capacity || ordinal === input.totalChunks) break
    if (
      chunk.ordinal !== ordinal ||
      !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes < 1 ||
      offset >= chunk.bytes ||
      !/^[a-f0-9]{64}$/.test(chunk.sha256)
    )
      throw Error('Private import result chunks require review.')
    const requested = Math.min(capacity - length, chunk.bytes - offset)
    const object = await storage.get(chunk.object_key, { range: { offset, length: requested } })
    reads++
    if (
      !object ||
      !('body' in object) ||
      object.size !== chunk.bytes ||
      !object.checksums.sha256 ||
      hash(object.checksums.sha256) !== chunk.sha256
    ) {
      if (object && 'body' in object) await object.body.cancel().catch(() => {})
      throw Error('Private import result storage changed or is unavailable.')
    }
    const bytes = new Uint8Array(await object.arrayBuffer())
    if (bytes.length !== requested) throw Error('Private import result range is incomplete.')
    output.set(bytes, length)
    length += bytes.length
    offset += bytes.length
    if (offset === chunk.bytes) {
      ordinal++
      offset = 0
    } else break
  }
  if (reads === 0 && ordinal < input.totalChunks)
    throw Error('Private import result manifest is incomplete.')
  return {
    bytes: output.slice(0, length),
    position: { ordinal, offset },
    ready: length === capacity || ordinal === input.totalChunks,
    finished: ordinal === input.totalChunks,
    reads,
  }
}
