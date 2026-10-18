'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load collaboration state when the selected remote task changes. */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { query, reviewAPI, type Task } from './client'
import type { Board } from './WorkspaceBoards'

export function TaskCollaboration({
  api,
  task,
  onChange,
}: {
  api: string
  task: Task
  onChange: () => Promise<void>
}) {
  const { user } = useAuth()
  const [boards, setBoards] = useState<Board[]>([]),
    [board, setBoard] = useState(''),
    [following, setFollowing] = useState(false),
    [muted, setMuted] = useState(false)
  const [requests, setRequests] = useState<
    { id: number; state: string; destination?: number; approvers: number[] }[]
  >([])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [boardSearch, setBoardSearch] = useState('')
  const load = useCallback(async () => {
    const [b, f, r] = await Promise.all([
      reviewAPI<{ docs: Board[] }>(
        api,
        `task-boards?${query({ and: [{ archived: { not_equals: true } }, ...(boardSearch.trim() ? [{ name: { contains: boardSearch.trim().slice(0, 35) } }] : [])] }, { limit: '50' })}`,
      ),
      reviewAPI<{ docs: { following?: boolean; muted?: boolean }[] }>(
        api,
        `task-followers?${query({ task: { equals: task.id } })}`,
      ),
      reviewAPI<{ docs: typeof requests }>(
        api,
        `task-sharing-requests?${query({ and: [{ task: { equals: task.id } }, { state: { equals: 'pending' } }] })}`,
      ),
    ])
    setBoards(b.docs)
    setFollowing(f.docs[0]?.following ?? false)
    setMuted(f.docs[0]?.muted ?? false)
    setRequests(r.docs)
  }, [api, task.id, boardSearch])
  useEffect(() => {
    void load().catch((e) => setError(e.message))
  }, [load, task.updatedAt])
  const action = async (data: object) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await reviewAPI<{ pending?: boolean }>(
        api,
        `review-tasks/${task.id}/workspace`,
        'POST',
        data,
      )
      if (result.pending) setNotice('Sharing requested. Required board owners have been notified.')
      await load()
      await onChange()
      window.dispatchEvent(new Event('vorti-tasks-changed'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="task-collaboration">
      <h3>Collaboration</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="task-workspace-toolbar">
        <label>
          <input
            type="checkbox"
            checked={following}
            disabled={busy}
            onChange={(e) => void action({ action: 'follow', following: e.target.checked, muted })}
          />{' '}
          Follow comments
        </label>
        <label>
          <input
            type="checkbox"
            checked={muted}
            disabled={busy}
            onChange={(e) => void action({ action: 'follow', following, muted: e.target.checked })}
          />{' '}
          Mute comments
        </label>
      </div>
      <small>Direct mentions and assignments still reach your inbox.</small>
      {!task.parent && (
        <>
          <h4>Boards</h4>
          <p>
            Task details, comments, and subtasks are shared with members of any attached board.
            Boards you cannot access stay hidden.
          </p>
          <ul>
            {boards
              .filter((b) => task.boards?.includes(b.id))
              .map((b) => (
                <li key={b.id}>
                  {b.name} · {b.workspaceRole}
                  {b.workspaceRole === 'owner' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        let lastAction: string | undefined
                        // The server checks the full placement set, including boards hidden from this viewer.
                        if (
                          window.confirm(
                            'Remove this task from this board? Other board placements will remain. If this is its last board, choose OK next to archive it, or Cancel to make it personal.',
                          )
                        ) {
                          lastAction = window.confirm(
                            'If this is the last board: OK = archive task; Cancel = make personal to creator and assignee.',
                          )
                            ? 'archive'
                            : 'personal'
                          void action({
                            action: 'remove',
                            board: b.id,
                            lastAction,
                            expectedUpdatedAt: task.updatedAt,
                          })
                        }
                      }}
                    >
                      Remove placement
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {task.canEdit !== false && (
            <div className="task-workspace-toolbar">
              <label>
                Find a destination board
                <input value={boardSearch} onChange={(e) => setBoardSearch(e.target.value)} />
              </label>
              <label>
                Share to board
                <select value={board} onChange={(e) => setBoard(e.target.value)}>
                  <option value="">Choose a board</option>
                  {boards
                    .filter(
                      (b) =>
                        !task.boards?.includes(b.id) &&
                        ['owner', 'editor'].includes(b.workspaceRole ?? ''),
                    )
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!board || busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Share the entire task, existing discussion, and all subtasks with this board? This does not grant access to any protected document. Owners of existing boards must approve the expanded audience.',
                    )
                  )
                    void action({ action: 'share', board: Number(board), confirm: true })
                }}
              >
                Share / request approval
              </button>
            </div>
          )}
          {requests.map((request) => (
            <div key={request.id}>
              <p>
                Sharing request #{request.id} ·{' '}
                {boards.find((b) => b.id === request.destination)?.name ??
                  'Destination details restricted'}
              </p>
              {(request.approvers.includes(Number(user?.id)) || user?.role === 'administrator') && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Approve sharing this task, discussion, and subtasks with the requested board?',
                        )
                      )
                        void action({ action: 'approve', request: request.id })
                    }}
                  >
                    Approve sharing
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void action({ action: 'reject', request: request.id })}
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
