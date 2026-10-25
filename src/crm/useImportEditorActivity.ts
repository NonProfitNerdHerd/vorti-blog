'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
const names = ['run', 'upload', 'source', 'mapping', 'rows', 'results'] as const
type Scope = (typeof names)[number]
type Flags = Record<Scope, { dirty: boolean; saving: boolean }>
const empty = (): Flags =>
  Object.fromEntries(names.map((name) => [name, { dirty: false, saving: false }])) as Flags
export function useImportEditorActivity(
  onDirty: (value: boolean) => void,
  onSaving: (value: boolean) => void,
) {
  const current = useRef(empty()),
    live = useRef(true)
  const [flags, setFlags] = useState(empty)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const publish = useCallback(
    (next: Flags) => {
      if (!live.current) return
      current.current = next
      setFlags(next)
      onDirty(names.some((name) => next[name].dirty))
      onSaving(names.some((name) => next[name].saving))
    },
    [onDirty, onSaving],
  )
  const scopes = useMemo(
    () =>
      Object.fromEntries(
        names.map((name) => [
          name,
          {
            onDirty: (value: boolean) =>
              publish({ ...current.current, [name]: { ...current.current[name], dirty: value } }),
            onSaving: (value: boolean) =>
              publish({ ...current.current, [name]: { ...current.current[name], saving: value } }),
          },
        ]),
      ) as Record<Scope, { onDirty: (value: boolean) => void; onSaving: (value: boolean) => void }>,
    [publish],
  )
  const reset = useCallback(() => publish(empty()), [publish])
  const hasActivity = useCallback(
    () => names.some((name) => current.current[name].dirty || current.current[name].saving),
    [],
  )
  return {
    scopes,
    flags,
    reset,
    hasActivity,
    dirty: names.some((name) => flags[name].dirty),
    busy: names.some((name) => flags[name].saving),
  }
}
