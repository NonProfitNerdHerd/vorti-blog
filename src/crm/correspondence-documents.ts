import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { contactDocumentSnapshot, type DocumentRequest } from './correspondence-snapshot'
import { mergeCorrespondence, printableCorrespondence } from './correspondence-model'
import { commitCRM, replayCRM } from './mutations'
import { ContactRepository } from './contacts'
import { documentAmount } from './correspondence-giving'
import { CRMJobs } from './jobs'

async function fingerprint(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}
interface IssuedDocument {
  id: string
  site_id: string
  constituent_id: string
  template_version_id: string
  actor_id: number
  kind: string
  financial: number
  membership: number
  subject: string
  body: string
  snapshot: string
  issued_on: string
  created_at: string
  supersedes_id: string | null
}
export class CorrespondenceDocuments {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  async preview(input: DocumentRequest & { supersedes?: string }) {
    const snapshot = await contactDocumentSnapshot(this.db, this.actor, input)
    const prior = input.supersedes ? await this.get(input.site, input.supersedes) : null
    if (
      prior &&
      (prior.constituent_id !== input.contact ||
        prior.kind !== snapshot.template.kind ||
        !!prior.financial !== snapshot.financial ||
        !!prior.membership !== !!snapshot.membership)
    )
      throw new Error(
        'Choose a corrected document with the same recipient, type and information access.',
      )
    const notice = prior
      ? `\n\nThis document supersedes document ${prior.id}. Refer to this version in place of the earlier document.`
      : ''
    const reviewed = {
      ...snapshot,
      body: snapshot.body + notice,
      requiredAppendix: snapshot.requiredAppendix + notice,
      supersedes: prior?.id || null,
    }
    return { snapshot: reviewed, approval: await fingerprint(reviewed) }
  }
  async generation(siteID: string, id: string) {
    await this.get(siteID, id)
    const job = await this.db
      .prepare(
        "SELECT id,status,progress,attempts,fence,error,actor_id FROM vc_crm_jobs WHERE site_id=? AND kind='correspondence' AND json_extract(payload,'$.document')=? ORDER BY created_at DESC,id DESC LIMIT 1",
      )
      .bind(siteID, id)
      .first<{
        id: string
        status: string
        progress: number
        attempts: number
        fence: number
        error: string | null
        actor_id: number
      }>()
    const file = await this.db
      .prepare('SELECT document_id FROM vc_crm_document_files WHERE document_id=?')
      .bind(id)
      .first()
    const editable = (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    await this.get(siteID, id)
    return {
      ready: !!file,
      job: job
        ? {
            id: job.id,
            status: job.status,
            progress: job.progress,
            attempts: job.attempts,
            fence: job.fence,
            error: job.error,
            canManage: editable && job.actor_id === this.actor,
          }
        : null,
    }
  }
  async controlGeneration(input: {
    site: string
    document: string
    job: string
    expectedFence: number
    action: 'retry' | 'cancel'
    operationKey: string
  }) {
    await this.get(input.site, input.document)
    await this.authority.require(input.site, 'communications', 'edit')
    const job = await this.db
      .prepare(
        "SELECT id FROM vc_crm_jobs WHERE id=? AND site_id=? AND actor_id=? AND kind='correspondence' AND json_extract(payload,'$.document')=?",
      )
      .bind(input.job, input.site, this.actor, input.document)
      .first()
    if (!job) throw new SiteAccessError()
    const jobs = new CRMJobs(this.db)
    if (input.action === 'retry')
      return jobs.retry(this.actor, input.site, input.job, input.expectedFence, input.operationKey)
    return jobs.cancel(this.actor, input.site, input.job, input.operationKey, input.expectedFence)
  }
  async sources(siteID: string, contact: string, kind: string, after = '') {
    const site = await this.authority.require(siteID, 'communications', 'edit')
    await new ContactRepository(this.db, this.actor).get(siteID, contact)
    let docs: { id: string; label: string }[]
    if (kind === 'gifts') {
      await this.authority.require(siteID, 'finances', 'read')
      const rows = await this.db
        .prepare(
          'SELECT id,received_on,currency,exponent,net_minor,kind,state FROM vc_crm_gifts WHERE site_id=? AND constituent_id=? AND id>? ORDER BY id LIMIT 51',
        )
        .bind(siteID, contact, after)
        .all<{
          id: string
          received_on: string
          currency: string
          exponent: number
          net_minor: string
          kind: string
          state: string
        }>()
      docs = rows.results.map((row) => ({
        id: row.id,
        label: `${row.received_on} · ${row.kind} · ${row.state} · ${row.kind === 'in-kind' ? 'No cash valuation' : documentAmount(row.net_minor, row.currency, row.exponent)} · ${row.id}`,
      }))
    } else if (kind === 'memberships') {
      await this.authority.require(siteID, 'memberships', 'read')
      const rows = await this.db
        .prepare(
          'SELECT id,type_name,starts_on,ends_on,cancelled_on FROM vc_crm_membership_terms WHERE site_id=? AND billing_contact_id=? AND id>? ORDER BY id LIMIT 51',
        )
        .bind(siteID, contact, after)
        .all<{
          id: string
          type_name: string
          starts_on: string
          ends_on: string
          cancelled_on: string | null
        }>()
      docs = rows.results.map((row) => ({
        id: row.id,
        label: `${row.type_name} · ${row.starts_on}–${row.ends_on}${row.cancelled_on ? ` · cancelled ${row.cancelled_on}` : ''}`,
      }))
    } else throw new Error('Choose gifts or memberships for document sources.')
    const current = await this.authority.require(siteID, 'communications', 'edit')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return { docs: docs.slice(0, 50), next: docs.length > 50 ? docs[49].id : null }
  }
  async issue(
    input: DocumentRequest & { approval: string; operationKey: string; supersedes?: string },
  ) {
    const site = await this.authority.require(input.site, 'communications', 'edit')
    await this.authority.require(input.site, 'identity', 'read')
    // Re-authorize the request before considering a retry result that may contain private references.
    if (input.gift) await this.authority.require(input.site, 'finances', 'read')
    const intent = {
      contact: input.contact,
      template: input.template,
      issuedOn: input.issuedOn,
      issuerName: input.issuerName,
      issuerAddress: input.issuerAddress,
      gift: input.gift || null,
      year: input.year ?? null,
      membership: input.membership || null,
      approval: input.approval,
      supersedes: input.supersedes || null,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'document.issued',
      type: 'correspondence-document',
      intent,
    })
    if (replay) {
      await this.get(input.site, String(replay.id))
      return replay
    }
    const { snapshot, approval } = await this.preview(input)
    if (approval !== input.approval || snapshot.authorityRevision !== site.authorityRevision)
      throw new SiteConflictError()
    if (input.supersedes) {
      const prior = await this.get(input.site, input.supersedes)
      if (
        prior.constituent_id !== input.contact ||
        prior.kind !== snapshot.template.kind ||
        !!prior.financial !== snapshot.financial ||
        !!prior.membership !== !!snapshot.membership
      )
        throw new Error(
          'Choose a corrected document with the same recipient, type and information access.',
        )
    }
    const version = await this.db
      .prepare('SELECT subject,body FROM vc_crm_template_versions WHERE id=?')
      .bind(snapshot.template.version)
      .first<{ subject: string; body: string }>()
    if (!version) throw new SiteConflictError()
    const id = crypto.randomUUID(),
      job = crypto.randomUUID(),
      now = new Date().toISOString(),
      values = { ...snapshot.values, 'document.number': id }
    const subject = mergeCorrespondence(version.subject, values)
    const body = mergeCorrespondence(version.body, values) + snapshot.requiredAppendix
    const issued = { ...snapshot, number: id, subject, body, values }
    const guards: D1PreparedStatement[] = []
    const guard = (suffix: string, sql: string, params: (string | number)[]) => {
      guards.push(
        this.db
          .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
          .bind(`${input.operationKey}:${suffix}`, ...params),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:${suffix}`),
      )
    }
    guard(
      'recipient',
      'SELECT ?,count(*) FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE c.id=? AND c.revision=? AND c.archived=0 AND a.site_id=? AND a.revision=? AND a.archived=0',
      [input.contact, snapshot.contactRevision, input.site, snapshot.affiliationRevision],
    )
    guard(
      'template',
      'SELECT ?,count(*) FROM vc_crm_templates WHERE id=? AND site_id=? AND revision=? AND archived=0',
      [input.template, input.site, snapshot.template.revision],
    )
    if (snapshot.gift)
      guard(
        'gift',
        'SELECT ?,count(*) FROM vc_crm_gifts WHERE id=? AND site_id=? AND constituent_id=? AND revision=?',
        [snapshot.gift.id, input.site, input.contact, snapshot.gift.revision],
      )
    if (snapshot.year !== null) {
      guard(
        'annual-count',
        'SELECT ?,CASE WHEN count(*)=? THEN 1 ELSE 0 END FROM vc_crm_gifts WHERE site_id=? AND constituent_id=? AND received_on>=? AND received_on<?',
        [
          snapshot.annual.length,
          input.site,
          input.contact,
          `${snapshot.year}-01-01`,
          `${snapshot.year + 1}-01-01`,
        ],
      )
      for (let offset = 0; offset < snapshot.annual.length; offset += 100) {
        const chunk = snapshot.annual.slice(offset, offset + 100)
        guard(
          `annual-${offset}`,
          "SELECT ?,CASE WHEN count(*)=? THEN 1 ELSE 0 END FROM json_each(?) e JOIN vc_crm_gifts g ON g.id=json_extract(e.value,'$.id') AND g.revision=json_extract(e.value,'$.revision') WHERE g.site_id=? AND g.constituent_id=?",
          [
            chunk.length,
            JSON.stringify(chunk.map((gift) => ({ id: gift.id, revision: gift.revision }))),
            input.site,
            input.contact,
          ],
        )
      }
    }
    if (snapshot.membership)
      guard(
        'membership',
        'SELECT ?,count(*) FROM vc_crm_membership_terms WHERE id=? AND site_id=? AND billing_contact_id=? AND revision=?',
        [snapshot.membership.id, input.site, input.contact, snapshot.membership.revision],
      )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'document.issued',
      type: 'correspondence-document',
      id,
      intent,
      after: {
        id,
        constituent: input.contact,
        templateVersion: snapshot.template.version,
        supersedes: input.supersedes || null,
      },
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_documents(id,site_id,constituent_id,template_version_id,actor_id,kind,financial,membership,subject,body,snapshot,issued_on,created_at,supersedes_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          input.site,
          input.contact,
          snapshot.template.version,
          this.actor,
          snapshot.template.kind,
          snapshot.financial ? 1 : 0,
          snapshot.membership ? 1 : 0,
          subject,
          body,
          JSON.stringify(issued),
          snapshot.issuedOn,
          now,
          input.supersedes || null,
        ),
      dependent: [
        ...guards,
        this.db
          .prepare(
            "INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'correspondence',?,?,?,?)",
          )
          .bind(job, input.site, this.actor, JSON.stringify({ document: id }), now, now, now),
      ],
      result: { id, job },
    })
  }
  async get(siteID: string, id: string) {
    const site = await this.authority.require(siteID, 'communications', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    const document = await this.db
      .prepare(
        `SELECT d.* FROM vc_crm_documents d JOIN vc_crm_affiliations a ON a.site_id=d.site_id AND a.constituent_id=d.constituent_id AND a.archived=0 JOIN vc_crm_constituents c ON c.id=d.constituent_id AND c.archived=0 WHERE d.id=? AND d.site_id=?`,
      )
      .bind(id, siteID)
      .first<IssuedDocument>()
    if (!document) throw new SiteAccessError()
    if (document.financial) await this.authority.require(siteID, 'finances', 'read')
    if (document.membership) await this.authority.require(siteID, 'memberships', 'read')
    const current = await this.authority.require(siteID, 'communications', 'read')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return document
  }
  async list(siteID: string, contact = '', beforeDate = '', beforeID = '') {
    const site = await this.authority.require(siteID, 'communications', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    const finance = (await this.authority.authority(siteID, 'finances', 'read')).allowed
    const membership = (await this.authority.authority(siteID, 'memberships', 'read')).allowed
    const canIssue = (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    if (contact) await new ContactRepository(this.db, this.actor).get(siteID, contact)
    if (
      !!beforeDate !== !!beforeID ||
      (beforeDate && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(beforeDate))
    )
      throw new Error('Invalid page cursor.')
    const rows = await this.db
      .prepare(
        `SELECT d.id,d.constituent_id,c.label AS recipient,d.kind,d.subject,d.issued_on,d.created_at,d.supersedes_id,
      (SELECT n.id FROM vc_crm_documents n WHERE n.supersedes_id=d.id) AS superseded_by,
      EXISTS(SELECT 1 FROM vc_crm_document_files f WHERE f.document_id=d.id) AS pdf_ready
      FROM vc_crm_documents d JOIN vc_crm_constituents c ON c.id=d.constituent_id AND c.archived=0
      JOIN vc_crm_affiliations a ON a.constituent_id=d.constituent_id AND a.site_id=d.site_id AND a.archived=0
      WHERE d.site_id=? AND (d.financial=0 OR ?=1) AND (d.membership=0 OR ?=1)
      AND (?='' OR d.constituent_id=?) AND (?='' OR d.created_at<? OR (d.created_at=? AND d.id<?))
      ORDER BY d.created_at DESC,d.id DESC LIMIT 51`,
      )
      .bind(
        siteID,
        finance ? 1 : 0,
        membership ? 1 : 0,
        contact,
        contact,
        beforeDate,
        beforeDate,
        beforeDate,
        beforeID,
      )
      .all<{
        id: string
        constituent_id: string
        recipient: string
        kind: string
        subject: string
        issued_on: string
        created_at: string
        supersedes_id: string | null
        superseded_by: string | null
        pdf_ready: number
      }>()
    const current = await this.authority.require(siteID, 'communications', 'read')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return {
      docs: rows.results.slice(0, 50),
      next:
        rows.results.length > 50
          ? { date: rows.results[49].created_at, id: rows.results[49].id }
          : null,
      canIssue,
    }
  }
  async printable(site: string, id: string) {
    const doc = await this.get(site, id)
    const snapshot = JSON.parse(doc.snapshot) as { issuer: { name: string; address: string } }
    return printableCorrespondence({
      subject: doc.subject,
      body: doc.body,
      issuer: [snapshot.issuer.name, snapshot.issuer.address].filter(Boolean).join(' · '),
      number: doc.id,
      issuedOn: doc.issued_on,
    })
  }
}
