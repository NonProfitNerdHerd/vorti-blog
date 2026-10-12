'use client'
import { useEffect, useState, useRef } from 'react'
import {
  RenderFields,
  useDocumentInfo,
  useField,
  useFormFields,
  useFormProcessing,
} from '@payloadcms/ui'
import type { RowFieldClientComponent } from 'payload'
import { SetupWizard } from '@design-system/payload-design-core/admin'
import { validateRuleDefinitions, type TypeField } from '@design-system/payload-design-core/content'
import './post-type.css'
import { usePostTypeAccess } from './usePostTypeAccess'

const steps = ['Key', 'Names', 'Web address', 'Behavior', 'Icon', 'Fields', 'Templates', 'Review']
const groups = [
  ['key'],
  ['singular', 'plural'],
  ['prefix'],
  ['capability'],
  ['icon'],
  ['fieldDefinitions'],
  ['templates', 'defaultTemplate'],
  ['archived', 'schemaVersion'],
]
const help = [
  'A Post Type describes a kind of content, such as Events, Staff, or Resources. Its key is the permanent internal identifier used by queries and integrations. Use lowercase letters, numbers, and hyphens: event, staff, or resource. The key becomes fixed after the first save, including Save Draft.',
  'Singular names one item, such as Event. Plural names a collection, such as Events. These labels help authors understand what they are creating; you can change them later.',
  'The URL prefix groups this type’s public pages. For Events, use events to get /events/example-event. It must be unique and cannot use a reserved system route. Like the key, it becomes fixed after the first save.',
  'Standard content works for articles, staff profiles, and resources. Events adds calendar scheduling and event listings independently of the page Template. Selecting Events supplies a required public Event Schedule field, including start, end, timezone, and recurrence.',
  'Choose a recognizable symbol for this type. Search the full bundled icon library or browse a category. Icons do not change the content or its behavior.',
  'Fields hold the information that differs for each item, such as a biography or contact email. Add fields, choose what authors enter, and set publication rules. Public fields may be used by Templates and Saved Views; private fields cannot be bound into public displays.',
  'Templates control the full-page presentation; they are not content fields. Allowed Templates are the published Page/Post Templates authors may choose. The default is used when no explicit Template is chosen. Leave both empty to use the built-in page layout, including a working Event page.',
  'Save Draft keeps configuration changes out of live content. Publish makes this type and its current definition available to authors. Existing published content is not rewritten; new field rules apply on its next publication.',
]
const reserved = [
  'admin',
  'api',
  '_next',
  'media',
  'posts',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]
