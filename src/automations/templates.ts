import type { Definition } from './model'

export const workflowTemplates: {
  id: string
  name: string
  description: string
  definition: Definition
  sample?: Record<string, unknown>
}[] = [
  {
    id: 'form-contact',
    name: 'Create a CRM contact from a form submission',
    description:
      'Map a submission answer to a new donor/contact. Configure your answer field before publishing; the trigger covers submissions in this site.',
    definition: {
      trigger: { kind: 'created', resource: 'form-submissions' },
      steps: [
        {
          id: 'contact',
          name: 'Create CRM contact',
          kind: 'create',
          resource: 'contacts',
          data: {
            profile: { kind: 'person', firstName: { $ref: 'trigger.answers.firstName' } },
            roles: ['donor'],
          },
        },
      ],
    },
  },
  {
    id: 'form-followup',
    name: 'Create a follow-up task from a form submission',
    description:
      'Choose a board and map the submission to a follow-up task. Configure the destination before publishing.',
    definition: {
      trigger: { kind: 'created', resource: 'form-submissions' },
      steps: [
        {
          id: 'followup',
          name: 'Create follow-up',
          kind: 'create',
          resource: 'review-tasks',
          data: { title: 'Review new form submission', initialBoard: '', priority: 'normal' },
        },
      ],
    },
  },
  {
    id: 'task-completed',
    name: 'Branch when a task is completed',
    description:
      'Watch task status, check for Done, and create a follow-up on the true branch. Choose the source task and destination board.',
    definition: {
      trigger: { kind: 'updated', resource: 'review-tasks', field: 'status' },
      steps: [
        {
          id: 'completed',
          name: 'Is the task done?',
          kind: 'condition',
          left: { $ref: 'trigger.status' },
          operator: 'equals',
          right: 'done',
        },
        {
          id: 'followup',
          name: 'Create follow-up',
          kind: 'create',
          resource: 'review-tasks',
          when: { step: 'completed', equals: true },
          data: { title: 'Follow up on completed work', initialBoard: '' },
        },
      ],
    },
  },
  {
    id: 'manual-contact',
    name: 'Create a CRM contact manually',
    description:
      'Start with an input value and create a contact using your current CRM permissions.',
    sample: { firstName: 'New contact' },
    definition: {
      trigger: { kind: 'manual' },
      steps: [
        {
          id: 'contact',
          name: 'Create CRM contact',
          kind: 'create',
          resource: 'contacts',
          data: {
            profile: { kind: 'person', firstName: { $ref: 'trigger.firstName' } },
            roles: [],
          },
        },
      ],
    },
  },
  {
    id: 'content-followup',
    name: 'Review a post publication',
    description:
      'Watch a post publication status and create a review task when it is published. Choose the post and board.',
    definition: {
      trigger: { kind: 'updated', resource: 'posts', field: '_status' },
      steps: [
        {
          id: 'published',
          name: 'Is the post published?',
          kind: 'condition',
          left: { $ref: 'trigger._status' },
          operator: 'equals',
          right: 'published',
        },
        {
          id: 'review',
          name: 'Create review task',
          kind: 'create',
          resource: 'review-tasks',
          when: { step: 'published', equals: true },
          data: { title: { $ref: 'trigger.title' }, initialBoard: '' },
        },
      ],
    },
  },
]
