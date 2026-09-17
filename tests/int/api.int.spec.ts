import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { getPublicAuthorProfile, getPublicSiteData } from '@/lib/publicContent'
import { getPublishedPage, getPublishedPost, getPublishedPosts } from '@/lib/frontend'

import { describe, it, beforeAll, expect } from 'vitest'

let payload: Payload

describe('API', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
  })

  it('fetches users', async () => {
    const users = await payload.find({
      collection: 'users',
    })
    expect(users).toBeDefined()
  })

  it('publishes only opted-in author profile fields', async () => {
    const user = await payload.create({
      collection: 'users',
      data: {
        email: 'public-author-validation@example.invalid',
        password: 'local-validation-password',
        displayName: 'Public Author Validation',
        shortBio: 'A public biography.',
        profilePublic: true,
      },
    })

    try {
      const profile = await getPublicAuthorProfile('public-author-validation')
      expect(profile?.displayName).toBe('Public Author Validation')
      expect(profile?.shortBio).toBe('A public biography.')
      expect(JSON.stringify(profile)).not.toMatch(/email|password|hash|salt|session|token/i)

      await payload.update({
        collection: 'users',
        id: user.id,
        data: { profilePublic: false },
      })
      expect(await getPublicAuthorProfile('public-author-validation')).toBeNull()
    } finally {
      await payload.delete({ collection: 'users', id: user.id })
    }
  })

  it('manages categories and tags independently with generated slugs', async () => {
    const category = await payload.create({
      collection: 'categories',
      data: { name: 'Storm Chasing', slug: '' },
    })
    const tag = await payload.create({
      collection: 'tags',
      data: { name: 'Cloudflare', slug: '' },
    })

    try {
      expect(category.slug).toBe('storm-chasing')
      expect(tag.slug).toBe('cloudflare')
      expect((await payload.find({ collection: 'categories' })).docs).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: category.id })]),
      )
      expect((await payload.find({ collection: 'tags' })).docs).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: tag.id })]),
      )
    } finally {
      await payload.delete({ collection: 'categories', id: category.id })
      await payload.delete({ collection: 'tags', id: tag.id })
    }
  })

  it('provides public navigation and site settings from Payload', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { siteName: 'Vorti' },
    })
    await payload.updateGlobal({
      slug: 'navigation',
      data: {
        primary: [
          {
            label: 'VortiQuest',
            linkType: 'external',
            url: 'https://vorti.quest',
            enabled: true,
          },
        ],
        footer: [],
      },
    })

    const { navigation, siteSettings } = await getPublicSiteData()
    expect(siteSettings.siteName).toBe('Vorti')
    expect(navigation.primary?.[0]?.label).toBe('VortiQuest')
  })

  it('hides draft pages from anonymous readers and shows published pages', async () => {
    const page = await payload.create({
      collection: 'pages',
      draft: true,
      data: {
        title: 'Access Validation Page',
        content: {
          root: {
            type: 'root',
            format: '',
            indent: 0,
            version: 1,
            direction: 'ltr',
            children: [
              {
                type: 'paragraph',
                format: '',
                indent: 0,
                version: 1,
                direction: 'ltr',
                children: [
                  { type: 'text', text: 'Public content', format: 0, mode: 'normal', style: '', detail: 0, version: 1 },
                ],
              },
            ],
          },
        },
      },
    })

    try {
      const where = { slug: { equals: 'access-validation-page' } }
      const draftRead = await payload.find({
        collection: 'pages',
        where,
        overrideAccess: false,
        user: null,
      })
      expect(draftRead.docs).toHaveLength(0)

      await payload.update({
        collection: 'pages',
        id: page.id,
        data: { _status: 'published' },
      })
      const publishedRead = await payload.find({
        collection: 'pages',
        where,
        overrideAccess: false,
        user: null,
      })
      expect(publishedRead.docs).toHaveLength(1)
    } finally {
      await payload.delete({ collection: 'pages', id: page.id })
    }
  })

  it('looks up only published Pages and Posts for the public frontend', async () => {
    const content = {
      root: {
        type: 'root', format: '' as const, indent: 0, version: 1,
        direction: 'ltr' as const,
        children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
          children: [{ type: 'text', text: 'Visible body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }],
      },
    }
    const author = await payload.create({ collection: 'users', data: {
      email: 'frontend-validation@example.invalid', password: 'local-validation-password',
    } })
    const page = await payload.create({ collection: 'pages', draft: true, data: {
      title: 'Frontend Validation Page', slug: 'frontend-validation-page', content,
    } })
    const post = await payload.create({ collection: 'posts', draft: true, data: {
      title: 'Frontend Validation Post', slug: 'frontend-validation-post', content, author: author.id,
    } })
    try {
      expect(await getPublishedPage(page.slug)).toBeNull()
      expect(await getPublishedPost(post.slug)).toBeNull()
      await payload.update({ collection: 'pages', id: page.id, data: { _status: 'published' } })
      await payload.update({ collection: 'posts', id: post.id, data: { _status: 'published' } })
      expect((await getPublishedPage(page.slug))?.title).toBe(page.title)
      expect((await getPublishedPost(post.slug))?.title).toBe(post.title)
      expect((await getPublishedPosts(1, 5)).docs.map((doc) => doc.id)).toContain(post.id)
    } finally {
      await payload.delete({ collection: 'posts', id: post.id })
      await payload.delete({ collection: 'pages', id: page.id })
      await payload.delete({ collection: 'users', id: author.id })
    }
  })
})
