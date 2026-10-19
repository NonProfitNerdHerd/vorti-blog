'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load the viewer's board preference. */
import { useCallback, useEffect, useState } from 'react'
import { List, Check } from './WorkspaceIcon'
import { createPortal } from 'react-dom'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { reviewAPI, reviewAll } from './client'
import { boardColors, type BoardColor } from './board-colors'

export function BoardIcon({ api, board, name }: { api: string; board: number; name: string }) {
  const [color, setColor] = useState<BoardColor>('blue'),
    [open, setOpen] = useState(false)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const current = (
        await reviewAll<{ iconColor?: BoardColor }>(api, 'task-board-preferences', {
          board: { equals: board },
        })
      )[0]
      setColor(current?.iconColor && current.iconColor in boardColors ? current.iconColor : 'blue')
    } catch {
      /* A revoked board is removed by the containing authorized list. */
    }
  }, [api, board])
  useEffect(() => {
    void load()
    window.addEventListener('vorti-board-colors-changed', load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener('vorti-board-colors-changed', load)
      window.removeEventListener('focus', load)
    }
  }, [load])
  const save = async (next: BoardColor) => {
    setBusy(true)
    setError('')
    try {
      const find = async () =>
        (
          await reviewAll<{ id: number }>(api, 'task-board-preferences', {
            board: { equals: board },
          })
        )[0]
      const existing = await find()
      const write = (id?: number) =>
        reviewAPI(api, `task-board-preferences${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', {
          board,
          iconColor: next,
        })
      try {
        await write(existing?.id)
      } catch (error) {
        if (existing) throw error
        const winner = await find()
        if (!winner) throw error
        await write(winner.id)
      }
      setColor(next)
      setOpen(false)
      window.dispatchEvent(new Event('vorti-board-colors-changed'))
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className="workspace-board-icon"
        style={{ backgroundColor: boardColors[color] }}
        aria-label={`Change personal color for ${name}`}
        aria-haspopup="dialog"
        title="Your board color"
        onClick={() => setOpen(true)}
      >
        <List size={16} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <EditorDialog
            open
            title={`Your color · ${name}`}
            onClose={() => {
              if (!busy) setOpen(false)
            }}
          >
            <p>This color is only for you.</p>
            {error && <p role="alert">{error}</p>}
            <div className="workspace-color-options">
              {Object.entries(boardColors).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  disabled={busy}
                  aria-label={key}
                  aria-pressed={color === key}
                  style={{ backgroundColor: value }}
                  onClick={() => void save(key as BoardColor)}
                >
                  {color === key && <Check size={18} aria-hidden="true" />}
                  <span>{key}</span>
                </button>
              ))}
            </div>
          </EditorDialog>,
          document.body,
        )}
    </>
  )
}
