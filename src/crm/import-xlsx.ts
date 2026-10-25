import { Unzip, UnzipInflate, zipSync } from 'fflate'
import type { WorkBook, WorkSheet, CellObject } from 'xlsx'
import { importCellLimit, importColumnLimit, type ImportTableRow } from './import-csv'

export const xlsxCompressedLimit = 8 * 1024 * 1024
const expandedLimit = 24 * 1024 * 1024,
  entryLimit = 512

/** Bound actual decompression before passing a normalized, stored ZIP to SheetJS.
 * Untrusted ZIP size declarations do not determine allocations. No macros,
 * embedded packages, external links or remote resource resolution are accepted.
 */
function normalizedWorkbook(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > xlsxCompressedLimit || bytes[0] !== 80 || bytes[1] !== 75)
    throw new Error('Choose an XLSX workbook no larger than 8 MiB.')
  const entries: Record<string, Uint8Array> = Object.create(null)
  let count = 0,
    total = 0,
    pending = 0
  const names = new Set<string>()
  const unzip = new Unzip((file) => {
    const name = file.name
    if (
      ++count > entryLimit ||
      names.has(name) ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '..' || part === '.') ||
      /[\u0000-\u001f]/.test(name) ||
      ![0, 8].includes(file.compression) ||
      /(?:vbaProject|externalLinks|embeddings|encryptedPackage)/i.test(name)
    )
      throw new Error(
        'Choose a plain XLSX workbook without macros, embedded files or external links.',
      )
    names.add(name)
    if (file.originalSize && file.originalSize > expandedLimit)
      throw new Error('Choose a workbook with at most 24 MiB of expanded content.')
    pending++
    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (error, data, final) => {
      if (error) {
        if (error.message.startsWith('Choose')) throw error
        throw new Error('Choose a valid, unencrypted XLSX workbook.')
      }
      total += data.length
      size += data.length
      if (total > expandedLimit) {
        file.terminate()
        throw new Error('Choose a workbook with at most 24 MiB of expanded content.')
      }
      chunks.push(data)
      if (final) {
        const output = new Uint8Array(size)
        let position = 0
        for (const chunk of chunks) {
          output.set(chunk, position)
          position += chunk.length
        }
        if (!name.endsWith('/')) entries[name] = output
        chunks.length = 0
        pending--
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  try {
    // Small compressed chunks also bound a single inflater callback allocation.
    for (let offset = 0; offset < bytes.length; offset += 256)
      unzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Choose')) throw error
    throw new Error('Choose a valid, unencrypted XLSX workbook.')
  }
  if (pending || !entries['[Content_Types].xml'] || !entries['xl/workbook.xml'])
    throw new Error('Choose a complete XLSX workbook.')
  return zipSync(entries, { level: 0 })
}

export async function readImportWorkbook(bytes: Uint8Array): Promise<WorkBook> {
  const normalized = normalizedWorkbook(bytes)
  // SheetJS recommends dynamic import for Worker startup. Do not use filesystem APIs.
  const { read, SSF } = await import('xlsx')
  const book = read(normalized, {
    type: 'array',
    dense: true,
    raw: true,
    cellDates: true,
    cellNF: true,
    UTC: true,
    cellHTML: false,
    cellStyles: false,
    cellFormula: true,
    bookVBA: false,
    WTF: true,
  })
  // Excel's fictitious 1900-02-29 survives SheetJS date conversion as a number.
  // Flag it instead of importing the serial as an amount or an incorrect date.
  for (const sheet of Object.values(book.Sheets)) {
    const data = (sheet as WorkSheet & { '!data'?: CellObject[][] })['!data'] ?? []
    if (data.length > 1048576) throw new Error('Choose a worksheet within the XLSX row range.')
    for (const row of Object.values(data))
      for (const cell of Object.values(row ?? [])) {
        if (cell?.t === 'n' && cell.z && SSF.is_date(cell.z)) {
          cell.t = 'e'
          cell.v = 15
        }
      }
  }
  return book
}
export function importWorkbookSheets(book: WorkBook) {
  return book.SheetNames.map((name, index) => ({
    name,
    hidden: !!book.Workbook?.Sheets?.[index]?.Hidden,
  }))
}
/** Iterate actual dense cells rather than trusting an attacker-controlled !ref.
 * Formula/error/unsafe numeric cells become review errors, never evaluated values.
 */
export function* importWorkbookRows(
  book: WorkBook,
  sheetName: string,
  after = 0,
): Generator<ImportTableRow> {
  if (
    !book.SheetNames.includes(sheetName) ||
    !Number.isSafeInteger(after) ||
    after < 0 ||
    after > 1048576
  )
    throw new Error('Choose a valid worksheet and row cursor.')
  const sheet = book.Sheets[sheetName] as WorkSheet & { '!data'?: CellObject[][] }
  const data = sheet['!data'] ?? []
  if (data.length > 1048576) throw new Error('Choose a worksheet within the XLSX row range.')
  // Dense worksheet arrays can contain large empty gaps. Only stored rows are
  // visited; their original worksheet numbers remain the resumable cursor.
  for (const key of Object.keys(data)) {
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || index >= 1048576)
      throw new Error('Choose a worksheet within the XLSX row range.')
    if (index < after) continue
    const cells = data[index] ?? []
    if (cells.length > importColumnLimit)
      throw new Error('Choose a worksheet with at most 256 columns.')
    const row: ImportTableRow = { number: index + 1, values: [], issues: [] }
    for (let column = 0; column < cells.length; column++) {
      const cell = cells[column]
      let value = ''
      if (cell) {
        if (cell.f || cell.F)
          row.issues.push({
            column,
            message: 'Replace formulas with reviewed values before importing.',
          })
        else if (cell.t === 'e')
          row.issues.push({ column, message: 'Correct the spreadsheet error before importing.' })
        else if (
          cell.t === 'n' &&
          (typeof cell.v !== 'number' ||
            !Number.isFinite(cell.v) ||
            Math.abs(cell.v) >= 1e15 ||
            String(cell.v).split(/[eE]/)[0].replace(/[-.]/g, '').replace(/^0+/, '').length > 15)
        )
          row.issues.push({
            column,
            message:
              'Store this exact value as text; spreadsheet numeric precision is insufficient.',
          })
        else if (cell.t === 'd') {
          const date = cell.v instanceof Date ? cell.v : new Date(String(cell.v))
          if (!Number.isFinite(date.getTime()))
            row.issues.push({ column, message: 'Choose a valid spreadsheet date.' })
          else value = date.toISOString().replace(/T00:00:00\.000Z$/, '')
        } else value = cell.v == null ? '' : String(cell.v)
      }
      if (value.length > importCellLimit)
        throw new Error(`Choose shorter cell text at row ${index + 1}.`)
      row.values.push(value)
    }
    yield row
  }
}
