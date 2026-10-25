'use client'
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
type Generation = {
  ready: boolean
  job: {
    id: string
    status: string
    progress: number
    attempts: number
    fence: number
    error: string | null
    canManage: boolean
  } | null
}
type Props = { api: string; site: string; document: string; onDenied?: (message: string) => void }
export function CorrespondenceGeneration(props: Props) {
  return <GenerationStatus key={`${props.api}:${props.site}:${props.document}`} {...props} />
}
function GenerationStatus({ api, site, document, onDenied }: Props) {
  const [data, setData] = useState<Generation | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0)
  const operation = useRef<{ intent: string; key: string } | null>(null),
    denied = useRef(onDenied)
  useEffect(() => {
    denied.current = onDenied
  }, [onDenied])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const result = await crmRead<Generation>(
          `${api}/crm/correspondence?${new URLSearchParams({ site, document, view: 'generation' })}`,
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setData(result)
        setError('')
        if (!result.ready && result.job && ['pending', 'running'].includes(result.job.status))
          timer = setTimeout(() => void load(), 5000)
      } catch (cause) {
        if (controller.signal.aborted) return
        setData(null)
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status))
          denied.current?.((cause as Error).message)
      }
    }
    void load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [api, site, document, version])
  const control = async (action: 'retry-generation' | 'cancel-generation') => {
    if (!data?.job || busy) return
    const body = { site, document, job: data.job.id, expectedFence: data.job.fence, action },
      intent = JSON.stringify(body)
    if (operation.current?.intent !== intent)
      operation.current = { intent, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      await crmRead(`${api}/crm/correspondence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      operation.current = null
      setVersion((value) => value + 1)
    } catch (cause) {
      setError((cause as Error).message)
      if ([401, 403].includes((cause as { status: number }).status)) {
        setData(null)
        denied.current?.((cause as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="PDF generation">
      <h4>PDF generation</h4>
      {error && <p role="alert">{error}</p>}
      {data ? (
        <>
          <p role="status">
            {data.ready
              ? 'PDF ready for private download.'
              : data.job
                ? `Generation ${data.job.status}. Completed documents: ${data.job.progress}. Attempts: ${data.job.attempts}.`
                : 'No generation job is recorded.'}
          </p>
          {data.job?.error && <p>{data.job.error}</p>}
          {data.ready ? (
            <a
              href={`${api}/crm/correspondence?${new URLSearchParams({ site, document, format: 'pdf' })}`}
            >
              Download private PDF
            </a>
          ) : (
            data.job?.canManage && (
              <>
                {['pending', 'running'].includes(data.job.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void control('cancel-generation')}
                  >
                    Cancel PDF generation
                  </button>
                )}
                {['failed', 'cancelled'].includes(data.job.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void control('retry-generation')}
                  >
                    Retry PDF generation
                  </button>
                )}
              </>
            )
          )}
        </>
      ) : (
        <p>Loading generation status…</p>
      )}
      <button type="button" disabled={busy} onClick={() => setVersion((value) => value + 1)}>
        Refresh PDF status
      </button>
    </section>
  )
}
