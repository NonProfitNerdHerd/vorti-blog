import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const pinned = readFileSync('.node-version', 'utf8').trim().replace(/^v/, '')
if (process.versions.node !== pinned) throw Error(`Generate binding types with Node ${pinned}.`)
const target = 'cloudflare-env.d.ts'
execFileSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'types',
    '--config',
    'wrangler.jsonc',
    '--env-interface',
    'CloudflareEnv',
    target,
  ],
  { stdio: 'inherit' },
)
// Keep upstream declarations reproducible across Windows and Linux, including
// whitespace emitted by the pinned workerd runtime declaration generator.
writeFileSync(
  target,
  readFileSync(target, 'utf8')
    .replaceAll('\r\n', '\n')
    .replace(/[\t ]+$/gm, ''),
)
