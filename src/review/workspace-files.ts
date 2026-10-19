import type { Endpoint, PayloadRequest, Where } from 'payload'
import { constantEqual } from '../forms/security'
import { taskSearchTerms } from './client'
import { relationID } from './documents'
import { boardRole, reject, requireBoard, requireTask, taskWhere } from './workspace-access'

const limit = 25 * 1024 * 1024
const allowed: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}
async function accessFile(
  req: PayloadRequest,
  doc: { task?: unknown; board?: unknown; comment?: unknown },
  write = false,
) {
  if (doc.task) await requireTask(req, doc.task, write ? 'comment' : 'read')
  else if (doc.board) await requireBoard(req, doc.board, write ? 'edit' : 'read')
  else reject('Attachment is unavailable.', 404)
  if (doc.comment) {
    const comment = await req.payload.findByID({
      collection: 'review-comments',
      id: relationID(doc.comment),
      req,
      overrideAccess: false,
      depth: 0,
    })
    if (comment.moderated || relationID(comment.task) !== relationID(doc.task))
      reject('Attachment is unavailable.', 404)
  }
}
export async function fileList(
  req: PayloadRequest,
  scope: { task?: number; board?: number; comment?: number },
  page = 1,
  search = '',
  attachment?: number,
) {
  if (attachment !== undefined && (!Number.isSafeInteger(attachment) || attachment < 1))
    reject('Choose a valid attachment.', 400)
  if (scope.task) await requireTask(req, scope.task)
  else await requireBoard(req, scope.board)
  if (scope.comment) {
    const comment = await req.payload.findByID({
      collection: 'review-comments',
      id: scope.comment,
      req,
      overrideAccess: false,
      depth: 0,
    })
    if (comment.moderated || relationID(comment.task) !== String(scope.task))
      reject('Comment attachments are unavailable.', 404)
  }
  let where: Where = { task: { equals: scope.task } }
  if (!scope.task)
    where = {
      or: [
        { and: [{ board: { equals: scope.board } }, { task: { exists: false } }] },
        {
          and: [
            { 'task.boards': { equals: scope.board } },
            taskWhere(req, 'read', 'task.') as Where,
          ],
        },
      ],
    }
  const result = await req.payload.find({
    collection: 'task-attachments',
    req,
    depth: 0,
    overrideAccess: true,
    limit: 50,
    page,
    sort: '-createdAt',
    where: {
      and: [
        where,
        { state: { equals: 'ready' } },
        { or: [{ comment: { exists: false } }, { 'comment.moderated': { not_equals: true } }] },
        ...(scope.comment ? [{ comment: { equals: scope.comment } }] : []),
        ...(attachment ? [{ id: { equals: attachment } }] : []),
        ...taskSearchTerms(search).map((term) => ({ filename: { contains: term } })),
      ],
    },
  })
  const docs = []
  for (const { objectKey: _objectKey, ...doc } of result.docs) {
    let canDelete = relationID(doc.uploader) === String(req.user?.id),
      taskTitle: string | undefined
    if (doc.task) {
      const task = await requireTask(req, doc.task)
      taskTitle = task.title
      if (!canDelete) {
        try {
          await requireTask(req, doc.task, 'edit')
          canDelete = true
        } catch {}
      }
    } else if (!canDelete) canDelete = (await boardRole(req, doc.board)) === 'owner'
    docs.push({ ...doc, canDelete, taskTitle })
  }
  return { ...result, docs }
}
export function workspaceFileEndpoints(storage: R2Bucket): Endpoint[] {
  return [
    {
      path: '/task-workspace/maintenance',
      method: 'post',
      handler: async (req) => {
        const secret = process.env.FORM_JOB_TOKEN
        if (
          !secret ||
          secret.length < 32 ||
          !constantEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)
        )
          reject('Job authentication required.', 403)
        await cleanWorkspaceFiles(req, storage)
        return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
      },
    },
    {
      path: '/task-workspace/files',
      method: 'get',
      handler: async (req) => {
        const params = new URL(req.url!).searchParams
        return Response.json(
          await fileList(
            req,
            {
              task: params.has('task') ? Number(params.get('task')) : undefined,
              board: params.has('board') ? Number(params.get('board')) : undefined,
              comment: params.has('comment') ? Number(params.get('comment')) : undefined,
            },
            Math.max(1, Number(params.get('page') ?? 1)),
            params.get('search') ?? '',
            params.has('attachment') ? Number(params.get('attachment')) : undefined,
          ),
        )
      },
    },
    {
      path: '/task-workspace/files/stage',
      method: 'post',
      handler: async (req) => {
        if (!req.user) reject('Sign in.', 401)
        const body = (await req.json!()) as Record<string, any>
        await accessFile(req, body, true)
        const filename = String(body.filename ?? '')
          .replace(/[\x00-\x1f/\\]/g, '_')
          .slice(0, 180)
        try {
          encodeURIComponent(filename)
        } catch {
          reject('Choose a valid filename.', 400)
        }
        const extension = filename.split('.').pop()!.toLowerCase(),
          mime = allowed[extension]
        if (!mime || !Number.isInteger(body.size) || body.size < 1 || body.size > limit)
          reject('Choose a supported file up to 25 MiB.', 400)
        if (body.task) await requireTask(req, body.task, 'comment')
        if (body.comment) {
          const comment = await req.payload.findByID({
            collection: 'review-comments',
            id: body.comment,
            req,
            overrideAccess: false,
            depth: 0,
          })
          if (relationID(comment.task) !== String(body.task))
            reject('Comment and attachment must belong to the same task.', 400)
        }
        const doc = await req.payload.create({
          collection: 'task-attachments',
          req,
          overrideAccess: true,
          depth: 0,
          data: {
            task: body.task ?? null,
            board: body.task ? null : body.board,
            comment: body.comment ?? null,
            uploader: req.user!.id,
            filename,
            mimeType: mime,
            size: body.size,
            state: 'staged',
            objectKey: `workspace/${crypto.randomUUID()}`,
          },
        })
        return Response.json({ id: doc.id })
      },
    },
    {
      path: '/task-workspace/files/:id/content',
      method: 'put',
      handler: async (req) => {
        const doc = await req.payload.findByID({
          collection: 'task-attachments',
          id: String(req.routeParams?.id),
          req,
          overrideAccess: true,
          depth: 0,
        })
        await accessFile(req, doc, true)
        if (relationID(doc.uploader) !== String(req.user?.id) || doc.state !== 'staged')
          reject('Upload is unavailable.', 409)
        const reader = req.body?.getReader()
        if (!reader) reject('File data is required.', 400)
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const { value, done } = await reader!.read()
          if (done) break
          size += value.byteLength
          if (size > limit || size > doc.size) {
            await reader!.cancel()
            reject('File exceeds the staged size.', 413)
          }
          chunks.push(value)
        }
        if (size !== doc.size) reject('Uploaded size does not match the staged file.', 400)
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        const header = new TextDecoder().decode(bytes.slice(0, 12))
        if (
          (doc.mimeType === 'application/pdf' && !header.startsWith('%PDF-')) ||
          (doc.mimeType === 'image/png' && !(bytes[0] === 137 && header.slice(1, 4) === 'PNG')) ||
          (doc.mimeType === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216)) ||
          (doc.mimeType === 'image/gif' && !header.startsWith('GIF8')) ||
          (doc.mimeType === 'image/webp' &&
            !(header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP')) ||
          (['application/zip', allowed.docx, allowed.xlsx].includes(doc.mimeType) &&
            !(bytes[0] === 80 && bytes[1] === 75))
        )
          reject('File content does not match its extension.', 400)
        const uploaded = await storage.put(doc.objectKey, bytes, {
          httpMetadata: { contentType: doc.mimeType },
          onlyIf: { etagDoesNotMatch: '*' },
        })
        if (uploaded === null)
          reject('This upload was already received. Refresh the file list.', 409)
        try {
          await accessFile(req, doc, true)
          await req.payload.update({
            collection: 'task-attachments',
            id: doc.id,
            req,
            overrideAccess: true,
            data: { state: 'ready' },
          })
        } catch (error) {
          await storage.delete(doc.objectKey)
          throw error
        }
        return Response.json({ ready: true })
      },
    },
    {
      path: '/task-workspace/files/:id/content',
      method: 'get',
      handler: async (req) => {
        const doc = await req.payload.findByID({
          collection: 'task-attachments',
          id: String(req.routeParams?.id),
          req,
          overrideAccess: true,
          depth: 0,
        })
        await accessFile(req, doc)
        if (doc.state !== 'ready') reject('Attachment is unavailable.', 404)
        const object = await storage.get(doc.objectKey)
        if (!object) reject('Attachment is unavailable.', 410)
        return new Response(object!.body, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(object!.size),
            'Content-Disposition': `attachment; filename="${doc.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
          },
        })
      },
    },
    {
      path: '/task-workspace/files/:id',
      method: 'delete',
      handler: async (req) => {
        const doc = await req.payload.findByID({
          collection: 'task-attachments',
          id: String(req.routeParams?.id),
          req,
          overrideAccess: true,
          depth: 0,
        })
        await accessFile(req, doc, true)
        if (relationID(doc.uploader) !== String(req.user?.id)) {
          if (doc.task) await requireTask(req, doc.task, 'edit')
          else await requireBoard(req, doc.board, 'owner')
        }
        await req.payload.update({
          collection: 'task-attachments',
          id: doc.id,
          req,
          overrideAccess: true,
          data: { state: 'deleting' },
        })
        await storage.delete(doc.objectKey)
        await req.payload.delete({
          collection: 'task-attachments',
          id: doc.id,
          req,
          overrideAccess: true,
        })
        return Response.json({ deleted: true })
      },
    },
  ]
}
export async function cleanWorkspaceFiles(req: PayloadRequest, storage: R2Bucket) {
  const result = await req.payload.find({
    collection: 'task-attachments',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 20,
    where: {
      or: [
        { state: { equals: 'deleting' } },
        {
          and: [
            { state: { equals: 'staged' } },
            { createdAt: { less_than: new Date(Date.now() - 86400000).toISOString() } },
          ],
        },
      ],
    },
  })
  for (const doc of result.docs) {
    await storage.delete(doc.objectKey)
    await req.payload.delete({
      collection: 'task-attachments',
      id: doc.id,
      req,
      overrideAccess: true,
    })
  }
}
