import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createArtifactManifest,
  inventoryArtifact,
  verifyArtifact,
} from '../../scripts/lib/release-artifact.mjs'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const identity = {
  sourceCommit: 'a'.repeat(40),
  sourceHash: 'b'.repeat(64),
  configurationHash: 'c'.repeat(64),
  migrationHash: 'd'.repeat(64),
  entrypoint: 'worker.js',
}
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vorti-release-artifact-'))
  roots.push(root)
  writeFileSync(
    path.join(root, 'worker.js'),
    'export default { fetch() { return new Response("ok") } }',
  )
  mkdirSync(path.join(root, 'assets'))
  writeFileSync(path.join(root, 'assets', 'style.css'), 'body { color: black }')
  return root
}
describe('retained release artifacts', () => {
  it('binds the entire upload tree to the frozen source, configuration and migrations', () => {
    const root = fixture(),
      manifest = createArtifactManifest(root, identity)
    expect(verifyArtifact(root, manifest, identity)).toBe(manifest.artifactHash)
    for (const key of [
      'sourceCommit',
      'sourceHash',
      'configurationHash',
      'migrationHash',
      'entrypoint',
    ])
      expect(() => verifyArtifact(root, manifest, { ...identity, [key]: 'other' })).toThrow(
        'identity mismatch',
      )
  })
  it('detects changed bytes, omitted files, extra files and altered manifests', () => {
    for (const change of ['bytes', 'missing', 'extra', 'manifest']) {
      const root = fixture(),
        manifest = createArtifactManifest(root, identity)
      if (change === 'bytes') writeFileSync(path.join(root, 'worker.js'), 'modified')
      if (change === 'missing') rmSync(path.join(root, 'assets', 'style.css'))
      if (change === 'extra') writeFileSync(path.join(root, 'injected.js'), 'extra upload')
      if (change === 'manifest') manifest.files[0].sha256 = 'e'.repeat(64)
      expect(() => verifyArtifact(root, manifest, identity)).toThrow(/changed/)
    }
  })
  it('rejects credential files and missing entrypoints before packaging', () => {
    const root = fixture()
    expect(() =>
      createArtifactManifest(root, { ...identity, entrypoint: '../outside.js' }),
    ).toThrow('entrypoint')
    writeFileSync(path.join(root, '.dev.vars'), 'SECRET=not-for-upload')
    expect(() => inventoryArtifact(root)).toThrow('Credential file')
  })
  it('does not follow links outside the frozen artifact tree', () => {
    const root = fixture(),
      external = fixture()
    symlinkSync(
      external,
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(() => inventoryArtifact(root)).toThrow('symlinks')
  })
})
