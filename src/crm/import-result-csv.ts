/** CSV is intended for spreadsheet review. Formula-leading values and numbers
 * spreadsheets would round are marked as text. Original bytes remain available
 * through the separate private source download. */
export function importCSVCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (
    /^[\u0000-\u0020\ufeff]*[=+\-@]/.test(text) ||
    /^[\t\r\n]/.test(text) ||
    /^0\d/.test(text) ||
    (/^\d+(?:\.\d*)?$/.test(text) && text.replace(/\D/g, '').length > 15) ||
    /^\d+(?:\.\d*)?[eE][+-]?\d+$/.test(text)
  )
    text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}
export function importCSVLine(values: unknown[]): string {
  return values.map(importCSVCell).join(',') + '\r\n'
}
