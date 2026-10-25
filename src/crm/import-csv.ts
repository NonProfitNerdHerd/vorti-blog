export type CSVResume = { offset: number; row: number; skipLF: boolean }
export type ImportTableRow = {
  number: number
  values: string[]
  issues: Array<{ column: number; message: string }>
}
export type CSVImportRow = ImportTableRow & { next: CSVResume }
export const importCellLimit = 32768
export const importColumnLimit = 256
const rowByteLimit = 512 * 1024

/** RFC 4180 records over a private R2 range stream. Every emitted cursor is an
 * exact byte boundary, including UTF-8, escaped quotes, embedded newlines and CRLF.
 * Returning early cancels the input so a durable staging job can checkpoint a page.
 */
export async function* csvImportRows(
  stream: ReadableStream<Uint8Array>,
  options: { delimiter?: ',' | ';' | '\t'; resume?: CSVResume } = {},
): AsyncGenerator<CSVImportRow> {
  const delimiter = options.delimiter ?? ',',
    resume = options.resume ?? { offset: 0, row: 1, skipLF: false }
  if (
    ![',', ';', '\t'].includes(delimiter) ||
    !Number.isSafeInteger(resume.offset) ||
    resume.offset < 0 ||
    !Number.isSafeInteger(resume.row) ||
    resume.row < 1 ||
    typeof resume.skipLF !== 'boolean'
  )
    throw new Error('Choose a valid CSV delimiter or resume cursor.')
  const reader = stream.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let offset = resume.offset,
    number = resume.row,
    skipLF = resume.skipLF,
    state: 'start' | 'plain' | 'quoted' | 'closed' = 'start',
    bytes: number[] = [],
    values: string[] = [],
    rowBytes = 0,
    touched = false,
    prefixPending = resume.offset === 0
  const prefix: number[] = []
  const fail = (message: string): never => {
    throw new Error(`Enter valid CSV: row ${number}. ${message}`)
  }
  const append = (byte: number) => {
    bytes.push(byte)
    if (bytes.length > importCellLimit * 4) fail('A cell exceeds the supported text length.')
  }
  const cell = () => {
    let value: string
    try {
      value = decoder.decode(new Uint8Array(bytes))
    } catch {
      return fail('Use UTF-8 text.')
    }
    if (value.length > importCellLimit) fail('A cell exceeds the supported text length.')
    values.push(value)
    if (values.length > importColumnLimit) fail('Use at most 256 columns.')
    bytes = []
    state = 'start'
  }
  const row = (cr: boolean): CSVImportRow => {
    cell()
    const result: CSVImportRow = {
      number,
      values,
      issues: [],
      next: { offset, row: number + 1, skipLF: cr },
    }
    values = []
    rowBytes = 0
    touched = false
    number++
    return result
  }
  try {
    while (true) {
      const chunk = await reader.read()
      let data = chunk.value ?? new Uint8Array()
      if (prefixPending) {
        let index = 0
        while (prefix.length < 3 && index < data.length) prefix.push(data[index++])
        if (prefix.length < 3 && !chunk.done) continue
        prefixPending = false
        if (prefix[0] === 239 && prefix[1] === 187 && prefix[2] === 191) {
          offset += 3
          data = data.subarray(index)
        } else {
          const combined = new Uint8Array(prefix.length + data.length - index)
          combined.set(prefix)
          combined.set(data.subarray(index), prefix.length)
          data = combined
        }
      }
      for (const byte of data) {
        offset++
        if (skipLF) {
          skipLF = false
          if (byte === 10) continue
        }
        touched = true
        if (++rowBytes > rowByteLimit)
          fail('A record exceeds 512 KiB. Split long fields before importing.')
        if (state === 'quoted') {
          if (byte === 34) state = 'closed'
          else append(byte)
          continue
        }
        if (state === 'closed' && byte === 34) {
          append(byte)
          state = 'quoted'
          continue
        }
        if (byte === delimiter.charCodeAt(0)) {
          cell()
          continue
        }
        if (byte === 13 || byte === 10) {
          skipLF = byte === 13
          yield row(skipLF)
          continue
        }
        if (state === 'closed') fail('Only a delimiter or newline may follow a closing quote.')
        if (byte === 34) {
          if (state !== 'start') fail('Quote a whole field or escape its quotes.')
          state = 'quoted'
          continue
        }
        append(byte)
        state = 'plain'
      }
      if (chunk.done) break
    }
    if (state === 'quoted') fail('Close the quoted field.')
    if (touched || bytes.length || values.length) yield row(false)
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
}
