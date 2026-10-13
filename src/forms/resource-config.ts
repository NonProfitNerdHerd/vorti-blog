import type { CollectionConfig } from 'payload'
import { ValidationError } from 'payload'
import type { FormPlatform } from './platform'
import { BookingStore } from './booking'

export interface ResourceSlot { id: string; startsAt: string; endsAt: string; capacity: number }
export function resourceCollection(base: CollectionConfig, platform: FormPlatform): CollectionConfig {
  return { ...base, fields: base.fields.map(field => 'name' in field && field.name === 'availability' ? {
    ...field, admin: { components: { Field: './forms/ResourceEditor#ResourceEditor' } },
  } : field), hooks: {
    beforeValidate: [async ({ data, originalDoc }) => {
      if (!data) return data
      const fail = (message: string, path = 'availability'): never => { throw new ValidationError({ errors: [{ path, message }] }) }
      if (originalDoc?.site && data.site && data.site !== originalDoc.site) fail('A resource cannot move between sites.', 'site')
      try { new Intl.DateTimeFormat('en', { timeZone: data.timezone || originalDoc?.timezone || 'UTC' }).format() } catch { fail('Choose a valid timezone.', 'timezone') }
      if (data.holdMinutes != null && (!Number.isInteger(data.holdMinutes) || data.holdMinutes < 1 || data.holdMinutes > 60)) fail('Holds last between 1 and 60 whole minutes.', 'holdMinutes')
      const slots = data.availability
      if (slots !== undefined) {
        if (!Array.isArray(slots) || slots.length > 500) fail('Add up to 500 available time slots.')
        const ids = new Set<string>()
        for (const slot of slots as ResourceSlot[]) {
          if (!slot || typeof slot.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(slot.id) || ids.has(slot.id)) fail('Each slot needs a unique identifier.')
          ids.add(slot.id)
          if (![slot.startsAt, slot.endsAt].every(value => typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))) || Date.parse(slot.endsAt) <= Date.parse(slot.startsAt)) fail('Each slot needs a valid start and a later end, including timezone offsets.')
          if (!Number.isInteger(slot.capacity) || slot.capacity < 1 || slot.capacity > 1000) fail('Slot capacity must be between 1 and 1000 places.')
          slot.startsAt = new Date(slot.startsAt).toISOString(); slot.endsAt = new Date(slot.endsAt).toISOString()
          const previous = (originalDoc?.availability as ResourceSlot[] | undefined)?.find(item => item.id === slot.id)
          if (previous && (previous.startsAt !== slot.startsAt || previous.endsAt !== slot.endsAt)) fail('Saved slot times are fixed for reservation history. Remove that slot from availability and add a new one.')
          const existing = await platform.db.prepare('SELECT site, resource, starts_at, ends_at, (SELECT COALESCE(SUM(quantity),0) FROM form_booking_holds WHERE slot_id=s.id AND (status=\'confirmed\' OR (status=\'held\' AND expires_ms>?))) AS reserved FROM form_booking_slots s WHERE id=?').bind(Date.now(), slot.id).first<{ site: string; resource: string; starts_at: string; ends_at: string; reserved: number }>()
          if (existing && (existing.site !== (data.site || originalDoc?.site || 'default') || existing.resource !== String(originalDoc?.id))) fail('This slot identifier is already in use. Generate a new slot.')
          if (existing && (existing.starts_at !== slot.startsAt || existing.ends_at !== slot.endsAt)) fail('Saved slot times cannot be changed. Generate a new slot.')
          if (existing && existing.reserved > slot.capacity) fail(`This slot already has ${existing.reserved} reserved places. Cancel reservations before reducing its capacity.`)
        }
      }
      return data
    }],
    afterChange: [async ({ doc }) => {
      const store = new BookingStore(platform.db)
      try {
        for (const slot of (doc.availability || []) as ResourceSlot[]) await store.defineSlot({ ...slot, site: doc.site, resource: String(doc.id) })
      } catch { throw new ValidationError({ errors: [{ path: 'availability', message: 'Availability changed while saving. Reload to see the current reservation counts before reducing capacity.' }] }) }
      return doc
    }],
    afterRead: [async ({ doc }) => {
      const rows = await platform.db.prepare('SELECT id, capacity FROM form_booking_slots WHERE site=? AND resource=?').bind(doc.site, String(doc.id)).all<{ id: string; capacity: number }>()
      const capacities = new Map(rows.results.map(slot => [slot.id, slot.capacity]))
      return { ...doc, availability: ((doc.availability || []) as ResourceSlot[]).map(slot => ({ ...slot, capacity: capacities.get(slot.id) ?? slot.capacity })) }
    }],
  } }
}
