import { describe, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { taskTenantGuardsV1 } from '../../src/organizations/task-tenant-schema-v1'
import { withAuthority } from '../../src/organizations/claims'
import { taskWhere } from '../../src/review/workspace-access'
import { workspaceGrantWhere } from '../../src/organizations/workspace-scope'

describe('permanent task tenant ownership', () => {
  it('rejects ownership changes and cross-tenant parent, project, site and board links at commit', () => {
    const f = localD1()
    try {
      f.sqlite.exec(`
        CREATE TABLE vc_organizations(id TEXT PRIMARY KEY);
        CREATE TABLE vc_sites(id TEXT PRIMARY KEY,organization_id TEXT);
        CREATE TABLE vc_tenant_installation(tenant_id TEXT PRIMARY KEY);
        CREATE TABLE task_projects(id INTEGER PRIMARY KEY,creation_tenant TEXT,platform_site TEXT);
        CREATE TABLE task_boards(id INTEGER PRIMARY KEY,creation_tenant TEXT,platform_site TEXT,project_id INTEGER);
        CREATE TABLE review_tasks(id INTEGER PRIMARY KEY,creation_tenant TEXT,document_site TEXT,parent_id INTEGER);
        CREATE TABLE review_tasks_rels(id INTEGER PRIMARY KEY,parent_id INTEGER,task_boards_id INTEGER);
        INSERT INTO vc_organizations VALUES('a'),('b');
        INSERT INTO vc_sites VALUES('site-a','a'),('site-b','b');
        INSERT INTO vc_tenant_installation VALUES('a');
      `)
      for (const sql of taskTenantGuardsV1) f.sqlite.exec(sql)
      f.sqlite.exec(`
        INSERT INTO task_projects VALUES(1,'a',NULL),(2,'b',NULL);
        INSERT INTO task_boards VALUES(1,'a',NULL,1),(2,'b',NULL,2);
        INSERT INTO review_tasks VALUES(1,'a',NULL,NULL),(2,'b',NULL,NULL),(3,'a',NULL,1);
        INSERT INTO review_tasks_rels VALUES(1,1,1);
      `)
      for (const sql of [
        "UPDATE review_tasks SET creation_tenant='b' WHERE id=1",
        'INSERT INTO review_tasks VALUES(4,NULL,NULL,NULL)',
        'UPDATE review_tasks SET parent_id=2 WHERE id=3',
        "INSERT INTO review_tasks VALUES(4,'a',NULL,2)",
        'INSERT INTO review_tasks_rels VALUES(2,1,2)',
        'UPDATE review_tasks_rels SET task_boards_id=2 WHERE id=1',
        'UPDATE task_boards SET project_id=2 WHERE id=1',
        "UPDATE review_tasks SET document_site='site-b' WHERE id=1",
      ])
        expect(() => f.sqlite.exec(sql)).toThrow(/tenant/i)
      expect(
        f.sqlite.prepare('SELECT creation_tenant,parent_id FROM review_tasks WHERE id=3').get(),
      ).toMatchObject({ creation_tenant: 'a', parent_id: 1 })
    } finally {
      f.close()
    }
  })

  it('scopes the administrator read exception to the creation tenant and honors disabled Tasks', () => {
    const req = {
      user: withAuthority(
        { id: 1 },
        {
          actor: 1,
          site: 'child',
          organization: 'a',
          epoch: 2,
          operator: false,
          bootstrap: false,
          tenantAdministrator: true,
          permissions: ['tasks:read'],
          allowed: { workspace: ['read'] },
        },
      ),
    } as unknown as PayloadRequest
    expect(taskWhere(req)).toEqual(expect.objectContaining({
      and: expect.arrayContaining([{ creationTenant: { equals: 'a' } }]),
    }))
    expect(workspaceGrantWhere(req, 'read')).toEqual(expect.objectContaining({
      and: expect.arrayContaining([{ creationTenant: { equals: 'a' } }]),
    }))
    expect(taskWhere(req, 'edit')).toBe(false)
    req.user = withAuthority(
      { id: 1 },
      {
        actor: 1,
        site: 'child',
        organization: 'a',
        epoch: 3,
        operator: false,
        bootstrap: false,
        tenantAdministrator: true,
        permissions: [],
        allowed: {},
      },
    ) as unknown as typeof req.user
    expect(taskWhere(req)).toBe(false)
    expect(workspaceGrantWhere(req, 'read')).toEqual({ id: { equals: -1 } })
  })
})
