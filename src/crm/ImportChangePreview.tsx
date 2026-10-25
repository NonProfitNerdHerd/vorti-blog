type Cell = { path: string[]; value: unknown }
function fields(value: unknown, path: string[] = []): Cell[] {
  if (Array.isArray(value) && value.length)
    return value.flatMap((item, index) => fields(item, [...path, String(index + 1)]))
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value)
    if (entries.length) return entries.flatMap(([key, item]) => fields(item, [...path, key]))
  }
  return [{ path, value }]
}
function label(path: string[]) {
  return path.length
    ? path.map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')).join(' → ')
    : 'Record'
}
function display(cell: Cell | undefined): string {
  if (!cell) return 'Not present'
  const value = cell.value
  if (value === null) return 'No value (null)'
  if (value === undefined) return 'Not present'
  if (value === '') return 'Blank text'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return 'Empty list'
  if (typeof value === 'object') return 'Empty record'
  return String(value)
}
/** Present complete authorized snapshots without converting exact financial strings. */
export function ImportChangePreview({ before, after }: { before: unknown; after: unknown }) {
  const existing = new Map(fields(before).map((cell) => [JSON.stringify(cell.path), cell]))
  const proposed = new Map(fields(after).map((cell) => [JSON.stringify(cell.path), cell]))
  const paths = new Set([...existing.keys(), ...proposed.keys()])
  return (
    <section aria-label="Field comparison">
      <p>
        Compare the saved record with the proposed operation. Their field layouts may differ. Not
        present means the field is absent from that snapshot; it does not by itself mean clear.
      </p>
      <div className="vc-crm-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Existing value</th>
              <th scope="col">Proposed value</th>
            </tr>
          </thead>
          <tbody>
            {[...paths].map((key) => {
              const left = existing.get(key),
                right = proposed.get(key)
              return (
                <tr key={key}>
                  <th scope="row">{label((left || right)!.path)}</th>
                  <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {display(left)}
                  </td>
                  <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {display(right)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Inspect original review snapshots</summary>
        <h5>Existing values</h5>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify(before, null, 2)}
        </pre>
        <h5>Proposed values</h5>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify(after, null, 2)}
        </pre>
      </details>
    </section>
  )
}
