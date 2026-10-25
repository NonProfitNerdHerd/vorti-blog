import { expect, it } from 'vitest'
import { readImportResultPart, type ImportResultChunk } from '../../src/crm/import-export-parts'
import { importStorage } from '../helpers/crm-import-storage'

async function assemble(values: Uint8Array[], partBytes: number) {
  const fixture = importStorage(),
    chunks: ImportResultChunk[] = []
  for (const [ordinal, bytes] of values.entries()) {
    const key = `fictional-result/${ordinal}`
    const object = await fixture.storage.put(key, bytes)
    const sha256 = Array.from(new Uint8Array(object!.checksums.sha256!), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    chunks.push({ ordinal, object_key: key, bytes: bytes.length, sha256 })
  }
  const parts: Uint8Array[] = []
  let position = { ordinal: 0, offset: 0 },
    prefix = new Uint8Array(),
    steps = 0
  while (position.ordinal < chunks.length) {
    const result = await readImportResultPart(fixture.storage, {
      chunks: chunks.slice(position.ordinal, position.ordinal + 12),
      totalChunks: chunks.length,
      position,
      prefix,
      partBytes,
    })
    expect(result.reads).toBeLessThanOrEqual(12)
    expect(result.bytes.length).toBeLessThanOrEqual(partBytes)
    position = result.position
    prefix = result.ready ? new Uint8Array() : result.bytes
    if (result.ready) parts.push(result.bytes)
    expect(++steps).toBeLessThan(200)
  }
  return { fixture, chunks, parts, steps }
}

it('resumes bounded tiny-chunk assembly into fixed-size pieces without dropping or duplicating bytes', async () => {
  const source = Array.from({ length: 57 }, (_, index) => new Uint8Array([65 + (index % 26)]))
  const result = await assemble(source, 20)
  expect(result.parts.map((part) => part.length)).toEqual([20, 20, 17])
  expect(Buffer.concat(result.parts.map((part) => Buffer.from(part)))).toEqual(
    Buffer.concat(source.map((part) => Buffer.from(part))),
  )
  expect(result.steps).toBeGreaterThan(3)
})

it('splits oversized chunks at exact byte offsets, retaining UTF-8 content across multipart boundaries', async () => {
  const source = new TextEncoder().encode('𝄞a'.repeat(100))
  const result = await assemble([source], 17)
  const output = Buffer.concat(result.parts.map((part) => Buffer.from(part)))
  expect(output).toEqual(Buffer.from(source))
  expect(new TextDecoder('utf-8', { fatal: true }).decode(output)).toBe('𝄞a'.repeat(100))
  expect(result.parts.slice(0, -1).every((part) => part.length === 17)).toBe(true)
})

it('rejects stale manifests, unavailable objects and invalid or unbounded assembly positions', async () => {
  const { fixture, chunks } = await assemble([new TextEncoder().encode('header\r\n')], 20)
  const input = { chunks, totalChunks: 1, position: { ordinal: 0, offset: 0 }, partBytes: 20 }
  await expect(
    readImportResultPart(fixture.storage, {
      ...input,
      chunks: [{ ...chunks[0], sha256: '0'.repeat(64) }],
    }),
  ).rejects.toThrow('storage changed')
  await expect(
    readImportResultPart(fixture.storage, { ...input, chunks: [{ ...chunks[0], ordinal: 1 }] }),
  ).rejects.toThrow('chunks require review')
  await expect(
    readImportResultPart(fixture.storage, { ...input, position: { ordinal: 0, offset: 999 } }),
  ).rejects.toThrow()
  await expect(
    readImportResultPart(fixture.storage, { ...input, prefix: new Uint8Array(20) }),
  ).rejects.toThrow('position')
  await expect(
    readImportResultPart(fixture.storage, {
      ...input,
      chunks: Array.from({ length: 13 }, () => chunks[0]),
    }),
  ).rejects.toThrow('position')
  await fixture.storage.delete(chunks[0].object_key)
  await expect(readImportResultPart(fixture.storage, input)).rejects.toThrow('unavailable')
})
