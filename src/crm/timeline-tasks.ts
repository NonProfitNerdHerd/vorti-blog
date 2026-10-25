import type { InformationCategory } from '../organizations/policy'
import { crmRecordRulesV1 } from './record-context-v1'

/** Matches the existing Tasks read audience for CRM-linked Tasks: operators,
 * authorized board audiences, or the creator/assignee of an unboarded personal
 * task (including the immediate parent's audience for subtasks). CRM category
 * and live record access remain mandatory for every audience. No ID cap. */
export function timelineTaskSources(read: Set<InformationCategory>) {
  if (!read.has('workspace')) return { sources: [], params: [] }
  const categories = [
    ...new Set(Object.values(crmRecordRulesV1).map((rule) => rule.category)),
  ].filter((category) => read.has(category))
  if (!categories.length) return { sources: [], params: [] }
  return {
    sources: [
      `SELECT 'task:'||e.id,e.occurred_at,'tasks',
      CASE e.kind WHEN 'created' THEN 'Follow-up created' WHEN 'completed' THEN 'Follow-up completed' ELSE 'Follow-up reopened' END,
      t.title,NULL,NULL,'task',CAST(t.id AS TEXT),NULL,NULL,NULL,NULL
      FROM vc_crm_task_events e JOIN review_tasks t ON t.id=e.task_id
      JOIN vc_crm_task_contexts context ON context.task_id=t.id CROSS JOIN chosen q
      WHERE e.site_id=q.site_id AND context.site=q.site_id
      AND context.category IN(${categories.map(() => '?').join(',')})
      AND EXISTS(SELECT 1 FROM vc_crm_task_constituents association WHERE association.task_id=t.id AND association.constituent=q.contact_id)
      AND (
        EXISTS(SELECT 1 FROM vc_installation_operators operator WHERE operator.user_id=q.actor_id)
        OR EXISTS(SELECT 1 FROM review_tasks_rels placement JOIN vc_workspace_access audience ON audience.board_id=placement.task_boards_id
          WHERE placement.parent_id=t.id AND placement.path='boards' AND audience.read_key IN('personal:'||q.actor_id,'site:'||q.site_id||':user:'||q.actor_id,'site:'||q.site_id||':team'))
        OR (NOT EXISTS(SELECT 1 FROM review_tasks_rels placement WHERE placement.parent_id=t.id AND placement.path='boards' AND placement.task_boards_id IS NOT NULL)
          AND (t.personal=1 OR t.document_type IS NULL)
          AND ((t.parent_id IS NULL AND (t.creator_id=q.actor_id OR t.assignee_id=q.actor_id))
            OR EXISTS(SELECT 1 FROM review_tasks parent WHERE parent.id=t.parent_id AND (parent.creator_id=q.actor_id OR parent.assignee_id=q.actor_id))))
      )`,
    ],
    params: categories,
  }
}
