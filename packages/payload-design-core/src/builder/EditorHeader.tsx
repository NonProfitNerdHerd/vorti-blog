'use client'

import { useDocumentInfo, useField, useForm } from '@payloadcms/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Viewport } from '../content/model'
import { IconButton } from './InspectorControls'
import './editor-header.css'

type Slot = 'title' | 'history' | 'navigation' | 'preview' | 'actions'
const drawer = (element: Element) => element.closest('.doc-drawer, [role="dialog"]')

function useDocumentKey() {
  const { collectionSlug, globalSlug, id } = useDocumentInfo()
  return `${collectionSlug ?? globalSlug}:${id ?? 'new'}`
}

/** Only application-owned slots are portal targets; Payload's DOM is never moved. */
function HeaderSlot({ slot }: { slot: Slot }) {
  return (
    <span
      className={`editor-header__slot editor-header__slot--${slot}`}
      data-editor-slot={slot}
      data-editor-document={useDocumentKey()}
    />
  )
}
export function EditorTitleSlot() {
  const { id } = useDocumentInfo()
  const ref = useRef<HTMLSpanElement>(null)
  const [inDrawer, setInDrawer] = useState(false)
  useEffect(() => {
    setInDrawer(Boolean(ref.current && drawer(ref.current)))
  }, [])
  return (
    <span ref={ref} className="editor-header__title-host">
      <HeaderSlot slot="title" />
      {(inDrawer || !id) && <HeaderSlot slot="history" />}
    </span>
  )
}
export function EditorHistorySlot() {
  return (
    <li className="editor-header__history-host">
      <HeaderSlot slot="history" />
    </li>
  )
}
export function EditorPreviewSlot() {
  return (
    <>
      <HeaderSlot slot="navigation" />
      <HeaderSlot slot="preview" />
      <HeaderSlot slot="actions" />
    </>
  )
}

export function EditorHeaderPortal({
  slot,
  children,
  waitForTarget = false,
}: {
  slot: Slot
  children: ReactNode
  waitForTarget?: boolean
}) {
  const key = useDocumentKey()
  const marker = useRef<HTMLSpanElement>(null)
  const [target, setTarget] = useState<Element | null>(null)
  useEffect(() => {
    const locate = () => {
      const owner = marker.current
      if (!owner) return
      const next =
        Array.from(document.querySelectorAll('[data-editor-slot]')).find(
          (element) =>
            element.getAttribute('data-editor-slot') === slot &&
            element.getAttribute('data-editor-document') === key &&
            drawer(element) === drawer(owner),
        ) ?? null
      setTarget((previous) => (previous === next ? previous : next))
    }
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [key, slot])
  return (
    <>
      <span ref={marker} hidden />
      {target ? (
        createPortal(children, target)
      ) : waitForTarget ? null : (
        <div className={`editor-header__fallback editor-header__fallback--${slot}`}>{children}</div>
      )}
    </>
  )
}

export function EditorHistory({
  undo,
  redo,
  canUndo,
  canRedo,
}: {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}) {
  return (
    <EditorHeaderPortal slot="history">
      <div className="editor-header__buttons" role="group" aria-label="Edit history">
        <IconButton label="Undo" icon="undo" onClick={undo} disabled={!canUndo} />
        <IconButton label="Redo" icon="redo" onClick={redo} disabled={!canRedo} />
      </div>
    </EditorHeaderPortal>
  )
}

export function EditorDevices({
  value,
  onChange,
}: {
  value: Viewport
  onChange: (value: Viewport) => void
}) {
  return (
    <div className="editor-header__buttons" role="toolbar" aria-label="Responsive preview">
      {(['desktop', 'tablet', 'mobile'] as const).map((device) => (
        <IconButton
          key={device}
          label={device === 'mobile' ? 'Phone' : device[0].toUpperCase() + device.slice(1)}
          icon={device}
          pressed={value === device}
          onClick={() => onChange(device)}
        />
      ))}
    </div>
  )
}

/** Template names use the same existing form path as their hidden schema field. */
export function EditorName() {
  const { value, setValue, showError, errorMessage, disabled: fieldDisabled } = useField<string>({ path: 'name' })
  const { disabled } = useForm()
  const { id, docPermissions, hasSavePermission } = useDocumentInfo()
  const fields = docPermissions?.fields
  const permission = fields && typeof fields === 'object' ? fields.name : undefined
  const readOnly =
    fieldDisabled ||
    disabled ||
    hasSavePermission === false ||
    (fields !== undefined &&
      fields !== true &&
      permission !== true &&
      !permission?.[id ? 'update' : 'create'])
  return (
    <EditorHeaderPortal slot="title">
      <div className="editor-header__title">
        <input
          id="field-name"
          name="name"
          aria-label="Name"
          placeholder="Add title"
          value={value ?? ''}
          readOnly={readOnly}
          aria-invalid={showError || undefined}
          aria-required="true"
          onChange={(event) => setValue(event.target.value)}
        />
        {showError && <p role="alert">{errorMessage}</p>}
      </div>
    </EditorHeaderPortal>
  )
}