export const PostTypeWizard: RowFieldClientComponent = ({
  field,
  readOnly,
  parentPath = '',
  parentSchemaPath = '',
  indexPath = '',
}) => {
  const [step, setStep] = useState(0),
    [iconVisited, setIconVisited] = useState(false)
  const { id, data } = useDocumentInfo()
  const access = usePostTypeAccess(readOnly)
  const formFields = useFormFields(([fields]) => fields)
  const errorSummary = useRef<HTMLDivElement>(null)
  const processing = useFormProcessing()
  const awaitingErrors = useRef(false)
  const focusErrors = useRef(false)
  const [retainedErrors, setRetainedErrors] = useState<
    { step: number; path: string; message: string; value?: string; revision: string }[]
  >([])
  const values = Object.fromEntries(
    Object.entries(formFields).map(([key, field]) => [key, field.value]),
  )
  const { setValue: setPrefix } = useField<string>({ path: 'prefix' })
  const { value: definitions = [], setValue: setDefinitions } = useField<TypeField[]>({
    path: 'fieldDefinitions',
  })
  const { value: capability, setValue: setCapability } = useField<string>({ path: 'capability' })
  const keyValue = values.key,
    prefixValue = values.prefix
  const [visited, setVisited] = useState<number[]>([0])
  const [retry, setRetry] = useState(0)
  const [unique, setUnique] = useState<
    Record<
      string,
      {
        value: string
        status: 'available' | 'duplicate' | 'error'
      }
    >
  >({})
  useEffect(() => {
    if (id) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      for (const name of ['key', 'prefix']) {
        const value = String((name === 'key' ? keyValue : prefixValue) || '')
        if (!/^[a-z][a-z0-9-]*$/.test(value)) continue
        void fetch(
          `/api/post-types?limit=1&depth=0&draft=true&where[${name}][equals]=${encodeURIComponent(value)}`,
          { signal: controller.signal },
        )
          .then(async (response) => {
            if (!response.ok) throw new Error()
            return response.json() as Promise<{ totalDocs: number }>
          })
          .then((result) => {
            if (!controller.signal.aborted)
              setUnique((old) => ({
                ...old,
                [name]: { value, status: result.totalDocs ? 'duplicate' : 'available' },
              }))
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setUnique((old) => ({
                ...old,
                [name]: { value, status: 'error' },
              }))
          })
      }
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [id, keyValue, prefixValue, retry])
  const issues: { step: number; message: string }[] = []
  for (const [name, number] of [
    ['key', 0],
    ['prefix', 2],
  ] as const) {
    if (!/^[a-z][a-z0-9-]*$/.test(String(values[name] || '')))
      issues.push({
        step: number,
        message: `${name}: use lowercase letters, numbers, and hyphens, starting with a letter.`,
      })
    if (!id && /^[a-z][a-z0-9-]*$/.test(String(values[name] || ''))) {
      const check = unique[name]
      const status = check?.value === values[name] ? check.status : 'pending'
      if (status !== 'available')
        issues.push({
          step: number,
          message:
            status === 'pending'
              ? `Checking ${name} availability…`
              : status === 'duplicate'
                ? `This ${name} is already in use.`
                : `Could not check ${name} availability. Retry to continue.`,
        })
    }
  }
  if (
    reserved.includes(String(values.prefix)) &&
    !(values.key === 'post' && values.prefix === 'posts')
  )
    issues.push({ step: 2, message: 'This URL prefix is reserved.' })
  if (!String(values.singular || '').trim() || !String(values.plural || '').trim())
    issues.push({ step: 1, message: 'Enter both singular and plural names.' })
  if (
    capability === 'event' &&
    !definitions.some((f) => f.kind === 'eventSchedule' && f.public && f.required)
  )
    issues.push({
      step: 5,
      message:
        'Events require a public, required Event Schedule field. Use Restore Event Schedule in Fields.',
    })
  issues.push(
    ...validateRuleDefinitions(definitions).map((issue) => ({ step: 5, message: issue.message })),
  )
  const selected = (value: unknown) =>
    String(typeof value === 'object' && value && 'id' in value ? value.id : value || '')
  if (
    values.defaultTemplate &&
    !(Array.isArray(values.templates) ? values.templates : []).some(
      (t) => selected(t) === selected(values.defaultTemplate),
    )
  )
    issues.push({ step: 6, message: 'Include the default Template in Allowed Templates.' })
  const changeCapability = (next: string) => {
    setCapability(next)
    if (next === 'event') {
      const existing = definitions.find((f) => f.kind === 'eventSchedule')
      let key = 'schedule',
        count = 2
      while (definitions.some((f) => f.id === key)) key = `schedule${count++}`
      setDefinitions(
        existing
          ? definitions.map((f) =>
              f.id === existing.id ? { ...f, required: true, public: true } : f,
            )
          : [
              ...definitions,
              {
                id: key,
                label: 'Event schedule',
                kind: 'eventSchedule',
                required: true,
                public: true,
              },
            ],
      )
    }
  }
  const unrestricted = !!id || !access.writable
  const revision = JSON.stringify([id, data?.updatedAt])
  const incomingErrors = Object.entries(formFields)
    .filter(([, f]) => f.valid === false && f.errorMessage)
    .map(([path, f]) => ({
      path,
      revision,
      step: Math.max(
        0,
        groups.findIndex((names) => names.includes(path)),
      ),
      message: String(f.errorMessage),
      value: JSON.stringify(f.value),
    }))
  const incomingErrorKey = JSON.stringify(incomingErrors)
  const serverIssues = retainedErrors.filter(
    (issue) => issue.revision === revision && JSON.stringify(values[issue.path]) === issue.value,
  )
  const serverIssueKey = JSON.stringify(serverIssues)
  useEffect(() => {
    awaitingErrors.current = false
  }, [revision])
  useEffect(() => {
    if (processing) awaitingErrors.current = true
    else if (awaitingErrors.current && incomingErrorKey !== '[]') {
      awaitingErrors.current = false
      focusErrors.current = true
      setRetainedErrors(JSON.parse(incomingErrorKey))
    }
  }, [incomingErrorKey, processing])
  useEffect(() => {
    if (focusErrors.current && serverIssueKey !== '[]') {
      focusErrors.current = false
      requestAnimationFrame(() => errorSummary.current?.focus())
    }
  }, [serverIssueKey])
  const canVisit = (next: number) =>
    unrestricted ||
    visited.includes(next) ||
    serverIssues.some((issue) => issue.step === next) ||
    (next === 5 &&
      capability === 'event' &&
      !definitions.some((f) => f.kind === 'eventSchedule' && f.public && f.required)) ||
    !issues.some((issue) => issue.step < next)
  const go = (next: number) => {
    if (!canVisit(next)) return
    setStep(next)
    setVisited((old) => (old.includes(next) ? old : [...old, next]))
    if (next === 4) setIconVisited(true)
  }
  return (
    <SetupWizard
      steps={steps}
      current={step}
      canAdvance={
        !access.writable ||
        visited.includes(step + 1) ||
        !issues.some((issue) => issue.step <= step)
      }
      canVisit={canVisit}
      issueSteps={[...new Set([...issues, ...serverIssues].map((issue) => issue.step))]}
      onChange={go}
    >
      {serverIssues.length > 0 && (
        <div
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className="pt-error-summary"
          aria-label="Post Type save errors"
        >
          <h3>These settings need attention</h3>
          {serverIssues.map((issue, index) => (
            <p key={index}>
              <button
                type="button"
                onClick={() => {
                  go(issue.step)
                  requestAnimationFrame(() => {
                    const match = definitions.find(
                      (field) =>
                        issue.message.includes(field.id) || issue.message.includes(field.label),
                    )
                    const button = Array.from(
                      document.querySelectorAll<HTMLButtonElement>('[data-field-id]'),
                    ).find((el) => el.dataset.fieldId === match?.id)
                    button?.click()
                    button?.focus()
                  })
                }}
              >
                {steps[issue.step]}
              </button>
              : {issue.message}
            </p>
          ))}
        </div>
      )}
      <p className="pt-step-help">{help[step]}</p>
      {groups.map((names, i) => (
        <div key={i} hidden={step !== i}>
          {i === 3 ? (
            <label>
              Behavior
              <select
                disabled={!access.canWrite('capability') || !access.canWrite('fieldDefinitions')}
                value={capability || 'content'}
                onChange={(e) => changeCapability(e.target.value)}
              >
                {field.fields
                  .filter((f) => f.type === 'select')
                  .flatMap((f) =>
                    f.type === 'select'
                      ? f.options.map((option) =>
                          typeof option === 'string' ? (
                            <option key={option}>{option}</option>
                          ) : (
                            <option key={option.value} value={option.value}>
                              {String(option.label)}
                            </option>
                          ),
                        )
                      : [],
                  )}
              </select>
            </label>
          ) : (
            (i !== 4 || iconVisited) && (
              <RenderFields
                forceRender
                fields={field.fields
                  .filter((f) => 'name' in f && names.includes(f.name))
                  .map((f) =>
                    f.type === 'text' && ['key', 'prefix'].includes(f.name) && id
                      ? { ...f, admin: { ...f.admin, readOnly: true } }
                      : f,
                  )}
                parentPath={parentPath}
                parentSchemaPath={parentSchemaPath}
                parentIndexPath={indexPath}
                permissions={access.fields || {}}
                readOnly={!access.writable}
              />
            )
          )}
          {i === 1 && (
            <p>
              Authors will see: Create {String(values.singular || 'Event')} · Browse{' '}
              {String(values.plural || 'Events')}
            </p>
          )}
          {i === 2 && (
            <>
              <p>
                Example address: <code>/{String(values.prefix || 'events')}/example-event</code>
              </p>
              {!id && (
                <button
                  type="button"
                  disabled={!access.canWrite('prefix')}
                  onClick={() =>
                    setPrefix(
                      String(values.plural || values.key || '')
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, ''),
                    )
                  }
                >
                  Use plural name as URL prefix
                </button>
              )}
            </>
          )}
          {i === 7 && (
            <>
              <dl>
                <dt>Type</dt>
                <dd>
                  {String(values.singular || 'Unnamed')} / {String(values.plural || 'Unnamed')}
                </dd>
                <dt>Key / URL prefix</dt>
                <dd>
                  {String(values.key || '—')} / {String(values.prefix || '—')}
                </dd>
                <dt>Behavior</dt>
                <dd>{capability}</dd>
                <dt>Content fields</dt>
                <dd>{definitions.length}</dd>
                <dt>Presentation</dt>
                <dd>
                  {values.defaultTemplate ? 'Selected default Template' : 'Built-in fallback'};{' '}
                  {(Array.isArray(values.templates) ? values.templates : []).length} allowed
                  Templates
                </dd>
              </dl>
              <p>
                Use Save Draft or Publish changes in the document header. Key and URL prefix are
                fixed after your first save.
              </p>
              {!issues.length && (
                <p>
                  Setup is ready. Server validation will also verify Template bindings and field
                  definitions when saving.
                </p>
              )}
            </>
          )}
        </div>
      ))}
      <div aria-live="polite">
        {issues
          .filter((issue) => step === 7 || issue.step === step)
          .map((issue, i) => (
            <p className="pt-error" key={i}>
              {step === 7 && (
                <>
                  <button type="button" onClick={() => go(issue.step)}>
                    {steps[issue.step]}
                  </button>
                  :{' '}
                </>
              )}
              {issue.message}
            </p>
          ))}
        {['key', 'prefix'].some(
          (name) =>
            unique[name]?.status === 'error' &&
            unique[name]?.value === values[name] &&
            (step === (name === 'key' ? 0 : 2) || step === 7),
        ) && (
          <button
            type="button"
            onClick={() => {
              setUnique({})
              setRetry((n) => n + 1)
            }}
          >
            Retry availability check
          </button>
        )}
      </div>
    </SetupWizard>
  )
}
