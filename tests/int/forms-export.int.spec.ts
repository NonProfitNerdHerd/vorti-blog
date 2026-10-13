// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { csvDocument, xlsxDocument, exportRow, safeSpreadsheetText } from '@/forms/export-format'
import { receiptDocument } from '@design-system/payload-design-core/forms'

describe('Forms export formats', () => {
  it('escapes receipt content and renders bounded signature paths without executable markup', () => {
    const html = receiptDocument({ title: '<script>alert(1)</script>', entryID: '1', revision: 'old', submittedAt: '2026-01-01',
      fields: [{ id: 'signature', kind: 'signature', label: 'Signature' }, { id: 'text', kind: 'text', label: 'Text' }],
      answers: { signature: { mode: 'drawn', strokes: [[[-1, 2], [0.5, 0.5]]] }, text: '<img src=x onerror=alert(1)>' } })
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('polyline')?.getAttribute('points')).toBe('0,160 250,80')
    expect(document.querySelector('h1')?.textContent).toBe('<script>alert(1)</script>')
  })
  it('writes a real XLSX package with typed cells and escaped literal text, never formulas', () => {
    const files = unzipSync(xlsxDocument([['entryID', 'field:text', 'field:checked'], [12, '=HYPERLINK("https://invalid.example")', true], [13, '<script> & "quotes"\nline', false]]))
    expect(Object.keys(files)).toContain('[Content_Types].xml')
    const parser = new DOMParser()
    for (const file of Object.values(files)) expect(parser.parseFromString(strFromU8(file), 'application/xml').querySelector('parsererror')).toBeNull()
    const sheet = parser.parseFromString(strFromU8(files['xl/worksheets/sheet1.xml']), 'application/xml')
    expect(sheet.querySelector('f')).toBeNull()
    expect(sheet.querySelector('c[r="A2"] v')?.textContent).toBe('12')
    expect(sheet.querySelector('c[r="B2"]')?.getAttribute('t')).toBe('inlineStr')
    expect(sheet.querySelector('c[r="B3"] t')?.textContent).toBe('<script> & "quotes"\nline')
    expect(sheet.querySelector('c[r="C2"]')?.getAttribute('t')).toBe('b')
  })
  it('neutralizes CSV formula injection and preserves quotes, line breaks and numeric types', () => {
    for (const value of ['=1+1', ' +CMD', '-1+2', '@SUM(A1)', '\t123', '\r=CMD']) expect(safeSpreadsheetText(value).startsWith("'")).toBe(true)
    expect(strFromU8(csvDocument([['a', 'b'], ['=2+2', 'a,"b"\nnext'], [-42, true]]))).toContain('"\'=2+2","a,""b""\nnext"')
    expect(strFromU8(csvDocument([[-42]]))).toContain('"-42"')
  })
  it('uses historical labels and preserves nested values while enforcing inherited sensitivity', () => {
    const entry = { id: 1, created_at: '2026-01-01', revision: 'old', workflow_status: 'received',
      schema_snapshot: JSON.stringify({ title: 'Original title', fields: [
        { id: 'choice', kind: 'select', label: 'Original choice', options: [{ id: 'a', value: 'a', label: 'Original option' }] },
        { id: 'group', kind: 'section', label: 'Private group', sensitive: true, children: [{ id: 'salary', kind: 'number', label: 'Salary' }] },
        { id: 'people', kind: 'repeater', label: 'People', children: [{ id: 'name', kind: 'name', label: 'Name' }, { id: 'secret', kind: 'text', label: 'Secret', sensitive: true }] },
      ] }), answers: JSON.stringify({ choice: 'a', salary: 90000, people: [{ name: { first: 'A', last: 'B' }, secret: 'private' }] }) }
    const row = exportRow(entry, ['revision', 'fieldLabels', 'field:choice', 'field:salary', 'field:people'], false)
    expect(row[0]).toBe('old'); expect(row[1]).toContain('Original choice'); expect(row[1]).not.toContain('Salary')
    expect(row[2]).toBe('Original option'); expect(row[3]).toBe('')
    expect(JSON.parse(String(row[4]))).toEqual([{ name: { first: 'A', last: 'B' } }])
    expect(exportRow(entry, ['field:salary'], true)).toEqual([90000])
  })
})
