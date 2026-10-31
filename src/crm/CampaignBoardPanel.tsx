'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { crmRead } from './HouseholdWorkspace'
import type { Task } from '../review/client'

type Board = { id: number; name: string }
type BoardResult = { linked: Board | null; linkedRestricted?: boolean; boards: Board[] }

export function CampaignBoardPanel({ api, admin, site, campaign, revision, canEdit }: {
  api: string; admin: string; site: string; campaign: string; revision: number; canEdit: boolean
}) {
  const [result, setResult] = useState<BoardResult | null>(null)
  const [choice, setChoice] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [review, setReview] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const response = await crmRead<BoardResult>(`${api}/crm/campaign-board?${new URLSearchParams({ site, campaign })}`)
    setResult(response)
  }, [api, site, campaign])
  useEffect(() => { void load().catch(cause => setError((cause as Error).message)) }, [load])
  useEffect(() => {
    if (!review || !result?.linked) return
    void crmRead<{ docs: Task[]; totalPages: number }>(`${api}/crm/tasks?${new URLSearchParams({ site, type: 'campaign', id: campaign, state: 'all', page: String(page) })}`)
      .then(data => { setTasks(data.docs); setTotalPages(data.totalPages) })
      .catch(cause => setError((cause as Error).message))
  }, [api, site, campaign, page, review, result?.linked])
  const link = async (action: 'create' | 'link') => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await crmRead<{ board: Board }>(`${api}/crm/campaign-board`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vorticause-site': site },
        body: JSON.stringify({ action, site, campaign, expectedRevision: revision, board: Number(choice) }) })
      await load()
      setNotice(`${response.board.name} is linked. New campaign tasks will join this VortiTasks board.`)
      setReview(true)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  const unlink = async () => {
    if (!result?.linked || !window.confirm(`Unlink ${result.linked.name} from this campaign? Existing tasks will stay on the board.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await crmRead(`${api}/crm/campaign-board`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vorticause-site': site },
        body: JSON.stringify({ action: 'unlink', site, campaign, expectedRevision: revision }) })
      await load(); setReview(false); setNotice('Board unlinked. Existing tasks remain on that board.')
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  const addSelected = async () => {
    if (!result?.linked) return
    setBusy(true); setError(''); setNotice('')
    let added = 0, pending = 0
    try {
      for (const id of selected) {
        const response = await crmRead<{ pending?: boolean }>(`${api}/review-tasks/${id}/workspace`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-vorticause-site': site },
          body: JSON.stringify({ action: 'share', board: result.linked.id, confirm: true }) })
        if (response.pending) pending++
        else added++
      }
      setNotice(`${added} task${added === 1 ? '' : 's'} added to the board${pending ? `; ${pending} awaiting board approval` : ''}.`)
      setSelected([])
      setReview(false)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="vc-fund-card vc-campaign-board" aria-label="Campaign VortiTasks board">
    <div className="vc-fund-heading"><div><h2>VortiTasks board</h2><p>Campaign tasks are shared with the linked board and remain connected to this campaign.</p></div>
      {result?.linked && <Link href={`${admin}/collections/review-tasks?${new URLSearchParams({ workspace: 'boards', board: String(result.linked.id), site })}`}>Open {result.linked.name} in VortiTasks</Link>}</div>
    {result?.linked ? <p>Linked board: <strong>{result.linked.name}</strong> {canEdit && <button type="button" disabled={busy} onClick={() => void unlink()}>Unlink board</button>}</p> : result?.linkedRestricted ? <p>A VortiTasks board is linked, but you do not have board access. Ask a board editor for access to add campaign tasks.</p> : <p>No board linked. Campaign tasks are still available in VortiTasks.</p>}
    {canEdit && !result?.linked && !result?.linkedRestricted && !!result?.boards.length && <div className="vc-fund-actions"><label>Link a board
      <select value={choice} onChange={event => setChoice(event.target.value)}><option value="">Choose an editable board</option>
        {result.boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
      </select></label><button type="button" disabled={busy || !choice} onClick={() => void link('link')}>Link board</button></div>}
    {canEdit && !result?.linked && !result?.linkedRestricted && <button type="button" disabled={busy} onClick={() => void link('create')}>Create campaign board</button>}
    {canEdit && result?.linked && <button type="button" disabled={busy} onClick={() => { setReview(value => !value); setPage(1) }}>Review existing tasks</button>}
    {review && result?.linked && <div className="vc-campaign-board-review">
      <p>Adding a task shares its details, subtasks, and discussion with the board’s members. Select eligible tasks to add.</p>
      {tasks.filter(task => !task.boards?.includes(result.linked!.id)).map(task => <label key={task.id}>
        <input type="checkbox" checked={selected.includes(task.id)} disabled={busy || !task.canEdit}
          onChange={event => setSelected(ids => event.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} /> {task.title}
      </label>)}
      {!tasks.length && <p>No campaign tasks to review.</p>}
      <div className="vc-fund-actions"><button type="button" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>Page {page} of {totalPages}</span><button type="button" disabled={busy || page >= totalPages} onClick={() => setPage(value => value + 1)}>Next</button>
        <button type="button" className="vc-crm-primary" disabled={busy || !selected.length} onClick={() => void addSelected()}>Add selected tasks to board</button></div>
    </div>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>
}
