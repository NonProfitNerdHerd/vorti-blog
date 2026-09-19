import type { BlockRegistration } from './types'

export function createBlockRegistry(entries: BlockRegistration[] = []) {
  const registered = new Map<string, BlockRegistration>()
  for (const entry of entries) {
    if (registered.has(entry.slug)) throw new Error(`Duplicate block type: ${entry.slug}`)
    registered.set(entry.slug, entry)
  }
  return {
    get: (slug: string) => registered.get(slug),
    list: () => [...registered.values()],
  }
}

// A consuming React application maps a trusted rendererKey to its own component.
// No component or source code is stored in Payload records.
export type RendererRegistry<Component> = Record<string, Component>

export function createRendererRegistry<Component>(entries: RendererRegistry<Component>) {
  return {
    get(key: string): Component {
      const component = entries[key]
      if (!component) throw new Error(`No trusted renderer registered for ${key}`)
      return component
    },
    keys: () => Object.keys(entries),
  }
}
