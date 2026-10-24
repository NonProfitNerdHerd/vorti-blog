'use client'
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
/** Retain the operation key after an uncertain response; changed intent starts a new operation. */
export function useVolunteerIO(api: string, site: string) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [denied, setDenied] = useState(false)
  const operation = useRef<{ intent: string; key: string } | null>(null)
  const query = (values: Record<string, string>) =>
    `${api}/crm/volunteers?${new URLSearchParams({ site, ...values })}`
  const post = async (body: Record<string, unknown>) => {
    if (busy) return null
    const payload = { site, ...body },
      intent = JSON.stringify(payload)
    if (operation.current?.intent !== intent)
      operation.current = { intent, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      const result = await crmRead<{ doc: { id: string } }>(`${api}/crm/volunteers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, operationKey: operation.current.key }),
      })
      operation.current = null
      setRefresh((n) => n + 1)
      return result.doc
    } catch (cause) {
      if ([401, 403].includes((cause as { status: number }).status)) setDenied(true)
      setError((cause as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, refresh, query, post, denied }
}
export function useVolunteerGuard(
  dirty: boolean,
  busy: boolean,
  onDirty?: (value: boolean) => void,
  onSaving?: (value: boolean) => void,
) {
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => {
    onSaving?.(busy)
  }, [busy, onSaving])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, busy])
  return () => !busy && (!dirty || window.confirm('Discard unsaved volunteer changes?'))
}
