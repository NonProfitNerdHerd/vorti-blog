/** Encrypt candidate cursors: denied sites must not leak IDs through pagination metadata. */
async function key() {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) throw new Error('Site pagination is temporarily unavailable.')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('site-cursor:' + secret),
  )
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function encodeSiteCursor(after: string, actor: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(String(actor)) },
      await key(),
      new TextEncoder().encode(after),
    ),
  )
  const bytes = new Uint8Array(iv.length + encrypted.length)
  bytes.set(iv)
  bytes.set(encrypted, iv.length)
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
export async function decodeSiteCursor(cursor: string, actor: number): Promise<string> {
  if (!cursor) return ''
  try {
    if (!/^[a-zA-Z0-9_-]{24,256}$/.test(cursor)) throw new Error('Invalid cursor')
    const bytes = Uint8Array.from(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')), (value) =>
      value.charCodeAt(0),
    )
    const after = new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes.slice(0, 12),
          additionalData: new TextEncoder().encode(String(actor)),
        },
        await key(),
        bytes.slice(12),
      ),
    )
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(after)) throw new Error('Invalid cursor')
    return after
  } catch {
    throw new Error('Choose a valid site page or reload the site list.')
  }
}
