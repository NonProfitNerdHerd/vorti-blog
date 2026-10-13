import type { FormDefinition } from '@design-system/payload-design-core/forms'
import { embedOrigin } from '../../packages/payload-design-core/src/forms/embed'

export class FormHTTPError extends Error { constructor(message: string, public status = 400) { super(message) } }
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function hashToken(token: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))).map(b => b.toString(16).padStart(2, '0')).join('')
}
export function constantEqual(left: string, right: string): boolean {
  let different = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) different |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0)
  return different === 0
}
export async function readBoundedJSON(request: { headers: Headers; body?: ReadableStream<Uint8Array> | null }, max = 512000): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new FormHTTPError('Use application/json.', 415)
  if (Number(request.headers.get('content-length')) > max) throw new FormHTTPError('Request is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new FormHTTPError('A request body is required.')
  const chunks: Uint8Array[] = []; let size = 0
  while (true) {
    const part = await reader.read(); if (part.done) break
    size += part.value.byteLength
    if (size > max) { await reader.cancel(); throw new FormHTTPError('Request is too large.', 413) }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new FormHTTPError('Invalid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FormHTTPError('Expected an object.')
  const inspect = (node: unknown, depth = 0): void => {
    if (depth > 24) throw new FormHTTPError('Request is too deeply nested.')
    if (node && typeof node === 'object') for (const [key, child] of Object.entries(node)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new FormHTTPError('Invalid property name.')
      inspect(child, depth + 1)
    }
  }
  inspect(value); return value as Record<string, unknown>
}
export function checkOrigin(request: { headers: Headers; url?: string }, definition: FormDefinition): string {
  if (!request.url) throw new FormHTTPError('Request URL is required.')
  const origin = request.headers.get('origin'), own = new URL(request.url).origin
  if (!origin || ![own, ...definition.access.origins.map(embedOrigin)].includes(origin)) throw new FormHTTPError('This origin cannot submit this form.', 403)
  return origin
}
export function safeFilename(value: string): string {
  return value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 140) || 'attachment'
}
export function fileSignature(bytes: Uint8Array, mime: string): boolean {
  const starts = (magic: number[]) => magic.every((n, i) => bytes[i] === n)
  if (mime === 'application/pdf') return starts([0x25, 0x50, 0x44, 0x46, 0x2d])
  if (mime === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (mime === 'image/jpeg') return starts([0xff, 0xd8, 0xff])
  if (mime === 'image/webp') return starts([0x52, 0x49, 0x46, 0x46]) && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  if (mime === 'text/plain' || mime === 'text/csv') return !bytes.includes(0)
  // Unsupported signatures are rejected rather than guessed from the extension.
  return false
}
export async function rateLimit(db: D1Database, key: string, limit: number, now = Date.now()): Promise<void> {
  const window = Math.floor(now / 60000)
  const row = await db.prepare('INSERT INTO form_rate_windows (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count').bind(key, window).first<{ count: number }>()
  if (!row || row.count > Math.max(1, Math.min(limit, 1000))) throw new FormHTTPError('Too many requests. Please wait a minute and retry.', 429)
}
