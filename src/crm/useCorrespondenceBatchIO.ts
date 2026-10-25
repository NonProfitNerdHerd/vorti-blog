'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'

/** Preserve an uncertain mutation's key until an unchanged retry is acknowledged. */
export function useCorrespondenceBatchIO(
  api: string,
  site: string,
  onDenied?: (message: string) => void,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const active = useRef(true),
    inFlight = useRef(false),
    denied = useRef(onDenied),
    operation = useRef<{ intent: string; key: string } | null>(null)
  useEffect(() => {
    denied.current = onDenied
  }, [onDenied])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const fail = useCallback((cause: Error & { status?: number }) => {
    if (!active.current) return
    setError(cause.message)
    if ([401, 403].includes(cause.status || 0)) denied.current?.(cause.message)
  }, [])
  const post = useCallback(
    async (body: Record<string, unknown>) => {
      if (inFlight.current) return null
      const payload = { site, ...body },
        intent = JSON.stringify(payload)
      if (operation.current?.intent !== intent)
        operation.current = { intent, key: crypto.randomUUID() }
      inFlight.current = true
      setBusy(true)
      setError('')
      try {
        const result = await crmRead<{ doc: Record<string, unknown> }>(
          `${api}/crm/correspondence-batches`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, operationKey: operation.current.key }),
          },
        )
        operation.current = null
        return result.doc
      } catch (cause) {
        fail(cause as Error)
        return null
      } finally {
        inFlight.current = false
        if (active.current) setBusy(false)
      }
    },
    [api, site, fail],
  )
  return { busy, error, setError, post, fail }
}
