/** Match Payload's draft precedence; update + explicit published is a publication. */
export function isFormDraftOperation(operation: 'create' | 'update', args: {
  draft?: boolean
  publishAllLocales?: boolean
  data?: Record<string, unknown>
}): boolean {
  return args.draft === true && args.publishAllLocales !== true &&
    (operation === 'create' || args.data?._status !== 'published')
}
