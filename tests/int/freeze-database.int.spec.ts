import { expect,it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { freezeDatabase,thawDatabase } from '../../scripts/lib/freeze-database'

it('fences in-flight writes and thaws only the matching release guards',async()=>{
  const f=localD1()
  try {
    f.sqlite.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE payload_migrations(id INTEGER PRIMARY KEY); CREATE TABLE content(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO content VALUES(1,\'before\'); CREATE TRIGGER existing_guard BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT,\'protected\'); END')
    const run=crypto.randomUUID()
    const receipt=await freezeDatabase(f.db,run)
    expect(receipt.tables).toBe(3)
    expect((await freezeDatabase(f.db,run)).triggers).toEqual(receipt.triggers)
    expect(()=>f.sqlite.exec("UPDATE content SET value='after'")).toThrow('maintenance')
    expect(()=>f.sqlite.exec('INSERT INTO users VALUES(1)')).toThrow('maintenance')
    expect(await thawDatabase(f.db,crypto.randomUUID())).toEqual({removed:0})
    expect(()=>f.sqlite.exec('DELETE FROM content')).toThrow('maintenance')
    expect(await thawDatabase(f.db,run)).toEqual({removed:9})
    f.sqlite.exec("UPDATE content SET value='after'")
    expect(f.sqlite.prepare('SELECT value FROM content').get()?.value).toBe('after')
    expect(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='existing_guard'").get()).toBeTruthy()
  }finally{f.close()}
})
