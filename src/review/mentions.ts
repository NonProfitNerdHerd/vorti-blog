import type { PayloadRequest } from 'payload'
import { boardRole, canTask, reject } from './workspace-access'
import { relationID, reviewDocument } from './documents'

export type Mention = { user: number; start: number; end: number; text: string }
export type MentionScope = {
  board?: unknown
  parent?: unknown
  creator?: unknown
  assignee?: unknown
  documentType?: string
  documentID?: string
}
export async function canMention(req: PayloadRequest, task: unknown, scope?: MentionScope) {
  if (!scope) return canTask(req, task)
  if (scope.parent) return canTask(req, scope.parent)
  if (scope.board) return !!(await boardRole(req, scope.board))
  if (scope.documentType && scope.documentType !== 'none' && scope.documentID)
    return !!(await reviewDocument(req, scope.documentType, scope.documentID))
  return [relationID(scope.creator), relationID(scope.assignee)].includes(String(req.user?.id))
}
/** Explicit tokens preserve account identity even after the username changes. */
export async function resolveMentions(
  req: PayloadRequest,
  task: unknown,
  text: string,
  input: unknown,
  previous: unknown,
  scope?: MentionScope,
): Promise<Mention[]> {
  const supplied = Array.isArray(input) ? input : []
  const old = Array.isArray(previous) ? previous : []
  if (supplied.length > 100) reject('Use at most 100 mentions in one message.', 400)
  const matches: Mention[] = []
  const expression = /(^|[\s(\[{])@([a-zA-Z0-9._-]{3,32})(?=$|[\s)\]},!?:;])/g
  for (const match of text.matchAll(expression)) {
    const start = match.index! + match[1].length
    const token = `@${match[2]}`
    const explicit = supplied.find(
      (m) => m.start === start && m.end === start + token.length && m.text === token,
    )
    const retained = old.find(
      (m) => m.text === token && (!explicit || relationID(m.user) === relationID(explicit.user)),
    )
    const userID = explicit?.user ?? retained?.user
    const result = userID
      ? await req.payload.find({
          collection: 'users',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 1,
          where: { id: { equals: userID } },
        })
      : await req.payload.find({
          collection: 'users',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 1,
          where: { username: { equals: match[2].toLowerCase() } },
        })
    const user = result.docs[0]
    if (!user?.username) continue
    if (explicit && !retained && token.toLowerCase() !== `@${user.username}`)
      reject('Choose the current username from the mention menu.', 400)
    if (
      !(await canMention(
        { ...req, user: { ...user, collection: 'users' } } as PayloadRequest,
        task,
        scope,
      ))
    ) {
      if (explicit && !retained)
        reject('This user cannot access the task. Mentioning does not grant access.', 400)
      continue
    }
    matches.push({ user: user.id, start, end: start + token.length, text: token })
  }
  return matches
}
