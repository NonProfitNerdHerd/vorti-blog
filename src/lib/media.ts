import type { Media } from '@/payload-types'

export function mediaURL(value: number | Media | null | undefined): string | null {
  return value && typeof value === 'object' ? value.url || null : null
}
