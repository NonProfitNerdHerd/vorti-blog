// Use the browser ESM build: this renderer never reads files, URLs, HTML or a DOM.
import { jsPDF } from 'jspdf/dist/jspdf.es.min.js'
import { geistFontBase64 } from './fonts/geist'
export interface PDFDocumentSnapshot {
  id: string
  subject: string
  body: string
  issuedOn: string
  issuer: { name: string; address: string }
  recipient: { name: string; address: string }
}
export class UnsupportedDocumentTextError extends Error {
  constructor() {
    super('Use printable HTML for characters not supported by the document font.')
  }
}
export function correspondencePDF(snapshot: PDFDocumentSnapshot): Uint8Array {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', putOnlyUsedFonts: true, compress: true })
  pdf.addFileToVFS('Geist-Regular.ttf', geistFontBase64)
  pdf.addFont('Geist-Regular.ttf', 'Geist', 'normal')
  pdf.setFont('Geist', 'normal')
  const glyphs = pdf.getFont().metadata as unknown as { characterToGlyph(code: number): number }
  const plain = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  const allText = [
    snapshot.subject,
    snapshot.body,
    snapshot.id,
    snapshot.issuedOn,
    snapshot.issuer.name,
    snapshot.issuer.address,
    snapshot.recipient.name,
    snapshot.recipient.address,
  ].map(plain)
  for (const text of allText)
    for (const character of text) {
      if (character !== '\n' && !glyphs.characterToGlyph(character.codePointAt(0)!))
        throw new UnsupportedDocumentTextError()
    }
  const width = pdf.internal.pageSize.getWidth(),
    height = pdf.internal.pageSize.getHeight(),
    margin = 48,
    bottom = height - 72
  let y = margin
  const page = () => {
    pdf.addPage()
    y = margin
  }
  const paragraph = (text: string, size = 11, gap = 10) => {
    pdf.setFontSize(size)
    const lineHeight = size * 1.45
    for (const original of plain(text).split('\n')) {
      const lines = pdf.splitTextToSize(original || ' ', width - margin * 2) as string[]
      for (const line of lines) {
        if (y + lineHeight > bottom) page()
        pdf.text(line, margin, y + size)
        y += lineHeight
      }
    }
    y += gap
  }
  pdf.setTextColor(25, 35, 46)
  paragraph(snapshot.issuer.name, 14, 4)
  if (snapshot.issuer.address) paragraph(snapshot.issuer.address, 9, 12)
  paragraph(snapshot.subject, 18, 12)
  paragraph(
    [snapshot.recipient.name, snapshot.recipient.address].filter(Boolean).join('\n'),
    11,
    14,
  )
  paragraph(snapshot.body)
  const pages = pdf.getNumberOfPages()
  for (let index = 1; index <= pages; index++) {
    pdf.setPage(index)
    pdf.setDrawColor(190, 195, 200)
    pdf.line(margin, height - 51, width - margin, height - 51)
    pdf.setFontSize(8)
    pdf.setTextColor(70, 78, 88)
    pdf.text(`${snapshot.issuedOn} | ${snapshot.id}`, margin, height - 34)
    pdf.text(`${index} / ${pages}`, width - margin, height - 34, { align: 'right' })
  }
  pdf.setProperties({
    title: snapshot.subject,
    author: snapshot.issuer.name,
    creator: 'VortiCause CRM',
  })
  return new Uint8Array(pdf.output('arraybuffer'))
}
