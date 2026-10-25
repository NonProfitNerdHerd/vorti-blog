import type { InformationCategory } from '../organizations/policy'

export const crmAttachmentLimit = 25 * 1024 * 1024
export const crmAttachmentCategories = [
  'communications',
  'finances',
  'memberships',
  'volunteer-experience',
  'volunteer-hours',
  'restricted-activity',
] as const satisfies readonly InformationCategory[]
export type CRMAttachmentCategory = (typeof crmAttachmentCategories)[number]
export const crmAttachmentMimes: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function attachmentMetadata(input: Record<string, unknown>) {
  if (typeof input.filename !== 'string' || input.filename.length > 2000)
    throw new Error('Enter a supported attachment filename.')
  const filename = Array.from(
    input.filename
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
      .trim(),
  )
    .slice(0, 180)
    .join('')
  try {
    encodeURIComponent(filename)
  } catch {
    throw new Error('Enter a valid attachment filename.')
  }
  const extension = filename.split('.').pop()!.toLowerCase()
  if (
    !filename ||
    !Object.hasOwn(crmAttachmentMimes, extension) ||
    !Number.isSafeInteger(input.size) ||
    Number(input.size) < 1 ||
    Number(input.size) > crmAttachmentLimit
  )
    throw new Error('Choose a supported attachment up to 25 MiB.')
  if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256))
    throw new Error('Enter a valid attachment checksum.')
  if (
    typeof input.category !== 'string' ||
    !(crmAttachmentCategories as readonly string[]).includes(input.category)
  )
    throw new Error('Choose the attachment information category.')
  return {
    filename,
    mime: crmAttachmentMimes[extension],
    size: Number(input.size),
    sha256: input.sha256,
    category: input.category as CRMAttachmentCategory,
  }
}

export function validateAttachmentBytes(file: { mime: string; size: number }, bytes: Uint8Array) {
  if (
    bytes.byteLength !== file.size ||
    bytes.byteLength < 1 ||
    bytes.byteLength > crmAttachmentLimit
  )
    throw new Error('Enter file data matching the staged attachment size.')
  const header = new TextDecoder().decode(bytes.subarray(0, 12))
  const matches =
    file.mime === 'text/plain' ||
    file.mime === 'text/csv' ||
    (file.mime === 'application/pdf' && header.startsWith('%PDF-')) ||
    (file.mime === 'image/png' &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) ||
    (file.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (file.mime === 'image/gif' && /^(GIF87a|GIF89a)/.test(header)) ||
    (file.mime === 'image/webp' && header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') ||
    ([crmAttachmentMimes.zip, crmAttachmentMimes.docx, crmAttachmentMimes.xlsx].includes(
      file.mime,
    ) &&
      bytes[0] === 80 &&
      bytes[1] === 75 &&
      ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6)))
  if (!matches) throw new Error('Choose file content matching the attachment extension.')
}

/** Attachment downloads always use octet-stream, including images and Office files. */
export function attachmentDisposition(filename: string) {
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
  )
  return `attachment; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encoded}`
}
