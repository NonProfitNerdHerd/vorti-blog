import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SubmissionSummary } from './SubmissionSummary'
import { mayTransition, workflowIssues } from './workflow'

describe('entry review presentation', () => {
  it('renders structured historical answers and option labels without executable markup', () => {
    const html = renderToStaticMarkup(<SubmissionSummary fields={[
      { id: 'name', kind: 'name', label: 'Name' },
      { id: 'choice', kind: 'select', label: 'Choice', options: [{ id: 'a', value: 'a', label: 'Original label' }] },
      { id: 'people', kind: 'repeater', label: 'People', children: [{ id: 'email', kind: 'email', label: 'Contact email' }] },
      { id: 'salary', kind: 'number', label: 'Salary', sensitive: true },
    ]} answers={{ name: { first: '<script>bad()</script>', last: 'Person' }, choice: 'a', people: [{ email: 'one@example.test' }] }} />)
    expect(html).toContain('Original label')
    expect(html).toContain('Contact email')
    expect(html).toContain('one@example.test')
    expect(html).toContain('Sensitive answer')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
  it('rejects malformed workflows and enforces explicit roles', () => {
    expect(workflowIssues({ transitions: [{ from: 'received', to: 'approved', roles: [] }] })).not.toEqual([])
    expect(workflowIssues({ transitions: [{ from: 'received', to: 'received', roles: ['editor'] }] })).not.toEqual([])
    expect(mayTransition('rejected', 'in-review', 'editor')).toBe(false)
    expect(mayTransition('rejected', 'in-review', 'administrator')).toBe(true)
    expect(mayTransition('received', 'completed', 'administrator')).toBe(false)
  })
})
