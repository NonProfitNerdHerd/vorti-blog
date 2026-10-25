import { expect, it } from 'vitest'
import { correspondencePDF } from '../../src/crm/correspondence-pdf'
const snapshot = {
  id: 'fictional-document-123',
  subject: 'Annual giving statement',
  body: 'Thank you, José and Zoë.\nUSD 75.00 received after recorded adjustments.',
  issuedOn: '2026-10-24',
  issuer: { name: 'Fictional nonprofit', address: '123 Example Street\nExample City' },
  recipient: { name: 'José and Zoë', address: '456 Fictional Lane' },
}
it('creates actual embedded-font PDFs and paginates long statements', () => {
  const bytes = correspondencePDF({
    ...snapshot,
    body: Array.from({ length: 180 }, (_, index) => `${index + 1}. ${snapshot.body}`).join('\n'),
  })
  const pdf = new TextDecoder().decode(bytes)
  expect(pdf.startsWith('%PDF-')).toBe(true)
  expect(pdf).toContain('/FontFile2')
  expect((pdf.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(3)
  expect(pdf).not.toContain('/JavaScript')
  expect(pdf).not.toContain('/URI')
})
it('rejects unsupported glyphs explicitly rather than issuing unreadable donor text', () => {
  expect(() =>
    correspondencePDF({ ...snapshot, recipient: { name: 'Donor 😀', address: '' } }),
  ).toThrow('printable HTML')
})
