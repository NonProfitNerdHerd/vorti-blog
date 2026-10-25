import { describe, expect, it } from 'vitest'
import {
  correspondenceTemplate,
  mergeCorrespondence,
  printableCorrespondence,
  templateFields,
} from '../../src/crm/correspondence-model'

describe('CRM correspondence template boundaries', () => {
  it('validates known fields and rejects expressions, unknown fields and header injection', () => {
    expect(templateFields('{{recipient.name}} {{ recipient.name }} {{giving.summary}}')).toEqual([
      'recipient.name',
      'giving.summary',
    ])
    for (const text of ['{{recipient.email}}', '{{process.env}}', '{{recipient.name', '{{x()}}'])
      expect(() => templateFields(text)).toThrow()
    expect(() =>
      correspondenceTemplate({
        name: 'Receipt',
        kind: 'gift-receipt',
        subject: 'Thanks\nBcc: elsewhere',
        body: 'Thanks',
      }),
    ).toThrow('single-line')
  })
  it('requires available snapshot values and never recursively evaluates donor text', () => {
    expect(() => mergeCorrespondence('Hello {{recipient.name}}', {})).toThrow('required')
    expect(
      mergeCorrespondence('Hello {{recipient.name}}', { 'recipient.name': '{{issuer.name}}' }),
    ).toBe('Hello {{issuer.name}}')
    expect(
      correspondenceTemplate({
        name: ' Thank you ',
        kind: 'thank-you',
        subject: 'Thanks',
        body: 'Hello {{recipient.name}}',
      }).name,
    ).toBe('Thank you')
  })
  it('escapes every printable value and contains no active donor markup', () => {
    const html = printableCorrespondence({
      subject: '<script>alert(1)</script>',
      body: '<img src=x onerror="alert(1)">\nA & B',
      issuer: '<issuer>',
      number: '"123"',
      issuedOn: '2026-10-24',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;\nA &amp; B')
    expect(html).toContain('&lt;issuer&gt;')
    expect(html).toContain('&quot;123&quot;')
  })
})
