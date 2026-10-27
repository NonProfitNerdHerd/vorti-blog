import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const digestPattern = /^[a-f0-9]{64}$/

/** The upload uses precisely this tree. Reject links and platform-dependent paths. */
export function inventoryArtifact(directory) {
  const root = path.resolve(directory)
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
    throw Error('Artifact root must be a real directory.')
  const files = []
  const walk = (relative) => {
    for (const name of readdirSync(path.join(root, relative)).sort()) {
      if (/[\\:]/.test(name) || name === '.' || name === '..') throw Error('Unsafe artifact path.')
      const location = relative ? `${relative}/${name}` : name
      const absolute = path.join(root, location)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw Error(`Artifact symlinks are forbidden: ${location}`)
      if (stat.isDirectory()) walk(location)
      else if (stat.isFile()) {
        if (
          /^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|.*\.(?:pem|key)|credentials\.json)$/i.test(name)
        )
          throw Error(`Credential file is forbidden in the artifact: ${location}`)
        const bytes = readFileSync(absolute)
        files.push({ path: location, size: bytes.length, sha256: sha256(bytes) })
      } else throw Error(`Unsupported artifact entry: ${location}`)
    }
  }
  walk('')
  if (!files.length) throw Error('Artifact is empty.')
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function createArtifactManifest(directory, identity) {
  if (
    !/^[a-f0-9]{40}$/.test(identity.sourceCommit) ||
    !digestPattern.test(identity.sourceHash) ||
    !digestPattern.test(identity.configurationHash) ||
    !digestPattern.test(identity.migrationHash)
  )
    throw Error('Missing frozen release identity.')
  const files = inventoryArtifact(directory)
  if (!files.some((file) => file.path === identity.entrypoint))
    throw Error('Worker entrypoint is absent from the artifact.')
  const manifest = { format: 1, ...identity, files }
  return { ...manifest, artifactHash: sha256(JSON.stringify(manifest)) }
}

/** Required immediately before upload and again when accepting the retained artifact. */
export function verifyArtifact(directory, manifest, expected) {
  if (manifest.format !== 1 || !digestPattern.test(manifest.artifactHash))
    throw Error('Invalid artifact manifest.')
  const { artifactHash, ...unsigned } = manifest
  if (sha256(JSON.stringify(unsigned)) !== artifactHash) throw Error('Artifact manifest changed.')
  for (const key of [
    'sourceCommit',
    'sourceHash',
    'configurationHash',
    'migrationHash',
    'entrypoint',
  ])
    if (manifest[key] !== expected[key]) throw Error(`Artifact identity mismatch: ${key}.`)
  const actual = inventoryArtifact(directory)
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files))
    throw Error('Artifact contents changed after validation. Rebuild and repeat acceptance checks.')
  return artifactHash
}
