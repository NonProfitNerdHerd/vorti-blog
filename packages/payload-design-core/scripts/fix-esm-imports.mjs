import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../dist/', import.meta.url)
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if (entry.name.endsWith('.js')) {
      const source = readFileSync(path, 'utf8')
      const result = source.replace(/(\bfrom\s*['"]|\bimport\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
        (match, prefix, specifier, suffix) => /\.(js|css|json)$/.test(specifier) ? match : `${prefix}${specifier}.js${suffix}`)
      writeFileSync(path, result)
    }
  }
}
visit(root.pathname)
