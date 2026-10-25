import { CorrespondenceDocuments } from './correspondence-documents'
import { CRMJobPermanentError, type CRMJobHandler } from './jobs'
import { correspondenceBatchJob } from './correspondence-batch-job'
/** Private staged objects are published only by the fenced D1 checkpoint. */
export function correspondenceJob(db: D1Database, storage: R2Bucket): CRMJobHandler {
  return {
    async prepare(job) {
      const payload = JSON.parse(job.payload) as { document?: unknown; batch?: unknown }
      if (typeof payload.batch === 'string') return correspondenceBatchJob(db).prepare(job)
      if (typeof payload.document !== 'string') throw new CRMJobPermanentError('invalid-request')
      const documents = new CorrespondenceDocuments(db, job.actor_id)
      const document = await documents.get(job.site_id, payload.document)
      const existing = await db
        .prepare('SELECT document_id FROM vc_crm_document_files WHERE document_id=?')
        .bind(document.id)
        .first()
      if (existing)
        return {
          writes: [],
          cursor: document.id,
          processed: 0,
          done: true,
          result: { document: document.id },
        }
      const snapshot = JSON.parse(document.snapshot) as {
        issuer: { name: string; address: string }
        recipient: { name: string; address: string }
      }
      const { correspondencePDF, UnsupportedDocumentTextError } =
        await import('./correspondence-pdf')
      let bytes: Uint8Array
      try {
        bytes = correspondencePDF({
          id: document.id,
          subject: document.subject,
          body: document.body,
          issuedOn: document.issued_on,
          issuer: snapshot.issuer,
          recipient: snapshot.recipient,
        })
      } catch (error) {
        if (error instanceof UnsupportedDocumentTextError)
          throw new CRMJobPermanentError('unsupported-document-text')
        throw error
      }
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('')
      const objectKey = `crm/documents/${encodeURIComponent(job.site_id)}/${document.id}/${job.id}-${job.fence}.pdf`
      const abandon = async () => {
        await storage.delete(objectKey)
      }
      try {
        const object = await storage.put(objectKey, bytes, {
          httpMetadata: { contentType: 'application/pdf', cacheControl: 'private, no-store' },
          customMetadata: { sha256, document: document.id },
        })
        if (!object) throw new Error('Private document storage failed.')
        await documents.get(job.site_id, document.id)
        return {
          writes: [
            db
              .prepare(
                'INSERT INTO vc_crm_document_files(document_id,object_key,sha256,bytes,created_at) VALUES(?,?,?,?,?)',
              )
              .bind(document.id, objectKey, sha256, bytes.length, new Date().toISOString()),
          ],
          cursor: document.id,
          processed: 1,
          done: true,
          result: { document: document.id },
          abandon,
        }
      } catch (error) {
        await abandon()
        throw error
      }
    },
  }
}
export async function privateDocumentPDF(
  db: D1Database,
  storage: R2Bucket,
  actor: number,
  site: string,
  id: string,
): Promise<Response> {
  const documents = new CorrespondenceDocuments(db, actor)
  const document = await documents.get(site, id)
  const file = await db
    .prepare('SELECT object_key,bytes,sha256 FROM vc_crm_document_files WHERE document_id=?')
    .bind(document.id)
    .first<{ object_key: string; bytes: number; sha256: string }>()
  if (!file)
    return Response.json(
      { message: 'This document PDF is not ready. Check generation progress.' },
      { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
    )
  const object = await storage.get(file.object_key)
  if (!object || object.size !== file.bytes || object.customMetadata?.sha256 !== file.sha256)
    throw new Error('Private document storage requires review.')
  await documents.get(site, id)
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.bytes),
      'Content-Disposition': `attachment; filename="document-${document.id.replace(/[^a-zA-Z0-9_-]/g, '')}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
