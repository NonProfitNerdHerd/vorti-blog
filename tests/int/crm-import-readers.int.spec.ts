import { expect, it, vi } from 'vitest'
import { utils, write } from 'xlsx'
import { strToU8, zipSync } from 'fflate'
import { csvImportRows, type CSVImportRow } from '../../src/crm/import-csv'
import {
  importWorkbookRows,
  importWorkbookSheets,
  readImportWorkbook,
} from '../../src/crm/import-xlsx'

function stream(bytes: Uint8Array, width = 3, cancel?: () => void) {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + width))
      offset += width
    },
    cancel,
  })
}
async function rows(input: string | Uint8Array, width = 3) {
  const result: CSVImportRow[] = []
  for await (const row of csvImportRows(
    stream(typeof input === 'string' ? strToU8(input) : input, width),
  ))
    result.push(row)
  return result
}
function workbook(sheets: Array<{ name: string; values: unknown[][] }>) {
  const book = utils.book_new()
  for (const sheet of sheets)
    utils.book_append_sheet(book, utils.aoa_to_sheet(sheet.values, { UTC: true }), sheet.name)
  return book
}

it('preserves UTF-8 names, exact large identifiers, blanks, escaped quotes and embedded newlines over byte boundaries', async () => {
  const parsed = await rows(
    '\uFEFF"Name",ID,Notes,Blank\r\n"Zoë 😀",90071992547409931,"One, two\r\nthree ""quoted""",\r\n',
  )
  expect(parsed.map((r) => r.values)).toEqual([
    ['Name', 'ID', 'Notes', 'Blank'],
    ['Zoë 😀', '90071992547409931', 'One, two\r\nthree "quoted"', ''],
  ])
  expect(parsed[1].number).toBe(2)
  expect(parsed[1].next.row).toBe(3)
  expect(parsed[1].next.skipLF).toBe(true)
})
it('resumes from every exact record cursor, including CRLF split across a range and multibyte text', async () => {
  const bytes = strToU8('\uFEFF"Name",value\r\n"Zoë 😀",001\r\n"Two\nlines",002\rLast,003')
  const complete = await rows(bytes, 1)
  for (let index = 0; index < complete.length; index++) {
    const cursor = complete[index].next,
      result: CSVImportRow[] = []
    for await (const row of csvImportRows(stream(bytes.subarray(cursor.offset), 1), {
      resume: cursor,
    }))
      result.push(row)
    expect(result).toEqual(complete.slice(index + 1))
  }
})
it('cancels a paused range without reading the whole source and does not cap matching records', async () => {
  const bytes = strToU8(
    Array.from({ length: 5001 }, (_, index) => `${index},Fictional ${index}`).join('\n'),
  )
  const cancel = vi.fn(),
    first = csvImportRows(stream(bytes, 100, cancel))
  const page: CSVImportRow[] = []
  for await (const row of first) {
    page.push(row)
    if (page.length === 51) break
  }
  expect(cancel).toHaveBeenCalledTimes(1)
  let count = page.length
  const resume = page.at(-1)!.next
  for await (const _row of csvImportRows(stream(bytes.subarray(resume.offset), 100), { resume }))
    count++
  expect(count).toBe(5001)
})
it('handles delimiter choices, empty cells and literal formula-looking CSV text without coercion', async () => {
  const parsed: CSVImportRow[] = []
  for await (const row of csvImportRows(stream(strToU8('key;amount;clear\n001;=SUM(A1);\n'), 1), {
    delimiter: ';',
  }))
    parsed.push(row)
  expect(parsed[1].values).toEqual(['001', '=SUM(A1)', ''])
  expect((await rows('x')).map((r) => r.values)).toEqual([['x']])
  expect((await rows('')).length).toBe(0)
  expect((await rows('\n\r\n')).map((r) => r.values)).toEqual([[''], ['']])
})
it('rejects malformed quotes, invalid UTF-8, oversized cells and excess columns with the logical row number', async () => {
  for (const value of ['a\n"unclosed', 'a\nplain"quote', 'a\n"closed"x'])
    await expect(rows(value)).rejects.toThrow('row 2')
  await expect(rows(new Uint8Array([97, 10, 255]))).rejects.toThrow('UTF-8')
  await expect(rows('a'.repeat(32769), 8192)).rejects.toThrow('cell exceeds')
  await expect(rows(Array(257).fill('x').join(','))).rejects.toThrow('256 columns')
})
it('reads explicit workbook sheets, preserves blank columns and exact text, and normalizes spreadsheet dates', async () => {
  const book = workbook([
    {
      name: 'Contacts',
      values: [
        ['ID', 'Name', 'Blank', 'Date'],
        ['90071992547409931', 'Zoë 😀', '', new Date('2026-10-24T00:00:00Z')],
      ],
    },
    { name: 'Other', values: [['ID'], ['002']] },
  ])
  book.Workbook = {
    Sheets: [
      { name: 'Contacts', Hidden: 0 },
      { name: 'Other', Hidden: 1 },
    ],
  }
  const parsed = await readImportWorkbook(
    new Uint8Array(write(book, { type: 'array', bookType: 'xlsx', cellDates: true })),
  )
  expect(importWorkbookSheets(parsed)).toEqual([
    { name: 'Contacts', hidden: false },
    { name: 'Other', hidden: true },
  ])
  expect([...importWorkbookRows(parsed, 'Contacts')][1]).toEqual({
    number: 2,
    values: ['90071992547409931', 'Zoë 😀', '', '2026-10-24'],
    issues: [],
  })
  expect([...importWorkbookRows(parsed, 'Other', 1)][0].values).toEqual(['002'])
  expect(() => [...importWorkbookRows(parsed, 'Missing')]).toThrow('worksheet')
})
it('flags spreadsheet formulas, errors and uncertain numeric precision without using cached computed values', async () => {
  const book = workbook([
    {
      name: 'Data',
      values: [['Formula', 'Error', 'Exact text', 'Unsafe number', 'Safe', 'Rounded decimal']],
    },
  ])
  book.Sheets.Data.A2 = { t: 'n', v: 123, f: '1+122' }
  book.Sheets.Data.B2 = { t: 'e', v: 7 }
  book.Sheets.Data.C2 = { t: 's', v: '900719925474099.31' }
  book.Sheets.Data.D2 = { t: 'n', v: 90071992547409931 }
  book.Sheets.Data.E2 = { t: 'n', v: 10.25 }
  book.Sheets.Data.F2 = { t: 'n', v: 900719925474099.31 }
  book.Sheets.Data['!ref'] = 'A1:F2'
  const parsed = await readImportWorkbook(
    new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })),
  )
  const row = [...importWorkbookRows(parsed, 'Data')][1]
  expect(row.values).toEqual(['', '', '900719925474099.31', '', '10.25', ''])
  expect(row.issues.map((r) => r.column)).toEqual([0, 1, 3, 5])
})
it('rejects macros, remote relationships, duplicate ZIP entries and incomplete or malformed workbooks', async () => {
  for (const name of [
    'xl/vbaProject.bin',
    'xl/externalLinks/externalLink1.xml',
    'xl/embeddings/file.bin',
    '../xl/workbook.xml',
  ]) {
    await expect(readImportWorkbook(zipSync({ [name]: strToU8('x') }))).rejects.toThrow(
      'plain XLSX',
    )
  }
  await expect(readImportWorkbook(strToU8('not a workbook'))).rejects.toThrow('XLSX')
  await expect(
    readImportWorkbook(zipSync({ '[Content_Types].xml': strToU8('x') })),
  ).rejects.toThrow('complete XLSX')
  const duplicate = zipSync({ 'a.bin': strToU8('x'), 'b.bin': strToU8('y') })
  const name = strToU8('b.bin')
  for (let index = 0; index <= duplicate.length - name.length; index++) {
    if (name.every((byte, offset) => duplicate[index + offset] === byte)) duplicate[index] = 97
  }
  await expect(readImportWorkbook(duplicate)).rejects.toThrow('plain XLSX')
})
it('bounds actual ZIP inflation even when the local size header falsely declares a small entry', async () => {
  const bytes = zipSync({ 'xl/workbook.xml': new Uint8Array(24 * 1024 * 1024 + 1) }, { level: 9 })
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(22, 1, true)
  await expect(readImportWorkbook(bytes)).rejects.toThrow('24 MiB')
})

