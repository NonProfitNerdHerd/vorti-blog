import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { emailSettings, type EmailSettings } from './email-model'
import { EmailProviderError, ResendEmailProvider, type EmailRuntime } from './email-provider'
import { commitCRM, replayCRM } from './mutations'
interface SettingsRow {
  site_id: string
  provider: 'disabled' | 'resend'
  sender_email: string
  sender_name: string
  reply_to: string
  domain_id: string
  enabled: number
  revision: number
  verified_at: string | null
  credential_fingerprint: string | null
}
const settingsValue = (row: SettingsRow | null): EmailSettings =>
  row
    ? {
        provider: row.provider,
        senderEmail: row.sender_email,
        senderName: row.sender_name,
        replyTo: row.reply_to,
        domainID: row.domain_id,
        enabled: !!row.enabled,
      }
    : {
        provider: 'disabled',
        senderEmail: '',
        senderName: '',
        replyTo: '',
        domainID: '',
        enabled: false,
      }
export class EmailConfiguration {
  private authority: OrganizationRepository
  private provider: ResendEmailProvider
  constructor(
    private db: D1Database,
    private actor: number,
    private runtime: EmailRuntime,
    transport?: typeof fetch,
  ) {
    this.authority = new OrganizationRepository(db, actor)
    this.provider = new ResendEmailProvider(runtime, transport)
  }
  private row(site: string) {
    return this.db
      .prepare('SELECT * FROM vc_crm_email_settings WHERE site_id=?')
      .bind(site)
      .first<SettingsRow>()
  }
  private async credentialFingerprint() {
    if (!this.provider.configured) return null
    return Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.runtime.apiKey!)),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
  }
  async get(siteID: string) {
    const site = await this.authority.require(siteID, 'communications', 'configure')
    const row = await this.row(siteID),
      hash = await this.credentialFingerprint()
    const verified = !!row?.verified_at && !!hash && row.credential_fingerprint === hash
    const current = await this.authority.require(siteID, 'communications', 'configure')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return {
      values: settingsValue(row),
      revision: row?.revision || 0,
      verified,
      verifiedAt: verified ? row?.verified_at : null,
      credentialsConfigured: this.provider.configured,
      liveEnvironmentEnabled: this.provider.canSend,
      ready: !!row?.enabled && row.provider === 'resend' && verified && this.provider.canSend,
    }
  }
  async forDelivery(siteID: string) {
    const site = await this.authority.require(siteID, 'communications', 'edit')
    const row = await this.row(siteID),
      hash = await this.credentialFingerprint()
    if (
      !row ||
      row.provider !== 'resend' ||
      !row.enabled ||
      !row.verified_at ||
      !hash ||
      row.credential_fingerprint !== hash ||
      !this.provider.canSend
    )
      throw new EmailProviderError('unconfigured')
    const current = await this.authority.require(siteID, 'communications', 'edit')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return { values: settingsValue(row), revision: row.revision }
  }
  async save(input: {
    site: string
    expectedRevision: number
    operationKey: string
    values: Record<string, unknown>
  }) {
    const site = await this.authority.require(input.site, 'communications', 'configure')
    const values = emailSettings(input.values),
      intent = { expectedRevision: input.expectedRevision, values }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'email.settings.updated',
      type: 'email-settings',
      intent,
    })
    if (replay) return replay
    const before = await this.row(input.site)
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision !== (before?.revision || 0)
    )
      throw new SiteConflictError()
    const hash = await this.credentialFingerprint()
    const verified =
      !!before?.verified_at &&
      !!hash &&
      before.credential_fingerprint === hash &&
      before.provider === values.provider &&
      before.sender_email === values.senderEmail &&
      before.domain_id === values.domainID
    if (values.enabled && (values.provider !== 'resend' || !verified || !this.provider.canSend))
      throw new Error(
        'Use verified sender settings and an enabled production email environment before enabling delivery.',
      )
    const now = new Date().toISOString(),
      revision = input.expectedRevision + 1
    const write = before
      ? this.db
          .prepare(
            'UPDATE vc_crm_email_settings SET provider=?,sender_email=?,sender_name=?,reply_to=?,domain_id=?,enabled=?,verified_at=?,credential_fingerprint=?,revision=revision+1,updated_at=? WHERE site_id=? AND revision=?',
          )
          .bind(
            values.provider,
            values.senderEmail,
            values.senderName,
            values.replyTo,
            values.domainID,
            values.enabled ? 1 : 0,
            verified ? before.verified_at : null,
            verified ? hash : null,
            now,
            input.site,
            input.expectedRevision,
          )
      : this.db
          .prepare(
            'INSERT INTO vc_crm_email_settings(site_id,provider,sender_email,sender_name,reply_to,domain_id,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(site_id) DO NOTHING',
          )
          .bind(
            input.site,
            values.provider,
            values.senderEmail,
            values.senderName,
            values.replyTo,
            values.domainID,
            0,
            now,
            now,
          )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'email.settings.updated',
      type: 'email-settings',
      id: input.site,
      before: before ? settingsValue(before) : null,
      after: values,
      intent,
      write,
      result: { revision },
    })
  }
  async verify(input: { site: string; expectedRevision: number; operationKey: string }) {
    const site = await this.authority.require(input.site, 'communications', 'configure'),
      intent = { expectedRevision: input.expectedRevision }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'email.settings.verified',
      type: 'email-settings',
      intent,
    })
    if (replay) return replay
    const row = await this.row(input.site)
    if (!row || row.provider !== 'resend')
      throw new Error('Choose saved sender settings before verification.')
    if (!Number.isSafeInteger(input.expectedRevision) || row.revision !== input.expectedRevision)
      throw new SiteConflictError()
    await this.provider.verifyDomain(row.domain_id, row.sender_email)
    const hash = await this.credentialFingerprint()
    if (!hash) throw new Error('Use configured provider credentials before verification.')
    const now = new Date().toISOString()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'email.settings.verified',
      type: 'email-settings',
      id: input.site,
      after: { verified: true },
      intent,
      write: this.db
        .prepare(
          'UPDATE vc_crm_email_settings SET verified_at=?,credential_fingerprint=?,enabled=?,revision=revision+1,updated_at=? WHERE site_id=? AND revision=?',
        )
        .bind(
          now,
          hash,
          this.provider.canSend ? row.enabled : 0,
          now,
          input.site,
          input.expectedRevision,
        ),
      result: { revision: input.expectedRevision + 1 },
    })
  }
}
