import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import type { InformationCategory } from '../organizations/policy'
import { SiteConflictError } from '../organizations/atomic'
import { commitCRM, replayCRM } from './mutations'
import { givingDate } from './commitment-model'
import {
  volunteerParticipationStates,
  type VolunteerActivity,
  type VolunteerProfile,
  type VolunteerParticipation,
  type VolunteerInvitation,
  type VolunteerHours,
} from './volunteer-model'
type Scope = Awaited<ReturnType<OrganizationRepository['require']>>
type Mutation = {
  site: string
  id?: string
  expectedRevision?: number
  operationKey: string
  values: Record<string, unknown>
}
const value = (v: unknown, max: number, required = false) => {
  if (
    typeof v !== 'string' ||
    v.trim().length > max ||
    (required && !v.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    throw new Error('Enter valid volunteer values within the length limits.')
  return v.trim()
}
function labels(input: unknown) {
  if (!Array.isArray(input) || input.length > 50)
    throw new Error('Enter at most 50 skills or interests.')
  const result = new Map<string, string>()
  for (const entry of input) {
    const text = value(entry, 80, true)
    result.set(text.toLowerCase(), text)
  }
  return [...result.values()]
}
const contactJoin = `JOIN vc_crm_constituents c ON c.id=v.constituent_id AND c.archived=0 JOIN vc_crm_affiliations f ON f.constituent_id=c.id AND f.site_id=a.site_id AND f.archived=0`
const profileColumns = `v.*,c.label,CASE WHEN v.archived=0 AND v.do_not_contact=0 AND json_extract(c.profile,'$.communication.volunteerAllowed') IS NOT 0 THEN 1 ELSE 0 END AS contact_allowed`
export class VolunteerRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
    private commit: typeof commitCRM = commitCRM,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async scope(site: string, category: InformationCategory, operation: 'read' | 'edit') {
    const grant = await this.authority.require(site, category, operation),
      identity = await this.authority.require(site, 'identity', 'read')
    if (grant.authorityRevision !== identity.authorityRevision) throw new SiteAccessError()
    return grant
  }
  private async fence(site: Scope) {
    const row = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(site.organization_id)
      .first<{ authority_revision: number }>()
    if (row?.authority_revision !== site.authorityRevision) throw new SiteAccessError()
  }
  private async activity(site: string, id: string) {
    const doc = await this.db
      .prepare('SELECT * FROM vc_crm_volunteer_activities WHERE site_id=? AND id=?')
      .bind(site, id)
      .first<Omit<VolunteerActivity, 'skills'> & { skills: string }>()
    if (!doc) throw new SiteAccessError()
    return { ...doc, skills: JSON.parse(doc.skills) as string[] }
  }
  private async profile(site: string, id: string) {
    const doc = await this.db
      .prepare(
        `SELECT ${profileColumns} FROM vc_crm_volunteer_profiles v JOIN vc_crm_constituents c ON c.id=v.constituent_id AND c.archived=0 JOIN vc_crm_affiliations f ON f.constituent_id=c.id AND f.site_id=v.site_id AND f.archived=0 WHERE v.site_id=? AND v.constituent_id=?`,
      )
      .bind(site, id)
      .first<
        Omit<VolunteerProfile, 'skills' | 'interests'> & { skills: string; interests: string }
      >()
    if (!doc) throw new SiteAccessError()
    return {
      ...doc,
      skills: JSON.parse(doc.skills) as string[],
      interests: JSON.parse(doc.interests) as string[],
    }
  }
  private async finish(
    site: Scope,
    input: Mutation,
    action: string,
    type: string,
    id: string,
    before: unknown,
    intent: unknown,
    write: D1PreparedStatement,
    dependent: D1PreparedStatement[] = [],
  ) {
    return this.commit({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type,
      id,
      before,
      after: intent,
      intent,
      write,
      dependent,
      result: { id },
    })
  }
  private guards(key: string, query: string, params: Array<string | number>) {
    return [
      this.db
        .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${query}`)
        .bind(key, ...params),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
    ]
  }
  async profiles(
    siteID: string,
    search = '',
    after = '',
    archived = false,
    eligibleOnly = false,
    contact = '',
  ) {
    const site = await this.scope(siteID, 'volunteer-experience', 'read'),
      term = value(search, 120),
      query = term
    const rows = await this.db
      .prepare(
        `SELECT ${profileColumns} FROM vc_crm_volunteer_profiles v JOIN vc_crm_constituents c ON c.id=v.constituent_id AND c.archived=0 JOIN vc_crm_affiliations f ON f.constituent_id=c.id AND f.site_id=v.site_id AND f.archived=0
      WHERE v.site_id=? AND v.archived=? AND v.constituent_id>? ${eligibleOnly ? "AND v.do_not_contact=0 AND json_extract(c.profile,'$.communication.volunteerAllowed') IS NOT 0" : ''}
      ${contact ? 'AND v.constituent_id=?' : ''}
      AND (instr(lower(c.label),lower(?))>0 OR EXISTS(SELECT 1 FROM json_each(v.skills) WHERE instr(lower(value),lower(?))>0) OR EXISTS(SELECT 1 FROM json_each(v.interests) WHERE instr(lower(value),lower(?))>0)) ORDER BY v.constituent_id LIMIT 51`,
      )
      .bind(siteID, archived ? 1 : 0, after, ...(contact ? [contact] : []), query, query, query)
      .all<Omit<VolunteerProfile, 'skills' | 'interests'> & { skills: string; interests: string }>()
    const canEdit = (await this.authority.authority(siteID, 'volunteer-experience', 'edit')).allowed
    await this.fence(site)
    return {
      docs: rows.results.slice(0, 50).map((d) => ({
        ...d,
        skills: JSON.parse(d.skills) as string[],
        interests: JSON.parse(d.interests) as string[],
      })),
      next: rows.results.length > 50 ? rows.results[49].constituent_id : null,
      canEdit,
    }
  }
  async getProfile(siteID: string, contact: string) {
    const site = await this.scope(siteID, 'volunteer-experience', 'read'),
      doc = await this.profile(siteID, contact)
    const [edit, notes, activity, hours] = await Promise.all([
      this.authority.authority(siteID, 'volunteer-experience', 'edit'),
      this.authority.authority(siteID, 'communications', 'read'),
      this.authority.authority(siteID, 'restricted-activity', 'read'),
      this.authority.authority(siteID, 'volunteer-hours', 'read'),
    ])
    await this.fence(site)
    return {
      doc,
      canEdit: edit.allowed,
      canNotes: notes.allowed,
      canActivity: activity.allowed,
      canHours: activity.allowed && hours.allowed,
    }
  }
  async saveProfile(input: Mutation) {
    const site = await this.scope(input.site, 'volunteer-experience', 'edit'),
      v = input.values,
      contact = value(v.constituent, 100, true),
      skills = labels(v.skills),
      interests = labels(v.interests),
      availability = value(v.availability ?? '', 2000),
      doNotContact = v.doNotContact === true ? 1 : 0,
      archived = v.archived === true ? 1 : 0
    const action = input.id ? 'volunteer.profile.updated' : 'volunteer.profile.created',
      intent = {
        contact,
        revision: input.expectedRevision ?? null,
        skills,
        interests,
        availability,
        doNotContact,
        archived,
      }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'volunteer-profile',
      intent,
    })
    if (replay) return replay
    if (input.id && input.id !== contact) throw new SiteAccessError()
    const before = input.id ? await this.profile(input.site, contact) : null
    if (
      !before &&
      (await this.db
        .prepare('SELECT 1 FROM vc_crm_volunteer_profiles WHERE site_id=? AND constituent_id=?')
        .bind(input.site, contact)
        .first())
    )
      throw new Error('Choose the existing volunteer profile for this person.')
    if (
      !before &&
      !(await this.db
        .prepare(
          "SELECT 1 FROM vc_crm_constituents c JOIN vc_crm_affiliations f ON f.constituent_id=c.id AND f.site_id=? AND f.archived=0 WHERE c.id=? AND c.kind='person' AND c.archived=0",
        )
        .bind(input.site, contact)
        .first())
    )
      throw new Error('Choose an active chapter person for the volunteer profile.')
    if (before && !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    return this.finish(
      site,
      input,
      action,
      'volunteer-profile',
      contact,
      before,
      intent,
      before
        ? this.db
            .prepare(
              'UPDATE vc_crm_volunteer_profiles SET skills=?,interests=?,availability=?,do_not_contact=?,archived=?,revision=revision+1 WHERE site_id=? AND constituent_id=? AND revision=?',
            )
            .bind(
              JSON.stringify(skills),
              JSON.stringify(interests),
              availability,
              doNotContact,
              archived,
              input.site,
              contact,
              input.expectedRevision!,
            )
        : this.db
            .prepare(
              'INSERT INTO vc_crm_volunteer_profiles(site_id,constituent_id,skills,interests,availability,do_not_contact,archived) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(
              input.site,
              contact,
              JSON.stringify(skills),
              JSON.stringify(interests),
              availability,
              doNotContact,
              archived,
            ),
    )
  }
  async activities(siteID: string, after = '', archived = false, contact = '') {
    const site = await this.scope(siteID, 'restricted-activity', 'read'),
      rows = await this.db
        .prepare(
          `SELECT a.* FROM vc_crm_volunteer_activities a WHERE a.site_id=? AND a.archived=? AND a.id>? ${contact ? `AND EXISTS(SELECT 1 FROM vc_crm_volunteer_participation v ${contactJoin} WHERE v.activity_id=a.id AND v.constituent_id=?)` : ''} ORDER BY a.id LIMIT 51`,
        )
        .bind(siteID, archived ? 1 : 0, after, ...(contact ? [contact] : []))
        .all<Omit<VolunteerActivity, 'skills'> & { skills: string }>(),
      canEdit = (await this.authority.authority(siteID, 'restricted-activity', 'edit')).allowed
    await this.fence(site)
    return {
      docs: rows.results
        .slice(0, 50)
        .map((d) => ({ ...d, skills: JSON.parse(d.skills) as string[] })),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit,
    }
  }
  async getActivity(siteID: string, id: string, after = '') {
    const site = await this.scope(siteID, 'restricted-activity', 'read'),
      doc = await this.activity(siteID, id)
    const rows = await this.db
      .prepare(
        `SELECT v.*,c.label FROM vc_crm_volunteer_participation v JOIN vc_crm_volunteer_activities a ON a.id=v.activity_id ${contactJoin} WHERE a.site_id=? AND a.id=? AND v.id>? ORDER BY v.id LIMIT 51`,
      )
      .bind(siteID, id, after)
      .all<VolunteerParticipation>()
    const [edit, hoursRead, hoursEdit, communicationsRead, communicationsEdit, experience] =
      await Promise.all([
        this.authority.authority(siteID, 'restricted-activity', 'edit'),
        this.authority.authority(siteID, 'volunteer-hours', 'read'),
        this.authority.authority(siteID, 'volunteer-hours', 'edit'),
        this.authority.authority(siteID, 'communications', 'read'),
        this.authority.authority(siteID, 'communications', 'edit'),
        this.authority.authority(siteID, 'volunteer-experience', 'read'),
      ])
    await this.fence(site)
    return {
      doc,
      participants: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit: edit.allowed,
      canReadHours: hoursRead.allowed,
      canEditHours: hoursEdit.allowed,
      canReadInvitations: communicationsRead.allowed,
      canInvite: communicationsEdit.allowed && experience.allowed,
    }
  }
  async saveActivity(input: Mutation) {
    const site = await this.scope(input.site, 'restricted-activity', 'edit'),
      v = input.values,
      name = value(v.name, 180, true),
      description = value(v.description ?? '', 6000),
      location = value(v.location ?? '', 1000),
      start = givingDate(v.startsOn),
      end = givingDate(v.endsOn),
      skills = labels(v.skills),
      state = String(v.state),
      archived = v.archived === true ? 1 : 0
    if (!['planned', 'completed', 'cancelled'].includes(state) || end < start)
      throw new Error('Choose a valid activity state and date range.')
    const action = input.id ? 'volunteer.activity.updated' : 'volunteer.activity.created',
      intent = {
        id: input.id || null,
        revision: input.expectedRevision ?? null,
        name,
        description,
        location,
        start,
        end,
        skills,
        state,
        archived,
      },
      replay = await replayCRM(this.db, this.actor, input.operationKey, {
        site: input.site,
        action,
        type: 'volunteer-activity',
        intent,
      })
    if (replay) return replay
    const before = input.id ? await this.activity(input.site, input.id) : null,
      id = input.id || crypto.randomUUID()
    if (before && !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const values = [
      name,
      description,
      location,
      start,
      end,
      JSON.stringify(skills),
      state,
      archived,
    ]
    return this.finish(
      site,
      input,
      action,
      'volunteer-activity',
      id,
      before,
      intent,
      before
        ? this.db
            .prepare(
              'UPDATE vc_crm_volunteer_activities SET name=?,description=?,location=?,starts_on=?,ends_on=?,skills=?,state=?,archived=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=?',
            )
            .bind(...values, id, input.site, input.expectedRevision!)
        : this.db
            .prepare(
              'INSERT INTO vc_crm_volunteer_activities(name,description,location,starts_on,ends_on,skills,state,archived,id,site_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(...values, id, input.site),
    )
  }
  async participate(input: Mutation) {
    const site = await this.scope(input.site, 'restricted-activity', 'edit'),
      v = input.values,
      activity = value(v.activity, 100, true),
      contact = value(v.constituent, 100, true),
      state = String(v.state),
      notes = value(v.notes ?? '', 4000)
    if (
      !volunteerParticipationStates.includes(state as (typeof volunteerParticipationStates)[number])
    )
      throw new Error('Choose a valid participation state.')
    const action = input.id ? 'volunteer.participation.updated' : 'volunteer.participation.created',
      intent = {
        id: input.id || null,
        revision: input.expectedRevision ?? null,
        activity,
        contact,
        state,
        notes,
        activityRevision: v.activityRevision ?? null,
      },
      replay = await replayCRM(this.db, this.actor, input.operationKey, {
        site: input.site,
        action,
        type: 'volunteer-participation',
        intent,
      })
    if (replay) return replay
    const a = await this.activity(input.site, activity)
    if (a.archived || a.state === 'cancelled')
      throw new Error('Choose an available volunteer activity.')
    if (a.revision !== v.activityRevision) throw new SiteConflictError()
    const before = input.id
      ? await this.db
          .prepare(
            'SELECT * FROM vc_crm_volunteer_participation WHERE id=? AND activity_id=? AND constituent_id=?',
          )
          .bind(input.id, activity, contact)
          .first<VolunteerParticipation>()
      : null
    if (input.id && !before) throw new SiteAccessError()
    if (before && !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const id = input.id || crypto.randomUUID(),
      guards = this.guards(
        `${input.operationKey}:activity`,
        'SELECT ?,count(*) FROM vc_crm_volunteer_activities WHERE id=? AND site_id=? AND revision=?',
        [activity, input.site, a.revision],
      )
    return this.finish(
      site,
      input,
      action,
      'volunteer-participation',
      id,
      before,
      intent,
      before
        ? this.db
            .prepare(
              'UPDATE vc_crm_volunteer_participation SET state=?,notes=?,revision=revision+1 WHERE id=? AND revision=?',
            )
            .bind(state, notes, id, input.expectedRevision!)
        : this.db
            .prepare(
              'INSERT INTO vc_crm_volunteer_participation(id,activity_id,constituent_id,state,notes) VALUES(?,?,?,?,?)',
            )
            .bind(id, activity, contact, state, notes),
      guards,
    )
  }
  async invitations(siteID: string, activity = '', contact = '', after = '') {
    const site = await this.scope(siteID, 'communications', 'read')
    await this.authority.require(siteID, 'restricted-activity', 'read')
    const clauses = ['a.site_id=?', 'v.id>?'],
      params: Array<string> = [siteID, after]
    if (activity) {
      clauses.push('v.activity_id=?')
      params.push(activity)
    }
    if (contact) {
      clauses.push('v.constituent_id=?')
      params.push(contact)
    }
    const rows = await this.db
        .prepare(
          `SELECT v.*,c.label,a.name AS activity_name FROM vc_crm_volunteer_invitations v JOIN vc_crm_volunteer_activities a ON a.id=v.activity_id ${contactJoin} WHERE ${clauses.join(' AND ')} ORDER BY v.id LIMIT 51`,
        )
        .bind(...params)
        .all<VolunteerInvitation>(),
      canEdit = (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    await this.fence(site)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit,
    }
  }
  async invite(input: Mutation) {
    const site = await this.scope(input.site, 'communications', 'edit')
    await this.authority.require(input.site, 'restricted-activity', 'read')
    await this.authority.require(input.site, 'volunteer-experience', 'read')
    const v = input.values,
      activity = value(v.activity, 100, true),
      contact = value(v.constituent, 100, true),
      channel = String(v.channel),
      date = givingDate(v.occurredOn),
      notes = value(v.notes ?? '', 6000)
    if (!['phone', 'email', 'letter', 'other'].includes(channel))
      throw new Error('Choose a recorded outreach channel.')
    const action = 'volunteer.invitation.recorded',
      intent = {
        activity,
        contact,
        channel,
        date,
        notes,
        profileRevision: v.profileRevision ?? null,
        activityRevision: v.activityRevision ?? null,
      },
      replay = await replayCRM(this.db, this.actor, input.operationKey, {
        site: input.site,
        action,
        type: 'volunteer-invitation',
        intent,
      })
    if (replay) return replay
    const profile = await this.profile(input.site, contact),
      a = await this.activity(input.site, activity)
    if (!profile.contact_allowed)
      throw new Error(
        'This record does not allow volunteer outreach. Retain the do-not-contact preference.',
      )
    if (profile.revision !== v.profileRevision || a.revision !== v.activityRevision)
      throw new SiteConflictError()
    if (a.archived || a.state !== 'planned') throw new Error('Choose a planned volunteer activity.')
    const id = crypto.randomUUID(),
      now = new Date().toISOString(),
      guards = [
        ...this.guards(
          `${input.operationKey}:activity`,
          'SELECT ?,count(*) FROM vc_crm_volunteer_activities WHERE id=? AND site_id=? AND revision=?',
          [activity, input.site, a.revision],
        ),
        ...this.guards(
          `${input.operationKey}:profile`,
          'SELECT ?,count(*) FROM vc_crm_volunteer_profiles WHERE site_id=? AND constituent_id=? AND revision=?',
          [input.site, contact, profile.revision],
        ),
      ]
    return this.finish(
      site,
      input,
      action,
      'volunteer-invitation',
      id,
      null,
      intent,
      this.db
        .prepare(
          'INSERT INTO vc_crm_volunteer_invitations(id,activity_id,constituent_id,channel,occurred_on,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(id, activity, contact, channel, date, notes, this.actor, now),
      guards,
    )
  }
  async respond(input: Mutation) {
    const site = await this.scope(input.site, 'communications', 'edit')
    await this.authority.require(input.site, 'restricted-activity', 'read')
    const v = input.values,
      response = String(v.response),
      date = givingDate(v.respondedOn),
      notes = value(v.notes ?? '', 6000)
    if (!['accepted', 'declined', 'withdrawn'].includes(response))
      throw new Error('Choose an accepted, declined or withdrawn invitation response.')
    if (!input.id || !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const action = 'volunteer.invitation.response',
      intent = { id: input.id, revision: input.expectedRevision, response, date, notes },
      replay = await replayCRM(this.db, this.actor, input.operationKey, {
        site: input.site,
        action,
        type: 'volunteer-invitation',
        intent,
      })
    if (replay) return replay
    const before = await this.db
      .prepare(
        `SELECT v.*,c.label,a.name AS activity_name FROM vc_crm_volunteer_invitations v JOIN vc_crm_volunteer_activities a ON a.id=v.activity_id ${contactJoin} WHERE a.site_id=? AND v.id=?`,
      )
      .bind(input.site, input.id)
      .first<VolunteerInvitation>()
    if (!before) throw new SiteAccessError()
    if (date < before.occurred_on) throw new Error('Choose a response date on or after outreach.')
    return this.finish(
      site,
      input,
      action,
      'volunteer-invitation',
      input.id,
      before,
      intent,
      this.db
        .prepare(
          'UPDATE vc_crm_volunteer_invitations SET response=?,responded_on=?,response_notes=?,revision=revision+1 WHERE id=? AND revision=?',
        )
        .bind(response, date, notes, input.id, input.expectedRevision!),
    )
  }
  async hours(siteID: string, activity = '', contact = '', after = '', state = 'all', id = '') {
    const site = await this.scope(siteID, 'volunteer-hours', 'read')
    await this.authority.require(siteID, 'restricted-activity', 'read')
    if (!['all', 'submitted', 'approved', 'rejected'].includes(state))
      throw new Error('Choose a valid hours status.')
    const clauses = ['a.site_id=?'],
      params: string[] = [siteID]
    if (activity) {
      clauses.push('v.activity_id=?')
      params.push(activity)
    }
    if (contact) {
      clauses.push('v.constituent_id=?')
      params.push(contact)
    }
    if (state !== 'all') {
      clauses.push('v.state=?')
      params.push(state)
    }
    if (id) {
      clauses.push('v.id=?')
      params.push(id)
    }
    const where = clauses.join(' AND '),
      rows = await this.db
        .prepare(
          `SELECT v.*,c.label,a.name AS activity_name FROM vc_crm_volunteer_hours v JOIN vc_crm_volunteer_activities a ON a.id=v.activity_id ${contactJoin} WHERE ${where} AND v.id>? ORDER BY v.id LIMIT 51`,
        )
        .bind(...params, after)
        .all<VolunteerHours>()
    const totals = (
      await this.db
        .prepare(
          `SELECT v.state,count(*) AS records,CAST(sum(v.minutes) AS TEXT) AS minutes FROM vc_crm_volunteer_hours v JOIN vc_crm_volunteer_activities a ON a.id=v.activity_id ${contactJoin} WHERE ${where} GROUP BY v.state`,
        )
        .bind(...params)
        .all<{ state: string; records: number; minutes: string }>()
    ).results
    const canEdit = (await this.authority.authority(siteID, 'volunteer-hours', 'edit')).allowed
    await this.fence(site)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      totals,
      canEdit,
    }
  }
  async submitHours(input: Mutation) {
    const site = await this.scope(input.site, 'volunteer-hours', 'edit')
    await this.authority.require(input.site, 'restricted-activity', 'read')
    const v = input.values,
      activity = value(v.activity, 100, true),
      contact = value(v.constituent, 100, true),
      date = givingDate(v.occurredOn),
      minutes = Number(v.minutes)
    if (
      typeof v.minutes !== 'number' ||
      !Number.isSafeInteger(minutes) ||
      minutes < 1 ||
      minutes > 1440
    )
      throw new Error('Enter one to 1,440 whole minutes for a day.')
    const action = 'volunteer.hours.submitted',
      intent = { activity, contact, date, minutes },
      replay = await replayCRM(this.db, this.actor, input.operationKey, {
        site: input.site,
        action,
        type: 'volunteer-hours',
        intent,
      })
    if (replay) return replay
    await this.activity(input.site, activity)
    const id = crypto.randomUUID()
    return this.finish(
      site,
      input,
      action,
      'volunteer-hours',
      id,
      null,
      intent,
      this.db
        .prepare(
          'INSERT INTO vc_crm_volunteer_hours(id,activity_id,constituent_id,occurred_on,minutes,created_by,created_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(id, activity, contact, date, minutes, this.actor, new Date().toISOString()),
    )
  }
  async reviewHours(input: Mutation) {
    const site = await this.scope(input.site, 'volunteer-hours', 'edit')
    await this.authority.require(input.site, 'restricted-activity', 'read')
    const state = String(input.values.state),
      reason = value(input.values.reason, 2000, true)
    if (!['approved', 'rejected'].includes(state))
      throw new Error('Choose approved or rejected hours.')
    if (!input.id || !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const action = 'volunteer.hours.reviewed',
      intent = { id: input.id, revision: input.expectedRevision, state, reason },
      replay = await replayCRM(this.db, this.actor, input.operationKey, {
        site: input.site,
        action,
        type: 'volunteer-hours',
        intent,
      })
    if (replay) return replay
    const before = await this.db
      .prepare(
        `SELECT v.*,c.label,a.name AS activity_name FROM vc_crm_volunteer_hours v JOIN vc_crm_volunteer_activities a ON a.id=v.activity_id ${contactJoin} WHERE a.site_id=? AND v.id=?`,
      )
      .bind(input.site, input.id)
      .first<VolunteerHours>()
    if (!before) throw new SiteAccessError()
    return this.finish(
      site,
      input,
      action,
      'volunteer-hours',
      input.id,
      before,
      intent,
      this.db
        .prepare(
          'UPDATE vc_crm_volunteer_hours SET state=?,review_reason=?,reviewed_by=?,reviewed_at=?,revision=revision+1 WHERE id=? AND revision=?',
        )
        .bind(
          state,
          reason,
          this.actor,
          new Date().toISOString(),
          input.id,
          input.expectedRevision!,
        ),
    )
  }
}
