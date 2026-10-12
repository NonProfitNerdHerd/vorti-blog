import { describe, it, expect } from 'vitest'
import { evaluateFieldRules, fieldDate, validateRuleDefinitions } from './field-rules'
import type { FieldRule, TypeField } from './model'
const field = (kind: TypeField['kind'], rules: FieldRule[]): TypeField => ({
  id: 'value',
  label: 'Value',
  kind,
  rules,
})
describe('Post Type publication rules', () => {
  it.each<[TypeField['kind'], FieldRule, unknown, unknown]>([
    ['text', { kind: 'minLength', value: 3 }, 'abc', 'ab'],
    ['text', { kind: 'maxLength', value: 2 }, 'ab', 'abc'],
    ['text', { kind: 'email' }, 'a@example.org', 'not email'],
    ['textarea', { kind: 'containsEmail' }, 'Contact a@example.org.', 'no address'],
    ['text', { kind: 'contains', value: 'hello' }, 'hello world', 'goodbye'],
    ['text', { kind: 'excludes', value: 'bad' }, 'good', 'bad thing'],
    ['number', { kind: 'min', value: 2 }, 2, 1],
    ['number', { kind: 'max', value: 2 }, 2, 3],
    ['number', { kind: 'integer' }, 2, 2.5],
    ['boolean', { kind: 'checked' }, true, false],
    [
      'url',
      { kind: 'protocols', value: 'https,relative' },
      'https://example.org',
      'http://example.org',
    ],
    [
      'url',
      { kind: 'domains', value: 'example.org' },
      'https://example.org/a',
      'https://example.org.evil.test',
    ],
    [
      'date',
      { kind: 'earliest', value: '2026-10-12T12:00' },
      '2026-10-12T12:00',
      '2026-10-12T11:00',
    ],
    ['date', { kind: 'latest', value: '2026-10-12T12:00' }, '2026-10-12T12:00', '2026-10-12T13:00'],
  ])('%s: %j distinguishes valid and invalid values', (kind, rule, valid, invalid) => {
    expect(evaluateFieldRules([field(kind, [rule])], { value: valid })).toEqual([])
    expect(evaluateFieldRules([field(kind, [rule])], { value: invalid })).toHaveLength(1)
  })
  it('compares sibling dates, including missing targets, equality, offsets and DST overlaps', () => {
    const fields: TypeField[] = [
      { id: 'start', label: 'Start', kind: 'date' },
      {
        id: 'end',
        label: 'End',
        kind: 'date',
        rules: [{ kind: 'compare', field: 'start', operator: 'after', allowEqual: true }],
      },
    ]
    expect(
      evaluateFieldRules(fields, {
        start: '2026-11-01T01:30-05:00',
        end: '2026-11-01T01:15-06:00',
      }),
    ).toEqual([])
    expect(
      evaluateFieldRules(fields, { start: '2026-10-12T12:00', end: '2026-10-12T12:00' }),
    ).toEqual([])
    fields[1].rules![0].allowEqual = false
    expect(
      evaluateFieldRules(fields, { start: '2026-10-12T12:00', end: '2026-10-12T12:00' }),
    ).toHaveLength(1)
    expect(evaluateFieldRules(fields, { end: '2026-10-12T12:00' })).toHaveLength(1)
    expect(fieldDate('2026-02-30')).toBeNaN()
    expect(fieldDate('2026-10-12T12:00')).toBe(Date.parse('2026-10-12T12:00Z'))
  })
  it('checks conditional required with typed values and custom messages', () => {
    const fields = [
      { id: 'flag', label: 'Flag', kind: 'boolean' } as TypeField,
      field('text', [
        {
          kind: 'requiredWhen',
          field: 'flag',
          operator: 'equals',
          value: false,
          message: 'Please explain.',
        },
      ]),
    ]
    expect(evaluateFieldRules(fields, { flag: false })).toEqual([
      { field: 'value', message: 'Please explain.' },
    ])
    expect(evaluateFieldRules(fields, { flag: true })).toEqual([])
    fields[1].rules![0].operator = 'set'
    expect(evaluateFieldRules(fields, { flag: false })).toHaveLength(1)
    fields[1].rules![0].operator = 'empty'
    expect(evaluateFieldRules(fields, {})).toHaveLength(1)
  })
  it('uses trusted media metadata and fails closed when unavailable', () => {
    const fields = [
      field('media', [
        { kind: 'mimeTypes', value: 'image/*' },
        { kind: 'maxBytes', value: 100 },
      ]),
    ]
    expect(
      evaluateFieldRules(fields, { value: 1 }, { value: { mimeType: 'image/png', filesize: 100 } }),
    ).toEqual([])
    expect(
      evaluateFieldRules(
        fields,
        { value: 1 },
        { value: { mimeType: 'application/pdf', filesize: 101 } },
      ),
    ).toHaveLength(2)
    expect(evaluateFieldRules(fields, { value: 1 })).toHaveLength(2)
  })
  it('rejects forged definitions, incompatible references, bounds and defaults', () => {
    expect(validateRuleDefinitions([field('text', [{ kind: 'integer' }])])).not.toEqual([])
    expect(
      validateRuleDefinitions([
        field('number', [{ kind: 'compare', field: 'missing', operator: 'after' }]),
      ]),
    ).not.toEqual([])
    expect(
      validateRuleDefinitions([
        field('number', [
          { kind: 'min', value: 10 },
          { kind: 'max', value: 5 },
        ]),
      ]),
    ).not.toEqual([])
    expect(
      validateRuleDefinitions([{ ...field('text', [{ kind: 'email' }]), defaultValue: 'invalid' }]),
    ).not.toEqual([])
    expect(
      validateRuleDefinitions([field('url', [{ kind: 'protocols', value: 'javascript' }])]),
    ).not.toEqual([])
    expect(
      validateRuleDefinitions([
        field('text', [{ kind: 'contains', value: 'hi', expression: 'eval' } as FieldRule]),
      ]),
    ).not.toEqual([])
    expect(validateRuleDefinitions([field('text', [])])).toEqual([])
  })
})
