import { APIError, createLocalReq, type Config } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { cmsDatabase } from './cms-scope'
import { InvitationRepository } from './invitations'
import { INVITED_ACCOUNT } from './invitation-context'
import { AUTHORITY_MUTATION_COMMITTED } from './authority-plugin'
import { errorResponse } from '../crm/plugin'

export const tenantInvitations = (config: Config): Config => ({
  ...config,
  endpoints: [
    ...(config.endpoints || []),
    {
      path: '/tenant-invitations/accept',
      method: 'post',
      handler: async (req) => {
        try {
          if (req.headers.get('origin') !== new URL(req.url!).origin)
            throw new APIError('Use this site to accept an invitation.', 403)
          const body = await readBoundedJSON(req, 4000),
            db = cmsDatabase(req),
            repo = new InvitationRepository(db)
          const token = typeof body.token === 'string' ? body.token : '',
            invitation = await repo.inspect(token)
          const existing = await db
            .prepare('SELECT id FROM users WHERE lower(trim(email))=?')
            .bind(invitation.email)
            .first<{ id: number }>()
          let user = existing?.id
          if (existing) {
            if (Number(req.user?.id) !== existing.id)
              throw new APIError(
                'Sign in with the invited account, then reopen this invitation. Its password will not be changed.',
                403,
              )
          } else {
            if (req.user)
              throw new APIError('Sign out before creating a different invited account.', 403)
            if (
              typeof body.password !== 'string' ||
              body.password.length < 12 ||
              body.password.length > 128
            )
              throw new APIError('Choose a password from 12 to 128 characters.', 400)
            const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
            if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new APIError('Choose a username with 3–32 letters, numbers, dots, underscores, or hyphens.', 400)
            const scoped = await createLocalReq(
              {
                context: { purpose: 'invitation-redemption', [INVITED_ACCOUNT]: invitation.email },
              },
              req.payload,
            )
            const account = await req.payload.create({
              collection: 'users',
              req: scoped,
              overrideAccess: false,
              data: { email: invitation.email, username, password: body.password, role: 'editor' },
            })
            user = account.id
          }
          const result = await repo.accept(token, user!)
          ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ],
})
