/** Payload preserves a permission object when an access function returns a scoped query. */
export function allowsOperation(value: unknown): boolean {
  return value === true || Boolean(value && typeof value === 'object' && 'permission' in value && value.permission === true)
}
