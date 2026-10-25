import { expect, it } from 'vitest'
import {
  attachmentDisposition,
  attachmentMetadata,
  crmAttachmentLimit,
  validateAttachmentBytes,
} from '../../src/crm/attachment-model'
const values = () => ({
  filename: 'Fictional receipt.pdf',
  size: 12,
  sha256: 'a'.repeat(64),
  category: 'finances',
})
it('requires an explicit information category and validates bounded immutable upload metadata', () => {
  expect(attachmentMetadata(values())).toMatchObject({
    category: 'finances',
    mime: 'application/pdf',
    filename: 'Fictional receipt.pdf',
  })
  for (const input of [
    { ...values(), size: 0 },
    { ...values(), size: crmAttachmentLimit + 1 },
    { ...values(), filename: 'payload.html' },
    { ...values(), filename: 'payload.pdf.exe' },
    { ...values(), sha256: 'bad' },
    { ...values(), category: 'identity' },
    { ...values(), filename: '\ud800.pdf' },
  ])
    expect(() => attachmentMetadata(input)).toThrow()
  expect(attachmentMetadata({ ...values(), filename: 'folder\\receipt\n.pdf' }).filename).toBe(
    'folder_receipt_.pdf',
  )
})
it('checks upload length and supported binary signatures without executing uploaded content', () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\n123')
  expect(() =>
    validateAttachmentBytes({ mime: 'application/pdf', size: bytes.length }, bytes),
  ).not.toThrow()
  expect(() =>
    validateAttachmentBytes({ mime: 'application/pdf', size: bytes.length + 1 }, bytes),
  ).toThrow()
  expect(() => validateAttachmentBytes({ mime: 'image/png', size: bytes.length }, bytes)).toThrow()
  expect(() => validateAttachmentBytes({ mime: 'text/html', size: bytes.length }, bytes)).toThrow()
  expect(() =>
    validateAttachmentBytes(
      { mime: 'image/png', size: 8 },
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
  ).not.toThrow()
})
it('emits a download-only disposition with safe ASCII fallback and encoded original name', () => {
  const metadata = attachmentMetadata({ ...values(), filename: 'Zoë "receipt".pdf' })
  const result = attachmentDisposition(metadata.filename)
  expect(result).toContain('attachment; filename="Zo_ _receipt_.pdf"')
  expect(result).toContain("filename*=UTF-8''Zo%C3%AB%20%22receipt%22.pdf")
  expect(result).not.toContain('\n')
  expect(attachmentDisposition("O'Connor (receipt).pdf")).toContain(
    'O%27Connor%20%28receipt%29.pdf',
  )
})
