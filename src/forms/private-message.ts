/** Authenticated encryption keeps private resume URLs out of ordinary job/delivery responses. */
async function key(secret: string) {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`forms-private-message-v1:${secret}`))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))
export async function sealMessage(secret: string, context: string, message: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await key(secret), new TextEncoder().encode(message))
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`
}
export async function openMessage(secret: string, context: string, envelope: string): Promise<string> {
  const [version, iv, encrypted, extra] = envelope.split('.')
  if (version !== 'v1' || !iv || !encrypted || extra) throw new Error('Invalid private message envelope.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(context) }, await key(secret), decode(encrypted))
  return new TextDecoder().decode(plain)
}