it('handles the 1904 date epoch and rejects Excel fictitious dates rather than importing serial values', async () => {
  const book = workbook([{ name: 'Dates', values: [['Date']] }])
  book.Workbook = { WBProps: { date1904: true } }
  book.Sheets.Dates.A2 = { t: 'n', v: 0, z: 'yyyy-mm-dd' }
  book.Sheets.Dates['!ref'] = 'A1:A2'
  let parsed = await readImportWorkbook(
    new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })),
  )
  expect([...importWorkbookRows(parsed, 'Dates')][1].values).toEqual(['1904-01-01'])
  book.Workbook.WBProps!.date1904 = false
  book.Sheets.Dates.A2.v = 60
  parsed = await readImportWorkbook(
    new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })),
  )
  expect([...importWorkbookRows(parsed, 'Dates')][1].issues).toHaveLength(1)
})
it('retains sparse worksheet row cursors without expanding empty ranges into artificial records', async () => {
  const book = workbook([{ name: 'Sparse', values: [['ID']] }])
  book.Sheets.Sparse.A1000000 = { t: 's', v: 'Fictional last source row' }
  book.Sheets.Sparse['!ref'] = 'A1:A1000000'
  const parsed = await readImportWorkbook(
    new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })),
  )
  const result = [...importWorkbookRows(parsed, 'Sparse')]
  expect(result.map((r) => r.number)).toEqual([1, 1000000])
  expect([...importWorkbookRows(parsed, 'Sparse', 999999)]).toEqual([result[1]])
})
