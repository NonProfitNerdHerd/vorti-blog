import fs from 'node:fs/promises'
import crypto from 'node:crypto'
const origin = new URL(process.env.FORM_LOCAL_ORIGIN || 'http://localhost:3105')
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Development onboarding only supports loopback addresses.')
const destination = '.wrangler/forms-local-admin.json'
const response = await fetch(new URL('/api/users/init', origin))
if (!response.ok) throw new Error(`Local initialization check failed: HTTP ${response.status}`)
const { initialized } = await response.json()
if (initialized) {
  await fs.access(destination).catch(() => { throw new Error('This local database already has users. Sign in with its existing account; onboarding will not replace users or passwords.') })
  console.log('Existing local onboarding credentials retained in the ignored .wrangler directory.')
} else {
  const credentials = { username: process.env.FORM_ADMIN_USERNAME || 'forms-local', email: process.env.FORM_ADMIN_EMAIL || 'forms-local@example.test', password: process.env.FORM_ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64url'), role: 'administrator' }
  const created = await fetch(new URL('/api/users/first-register', origin), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin.origin }, body: JSON.stringify(credentials) })
  if (!created.ok) throw new Error(`Local onboarding failed: HTTP ${created.status}`)
  await fs.mkdir('.wrangler', { recursive: true })
  await fs.writeFile(destination, JSON.stringify(credentials), { mode: 0o600 })
  console.log('Local administrator created. Credentials are in .wrangler/forms-local-admin.json; do not commit or share that file.')
}
