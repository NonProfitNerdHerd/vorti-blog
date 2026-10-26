import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import crm from './playwright.crm.config'

if (!process.env.CRM_WORKER_BASE_URL)
  throw Error('Checkpoint browsers require the final local Worker artifact URL.')
if (!process.env.TENANT_HTTP_FIXTURE || !existsSync(process.env.TENANT_HTTP_FIXTURE))
  throw Error('Prepare the isolated tenant HTTP fixture before checkpoint acceptance.')
if (!process.env.FORM_TEST_ADMIN_FILE || !existsSync(process.env.FORM_TEST_ADMIN_FILE))
  throw Error('Prepare the local Forms operator fixture before checkpoint acceptance.')

export default defineConfig({
  ...crm,
  webServer: undefined,
  testMatch: undefined,
  outputDir: '.wrangler/checkpoint-browser-results',
  projects: [
    {
      name: 'core-regressions',
      testMatch: [
        'admin-sidebar.e2e.spec.ts',
        'post-templates.e2e.spec.ts',
        'menus.e2e.spec.ts',
        'task-workspace.e2e.spec.ts',
        'organization-admin.e2e.spec.ts',
        'subsite-public-forms.e2e.spec.ts',
        'tenant-enforcement.e2e.spec.ts',
      ],
    },
    {
      name: 'forms-submission',
      testMatch: 'forms.e2e.spec.ts',
      grep: /(published graph routes branches, goes Back, submits once and rejects forged history|a new form can be built, published and submitted without configuring raw fields or a slug)$/,
    },
    {
      name: 'crm-acceptance',
      testMatch: crm.testMatch,
    },
  ],
})
