import type { PayloadRequest } from 'payload'
import { captureWorkspaceProof } from '../organizations/workspace-proof'
import { mutationFence } from '../organizations/mutation-guards'
import { authorityClaim } from '../organizations/claims'

/** Capture, reauthorize, then validate both in the mutation's atomic D1 batch. */
export async function workspaceMutationFence(
  req: PayloadRequest,
  references: Record<string, unknown>,
  authorize: () => Promise<unknown>,
): Promise<D1PreparedStatement[]> {
  if (authorityClaim(req.user)?.bootstrap) return []
  const proof = await captureWorkspaceProof(req, 'task-mutation', references)
  await authorize()
  return mutationFence(req, proof)
}
