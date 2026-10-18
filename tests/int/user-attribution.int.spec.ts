import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { userIdentity, publicAuthorIdentity } from '@design-system/payload-design-core'
import { publicAuthors } from '@/lib/public-attribution'
import { getPublicAuthorProfile } from '@/lib/publicContent'
import type { User } from '@/payload-types'

describe('Usernames and consistent attribution', () => {
  let payload: Payload, owner: User, other: User, admin: PayloadRequest, req: PayloadRequest
  const suffix = Date.now().toString()
  const password = 'local-identity-test-password'
  const username = `writer-${suffix}`
  beforeAll(async () => {
    payload = await getPayload({ config })
    const administrator = await payload.findByID({ collection: 'users', id: 1, depth: 0 })
    admin = await createLocalReq({ user: { ...administrator, collection: 'users' } }, payload)
    owner = await payload.create({
      collection: 'users',
      req: admin,
      overrideAccess: false,
      data: {
        email: `${username}@example.invalid`,
        username: ` WRITER-${suffix} `,
        password,
        role: 'editor',
        displayName: `Old name ${suffix}`,
        profilePublic: false,
      },
    })
    other = await payload.create({
      collection: 'users',
      data: {
        username: `other-${suffix}`,
        email: `other-${suffix}@example.invalid`,
        password,
        role: 'designer',
      },
    })
    req = await createLocalReq({ user: { ...owner, collection: 'users' } }, payload)
  })
  it('normalizes unique usernames, defaults new attribution and supports both native logins', async () => {
    expect(owner.username).toBe(username)
    expect(owner.attributionPreference).toBe('username')
    expect(owner.attributionLabel).toBe(username)
    expect(owner.slug).toBe(username)
    for (const credentials of [{ email: owner.email }, { username: username.toUpperCase() }]) {
      expect(
        (await payload.login({ collection: 'users', data: { ...credentials, password } })).user.id,
      ).toBe(owner.id)
    }
    await expect(
      payload.create({
        collection: 'users',
        data: {
          email: `duplicate-${suffix}@example.invalid`,
          username: username.toUpperCase(),
          password,
        },
      }),
    ).rejects.toThrow()
    for (const invalid of ['', 'ab', 'has space', 'name@example.com', 'x'.repeat(33)]) {
      await expect(
        payload.update({ collection: 'users', id: owner.id, data: { username: invalid } }),
      ).rejects.toThrow()
    }
    await expect(
      payload.create({
        collection: 'users',
        data: { email: `missing-${suffix}@example.invalid`, password },
      }),
    ).rejects.toThrow()
  })
  it('retains existing email login, sessions and legacy attribution during unrelated edits', async () => {
    const legacy = await payload.findByID({ collection: 'users', id: 1, depth: 0 })
    expect(legacy.attributionPreference).toBeFalsy()
    expect(
      (
        await payload.login({
          collection: 'users',
          data: { email: 'dev@payloadcms.com', password: 'test' },
        })
      ).user.id,
    ).toBe(1)
    const changed = await payload.update({
      collection: 'users',
      id: 1,
      data: { biography: legacy.biography },
    })
    expect(changed.attributionPreference).toBeFalsy()
    expect(changed.username).toBeFalsy()
    expect(changed.attributionLabel).toBe(legacy.email)
    expect(userIdentity({ displayName: 'Legacy', email: 'private@example.com' })).toBe('Legacy')
    expect(
      publicAuthorIdentity({
        displayName: 'Legacy',
        email: 'private@example.com',
        profilePublic: false,
      }),
    ).toBe('')
  })
  it('keeps email recovery and chooses distinct stable profile slugs for punctuation variants', async () => {
    const sendEmail = vi.spyOn(payload.email, 'sendEmail').mockResolvedValue(undefined)
    try {
      await payload.forgotPassword({ collection: 'users', data: { email: owner.email } })
      expect(sendEmail).toHaveBeenCalledOnce()
    } finally {
      sendEmail.mockRestore()
    }
    const first = await payload.create({
      collection: 'users',
      data: { username: `slug_${suffix}`, email: `slug-a-${suffix}@example.invalid`, password },
    })
    const second = await payload.create({
      collection: 'users',
      data: { username: `slug-${suffix}`, email: `slug-b-${suffix}@example.invalid`, password },
    })
    expect(first.slug).not.toBe(second.slug)
  })
  it('allows self-service identity changes while protecting other accounts and roles', async () => {
    await expect(
      payload.update({
        collection: 'users',
        id: other.id,
        req,
        overrideAccess: false,
        data: { attributionPreference: 'email' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'users',
        req,
        overrideAccess: false,
        data: { username: `forged-${suffix}`, email: `forged-${suffix}@example.invalid`, password },
      }),
    ).rejects.toThrow()
    const updated = await payload.update({
      collection: 'users',
      id: owner.id,
      req,
      overrideAccess: false,
      data: {
        role: 'administrator',
        attributionLabel: 'Forged label',
        username: `${username}-a`,
        attributionPreference: 'username',
      },
    })
    expect(updated.role).toBe('editor')
    expect(updated.attributionLabel).toBe(`${username}-a`)
    expect(updated.slug).toBe(owner.slug)
    await expect(
      payload.update({
        collection: 'users',
        id: owner.id,
        req,
        overrideAccess: false,
        data: { attributionPreference: null },
      }),
    ).rejects.toThrow()
    expect(
      (
        await payload.update({
          collection: 'users',
          id: other.id,
          req: admin,
          overrideAccess: false,
          data: { attributionPreference: 'email' },
        })
      ).attributionLabel,
    ).toBe(other.email)
  })
  it('defaults post authors and updates old bylines without changing the post or exposing an unselected email', async () => {
    const session = await payload.login({
      collection: 'users',
      data: { email: owner.email, password },
    })
    const post = await payload.create({
      collection: 'posts',
      req,
      overrideAccess: false,
      data: {
        author: undefined as unknown as number,
        title: 'Identity test',
        slug: `identity-${suffix}`,
        _status: 'published',
        contentLayout: { version: 1, nodes: [] },
      },
    })
    expect(typeof post.author === 'object' ? post.author.id : post.author).toBe(owner.id)
    const before = await payload.findByID({ collection: 'posts', id: post.id, depth: 0 })
    const named = (await publicAuthors(payload, [owner.id])).get(owner.id)!
    expect(publicAuthorIdentity(named)).toBe(`${username}-a`)
    expect(JSON.stringify(named)).not.toContain(owner.email)
    expect(await getPublicAuthorProfile(owner.slug!)).toBeNull()
    await payload.update({
      collection: 'users',
      id: owner.id,
      req,
      overrideAccess: false,
      data: { attributionPreference: 'email' },
    })
    expect(
      (await payload.auth({ headers: new Headers({ Authorization: `JWT ${session.token}` }) })).user
        ?.id,
    ).toBe(owner.id)
    const email = (await publicAuthors(payload, [owner.id])).get(owner.id)!
    expect(publicAuthorIdentity(email)).toBe(owner.email)
    const after = await payload.findByID({ collection: 'posts', id: post.id, depth: 0 })
    expect(after.author).toBe(before.author)
    expect(after.updatedAt).toBe(before.updatedAt)
    const published = await payload.update({
      collection: 'users',
      id: owner.id,
      req,
      overrideAccess: false,
      data: { profilePublic: true },
    })
    const profile = await getPublicAuthorProfile(published.slug!)
    expect(profile?.displayName).toBe(owner.email)
    expect(profile).not.toHaveProperty('email')
    expect(profile).not.toHaveProperty('username')
    const newEmail = `new-${suffix}@example.invalid`
    await payload.update({
      collection: 'users',
      id: owner.id,
      req,
      overrideAccess: false,
      data: { email: newEmail },
    })
    expect(publicAuthorIdentity((await publicAuthors(payload, [owner.id])).get(owner.id))).toBe(
      newEmail,
    )
  })
})
