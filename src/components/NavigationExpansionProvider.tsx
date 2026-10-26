'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { enterNavigation, type ExpansionState } from './navigation-state'

function createExpansionStore() {
  let value: ExpansionState | undefined
  const listeners = new Set<() => void>()
  return {
    snapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: (next: ExpansionState) => {
      if (value === next) return
      value = next
      listeners.forEach((listener) => listener())
    },
  }
}
const Context = createContext<ReturnType<typeof createExpansionStore> | null>(null)

/** Root-layout lifetime: survives remounted page navigation, never reloads or users. */
export function NavigationExpansionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createExpansionStore)
  return <Context.Provider value={store}>{children}</Context.Provider>
}

export function useNavigationExpansion(user: string, route: string, active?: string) {
  const store = useContext(Context)
  if (!store) throw Error('Admin navigation requires its page-local expansion provider.')
  const previous = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const expansion = enterNavigation(previous, user, route, active)
  // Keep the root's external store synchronized after rendering this route. The
  // derived expansion renders immediately; no persisted preference is involved.
  useEffect(() => store.publish(expansion), [store, expansion])
  return {
    open: expansion.open,
    toggle: (label: string) =>
      store.publish({ ...expansion, open: { ...expansion.open, [label]: !expansion.open[label] } }),
  }
}
