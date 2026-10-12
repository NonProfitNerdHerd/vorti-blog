import type { TypeField, TypeFieldKind } from '@design-system/payload-design-core/content'

export function restoreRequiredField(fields: TypeField[], kind: TypeFieldKind): TypeField[] {
  const existing = fields.find((field) => field.kind === kind)
  if (existing)
    return fields.map((field) =>
      field.id === existing.id ? { ...field, public: true, required: true } : field,
    )
  let id: string = kind,
    suffix = 2
  while (fields.some((field) => field.id === id)) id = `${kind}${suffix++}`
  return [
    ...fields,
    {
      id,
      kind,
      label: kind === 'eventSchedule' ? 'Event Schedule' : kind,
      required: true,
      public: true,
    },
  ]
}
