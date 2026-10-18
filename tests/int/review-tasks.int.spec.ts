import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

describe('Document review workflow and access', () => {
  let payload: Payload, editor: PayloadRequest, admin: PayloadRequest, other: PayloadRequest
  let page: number, task: number, child: number, comment: number
  beforeAll(async () => {
    payload = await getPayload({ config })
    const suffix = Date.now()
    const users = await Promise.all(
      ['editor', 'administrator', 'editor'].map((role, i) =>
        payload.create({
          collection: 'users',
          data: {
            email: `review-${suffix}-${i}@example.invalid`,
            password: 'local-review-test-password',
            role: role as 'editor' | 'administrator',
          },
        }),
      ),
    )
    editor = await createLocalReq({ user: { ...users[0], collection: 'users' } }, payload)
    admin = await createLocalReq({ user: { ...users[1], collection: 'users' } }, payload)
    other = await createLocalReq({ user: { ...users[2], collection: 'users' } }, payload)
    page = (
      await payload.create({
        collection: 'pages',
        req: editor,
        overrideAccess: false,
        data: { title: 'Review test', slug: `review-${suffix}`, _status: 'draft' },
      })
    ).id
  })
  it('creates independent tasks and server-authored activity', async () => {
    const doc = await payload.create({
      collection: 'review-tasks',
      req: editor,
      overrideAccess: false,
      data: {
        status: 'open',
        priority: 'normal',
        title: 'Check layout',
        documentType: 'pages',
        documentID: String(page),
        assignee: editor.user!.id,
      },
    })
    task = doc.id
    expect(typeof doc.creator === 'object' ? doc.creator?.id : doc.creator).toBe(editor.user!.id)
    const activity = await payload.find({
      collection: 'review-activity',
      req: editor,
      overrideAccess: false,
      where: { task: { equals: task } },
    })
    expect(activity.docs[0].message).toBe('Task created')
    expect((await payload.findByID({ collection: 'pages', id: page }))._status).toBe('draft')
  })
  it('enforces subtask inheritance, depth, and completion', async () => {
    child = (
      await payload.create({
        collection: 'review-tasks',
        req: editor,
        overrideAccess: false,
        data: {
          status: 'open',
          priority: 'normal',
          title: 'Check mobile',
          parent: task,
          documentType: 'posts',
          documentID: '999999',
        },
      })
    ).id
    const sub = await payload.findByID({ collection: 'review-tasks', id: child, depth: 0 })
    expect(sub.documentID).toBe(String(page))
    expect(sub.documentType).toBe('pages')
    await expect(
      payload.create({
        collection: 'review-tasks',
        req: editor,
        overrideAccess: false,
        data: {
          status: 'open',
          priority: 'normal',
          title: 'Invalid depth',
          parent: child,
          documentType: 'pages',
          documentID: String(page),
        },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: editor,
        overrideAccess: false,
        data: { status: 'done' },
      }),
    ).rejects.toThrow()
    await payload.update({
      collection: 'review-tasks',
      id: child,
      req: editor,
      overrideAccess: false,
      data: { status: 'done' },
    })
    await payload.update({
      collection: 'review-tasks',
      id: task,
      req: editor,
      overrideAccess: false,
      data: { status: 'done' },
    })
    await payload.update({
      collection: 'review-tasks',
      id: child,
      req: editor,
      overrideAccess: false,
      data: { status: 'open' },
    })
    expect((await payload.findByID({ collection: 'review-tasks', id: task })).status).toBe('open')
  })
  it('denies anonymous access and forged document references', async () => {
    await expect(
      payload.find({ collection: 'review-tasks', overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'review-tasks',
        req: editor,
        overrideAccess: false,
        data: {
          status: 'open',
          priority: 'normal',
          title: 'No access',
          documentType: 'site-templates',
          documentID: '1',
        },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: editor,
        overrideAccess: false,
        data: { documentID: '999999' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'review-activity',
        req: editor,
        overrideAccess: false,
        data: { task, documentType: 'pages', documentID: String(page), message: 'Forged' },
      }),
    ).rejects.toThrow()
  })
  it('protects comment authors and supports moderation', async () => {
    comment = (
      await payload.create({
        collection: 'review-comments',
        req: editor,
        overrideAccess: false,
        data: {
          task,
          body: 'Please check contrast.',
          documentType: 'pages',
          documentID: 'forged',
          author: other.user!.id,
        },
      })
    ).id
    expect(
      (await payload.findByID({ collection: 'review-comments', id: comment, depth: 0 })).author,
    ).toBe(editor.user!.id)
    await expect(
      payload.update({
        collection: 'review-comments',
        id: comment,
        req: other,
        overrideAccess: false,
        data: { body: 'Overwrite' },
      }),
    ).rejects.toThrow()
    await payload.update({
      collection: 'review-comments',
      id: comment,
      req: editor,
      overrideAccess: false,
      data: { body: 'Check desktop too.' },
    })
    await payload.update({
      collection: 'review-comments',
      id: comment,
      req: admin,
      overrideAccess: false,
      data: { moderated: true },
    })
    expect(
      (
        await payload.findByID({
          collection: 'review-comments',
          id: comment,
          req: editor,
          overrideAccess: false,
        })
      ).body,
    ).toContain('removed by an administrator')
  })
  it('restricts archiving and retains orphaned history for administrators', async () => {
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: editor,
        overrideAccess: false,
        data: { archived: true },
      }),
    ).rejects.toThrow()
    await payload.update({
      collection: 'review-tasks',
      id: task,
      req: admin,
      overrideAccess: false,
      data: { archived: true },
    })
    await expect(
      payload.delete({ collection: 'review-tasks', id: task, req: admin, overrideAccess: false }),
    ).rejects.toThrow()
    await payload.delete({ collection: 'pages', id: page })
    await expect(
      payload.findByID({
        collection: 'review-tasks',
        id: task,
        req: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    expect(
      (
        await payload.findByID({
          collection: 'review-tasks',
          id: task,
          req: admin,
          overrideAccess: false,
        })
      ).id,
    ).toBe(task)
    expect(
      (
        await payload.find({
          collection: 'review-comments',
          req: editor,
          overrideAccess: false,
          where: { task: { equals: task } },
        })
      ).docs,
    ).toEqual([])
  })
  it('keeps private template tasks and comments out of editor lists and assignments', async () => {
    const template = await payload.create({
      collection: 'design-templates',
      req: admin,
      overrideAccess: false,
      data: {
        name: 'Private review template',
        slug: `private-review-${Date.now()}`,
        status: 'draft',
        allowedCollections: ['pages'],
        layout: [],
      },
    })
    const privateTask = await payload.create({
      collection: 'review-tasks',
      req: admin,
      overrideAccess: false,
      data: {
        title: 'Private template review',
        documentType: 'design-templates',
        documentID: String(template.id),
        status: 'open',
        priority: 'normal',
      },
    })
    const privateComment = await payload.create({
      collection: 'review-comments',
      req: admin,
      overrideAccess: false,
      data: {
        task: privateTask.id,
        documentType: 'design-templates',
        documentID: String(template.id),
        body: 'Private review note',
      },
    })
    expect(
      (
        await payload.find({
          collection: 'review-tasks',
          req: editor,
          overrideAccess: false,
          where: { id: { equals: privateTask.id } },
        })
      ).totalDocs,
    ).toBe(0)
    // Dashboard totals must apply the same access rules as task lists.
    for (const [req, expected] of [
      [editor, 0],
      [admin, 1],
    ] as const) {
      expect(
        (
          await payload.count({
            collection: 'review-tasks',
            req,
            overrideAccess: false,
            where: { id: { equals: privateTask.id } },
          })
        ).totalDocs,
      ).toBe(expected)
    }
    await expect(
      payload.findByID({
        collection: 'review-comments',
        id: privateComment.id,
        req: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: privateTask.id,
        req: admin,
        overrideAccess: false,
        data: { assignee: editor.user!.id },
      }),
    ).rejects.toThrow()
    expect(
      (
        await payload.findByID({
          collection: 'review-tasks',
          id: privateTask.id,
          req: admin,
          overrideAccess: false,
        })
      ).id,
    ).toBe(privateTask.id)
  })
})
