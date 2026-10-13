'use client'
import { defaultWorkflow, entryStatuses, type EntryStatus, type EntryWorkflow } from './workflow'
export function WorkflowEditor({ value, onChange }: { value?: EntryWorkflow; onChange: (value: EntryWorkflow | undefined) => void }) {
  const workflow = value || defaultWorkflow
  return <fieldset><legend>Entry review workflow</legend><p>Choose who can move an entry between statuses. Reviewers also need entry access for this site. Rejecting an entry cancels its reservations; reopening does not reserve capacity again.</p>
    <label className="forms-builder-check"><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? structuredClone(defaultWorkflow) : undefined)} />Customize allowed transitions</label>
    {value ? <>{workflow.transitions.map((rule, index) => <fieldset key={index}><legend>Transition {index + 1}</legend>
      <label>From<select value={rule.from} onChange={event => onChange({ transitions: workflow.transitions.map((item, i) => i === index ? { ...item, from: event.target.value as EntryStatus } : item) })}>{entryStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
      <label>To<select value={rule.to} onChange={event => onChange({ transitions: workflow.transitions.map((item, i) => i === index ? { ...item, to: event.target.value as EntryStatus } : item) })}>{entryStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
      {(['administrator', 'designer', 'editor'] as const).map(role => <label className="forms-builder-check" key={role}><input type="checkbox" checked={rule.roles.includes(role)} onChange={event => onChange({ transitions: workflow.transitions.map((item, i) => i === index ? { ...item, roles: event.target.checked ? [...item.roles, role] : item.roles.filter(value => value !== role) } : item) })} />{role}</label>)}
      <button type="button" onClick={() => onChange({ transitions: workflow.transitions.filter((_, i) => i !== index) })}>Remove transition {index + 1}</button>
    </fieldset>)}<button type="button" onClick={() => onChange({ transitions: [...workflow.transitions, { from: 'received', to: 'completed', roles: ['administrator'] }] })}>Add transition</button></> : <p>The standard workflow supports received → review → approved/rejected → completed. Only administrators reopen rejected or completed entries.</p>}
  </fieldset>
}
