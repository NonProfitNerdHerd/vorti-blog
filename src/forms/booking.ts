import { FormHTTPError, randomToken, hashToken } from './security'

export interface BookingSlot { id: string; site: string; resource: string; startsAt: string; endsAt: string; capacity: number }
export interface Hold { token: string; expiresAt: string; slot: string }
export class BookingStore {
  constructor(private db: D1Database) {}
  async defineSlot(slot: BookingSlot): Promise<void> {
    if (!Number.isInteger(slot.capacity) || slot.capacity < 1 || !Number.isFinite(Date.parse(slot.startsAt)) || !Number.isFinite(Date.parse(slot.endsAt)) || Date.parse(slot.endsAt) <= Date.parse(slot.startsAt)) throw new FormHTTPError('Invalid slot.')
    const updated = await this.db.prepare("INSERT INTO form_booking_slots (id, site, resource, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET capacity=excluded.capacity WHERE site=excluded.site AND resource=excluded.resource AND starts_at=excluded.starts_at AND ends_at=excluded.ends_at AND excluded.capacity >= (SELECT COALESCE(SUM(quantity),0) FROM form_booking_holds WHERE slot_id=excluded.id AND (status='confirmed' OR (status='held' AND expires_ms>?)))").bind(slot.id, slot.site, slot.resource, slot.startsAt, slot.endsAt, slot.capacity, Date.now()).run()
    if (updated.meta.changes !== 1) throw new FormHTTPError('A saved slot cannot change its dates or reduce capacity below active reservations.', 409)
  }
  async available(site: string, resource: string, from: string, to: string, now = Date.now()) {
    return (await this.db.prepare(`SELECT s.id, s.starts_at, s.ends_at, s.capacity - COALESCE((SELECT SUM(h.quantity) FROM form_booking_holds h WHERE h.slot_id=s.id AND (h.status='confirmed' OR (h.status='held' AND h.expires_ms > ?))),0) AS remaining FROM form_booking_slots s WHERE s.site=? AND s.resource=? AND s.starts_at>=? AND s.starts_at<? ORDER BY s.starts_at LIMIT 500`).bind(now, site, resource, from, to).all()).results
  }
  async hold(site: string, slot: string, sessionHash: string, quantity = 1, minutes = 10, now = Date.now()): Promise<Hold> {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || !Number.isFinite(minutes)) throw new FormHTTPError('Invalid booking quantity or hold duration.')
    const token = randomToken(), hash = await hashToken(token), expires = now + Math.max(1, Math.min(minutes, 60)) * 60000
    // The capacity check and allocation are one SQLite statement, so concurrent requests cannot both claim the last place.
    const result = await this.db.prepare(`INSERT INTO form_booking_holds (token_hash, site, slot_id, session_hash, quantity, expires_ms, status) SELECT ?, ?, id, ?, ?, ?, 'held' FROM form_booking_slots s WHERE id=? AND site=? AND starts_at>? AND capacity >= ? + COALESCE((SELECT SUM(quantity) FROM form_booking_holds h WHERE h.slot_id=s.id AND (h.status='confirmed' OR (h.status='held' AND h.expires_ms>?))),0)`).bind(hash, site, sessionHash, quantity, expires, slot, site, new Date(now).toISOString(), quantity, now).run()
    if (result.meta.changes !== 1) throw new FormHTTPError('This slot no longer has enough places. Choose another slot.', 409)
    return { token, expiresAt: new Date(expires).toISOString(), slot }
  }
  async release(site: string, token: string, sessionHash: string): Promise<void> {
    await this.db.prepare("UPDATE form_booking_holds SET status='released' WHERE token_hash=? AND site=? AND session_hash=? AND status='held'").bind(await hashToken(token), site, sessionHash).run()
  }
  async cancel(site: string, submissionKey: string): Promise<void> {
    await this.db.prepare("UPDATE form_booking_holds SET status='canceled' WHERE site=? AND submission_key=? AND status='confirmed'").bind(site, submissionKey).run()
  }
}
export const bookingSQL = [
  'CREATE TABLE IF NOT EXISTS form_booking_slots (id text PRIMARY KEY NOT NULL, site text NOT NULL, resource text NOT NULL, starts_at text NOT NULL, ends_at text NOT NULL, capacity integer NOT NULL CHECK(capacity > 0))',
  'CREATE INDEX IF NOT EXISTS form_booking_slots_scope ON form_booking_slots(site,resource,starts_at)',
  "CREATE TABLE IF NOT EXISTS form_booking_holds (token_hash text PRIMARY KEY NOT NULL, site text NOT NULL, slot_id text NOT NULL REFERENCES form_booking_slots(id), session_hash text NOT NULL, quantity integer NOT NULL CHECK(quantity > 0), expires_ms integer NOT NULL, status text NOT NULL CHECK(status IN ('held','confirmed','released','canceled')), submission_key text)",
  'CREATE INDEX IF NOT EXISTS form_booking_holds_slot ON form_booking_holds(slot_id,status,expires_ms)',
  'CREATE UNIQUE INDEX IF NOT EXISTS form_booking_submission_slot ON form_booking_holds(submission_key,slot_id) WHERE submission_key IS NOT NULL',
  'CREATE TABLE IF NOT EXISTS form_rate_windows (key text NOT NULL, window integer NOT NULL, count integer NOT NULL, PRIMARY KEY(key,window))',
]
