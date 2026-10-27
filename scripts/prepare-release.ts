import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { getPlatformProxy } from 'wrangler'
import { validateReleaseTarget } from './lib/release-target.mjs'
import { prepareInstallation, administratorIdentity, type InstallationMode } from './lib/prepare-installation'
import { releaseMaintenanceRequired, releaseOperationsSchema } from './lib/release-lock'

const options: Record<string,string|boolean> = {}
for(let index=2;index<process.argv.length;index++) {
  const key=process.argv[index]
  if(key==='--discard-development-data') { options[key]=true; continue }
  if(!['--mode','--target-config','--baseline','--expected-worker','--admin-email','--receipt'].includes(key)||!process.argv[index+1]||options[key]) throw Error('Use --mode, --target-config, --baseline, --expected-worker, --admin-email, and --receipt. Reset also requires --discard-development-data.')
  options[key]=process.argv[++index]
}
const root=process.cwd(),mode=String(options['--mode']) as InstallationMode
const worker=String(options['--expected-worker']||'')
const pinned=readFileSync(path.join(root,'.node-version'),'utf8').trim().replace(/^v/,'')
if(process.versions.node!==pinned)throw Error(`Use the pinned Node ${pinned}.`)
if(!options['--target-config']||!options['--baseline']||!options['--receipt'])throw Error('Provide target configuration, baseline, and receipt paths.')
const configPath=path.resolve(String(options['--target-config']))
const sourceText=readFileSync(configPath,'utf8'),parsed=ts.parseConfigFileTextToJson(configPath,sourceText)
if(parsed.error)throw Error('Invalid target configuration.')
type Configuration={name:string;compatibility_date:string;compatibility_flags:string[];d1_databases:{binding:string;database_id:string;database_name:string}[];r2_buckets:{binding:string;bucket_name:string}[];queues?:{producers?:{binding:string;queue:string}[]}}
const config=parsed.config as Configuration,baseline=JSON.parse(readFileSync(String(options['--baseline']),'utf8'))
const resources=[...config.d1_databases.map(item=>({binding:item.binding,type:'d1',id:item.database_id,name:item.database_name})),...config.r2_buckets.map(item=>({binding:item.binding,type:'r2_bucket',name:item.bucket_name})),...(config.queues?.producers||[]).map(item=>({binding:item.binding,type:'queue',name:item.queue}))]
validateReleaseTarget({mode,discardDevelopmentData:options['--discard-development-data']===true,expectedWorker:worker,baseline,replacement:{worker:config.name,resources}})
const application=config.d1_databases.find(item=>item.binding==='D1'),operations=config.d1_databases.find(item=>item.binding==='OPERATIONS')
if(!application||!operations||application.database_id===operations.database_id)throw Error('Separate application and operational databases are required.')
const wrangler=(...args:string[])=>execFileSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
if(mode!=='install') {
  const deployments=JSON.parse(wrangler('deployments','list','--config',configPath,'--json')) as {id:string;created_on:string;versions:{version_id:string;percentage:number}[]}[]
  const current=deployments.sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0]
  if(current?.id!==baseline.deployment||current.versions.length!==1||current.versions[0].version_id!==baseline.version||current.versions[0].percentage!==100)throw Error('Production advanced. Reconcile the baseline before preparation.')
}
const directory=path.resolve(root,'.wrangler/release-preparation',crypto.randomUUID())
mkdirSync(directory,{recursive:true})
const proxyConfig=(name:string,databases:Configuration['d1_databases'])=>{
  const file=path.join(directory,`${name}.json`)
  writeFileSync(file,JSON.stringify({name:`release-${name}`,compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,d1_databases:databases.map(item=>({...item,remote:true}))}))
  return file
}
const target=await getPlatformProxy<{D1:D1Database;OPERATIONS:D1Database}>({configPath:proxyConfig('target',[application,operations]),remoteBindings:true,persist:false})
let source:Awaited<ReturnType<typeof getPlatformProxy<{D1:D1Database}>>>|undefined
try {
  for(const statement of releaseOperationsSchema)await target.env.OPERATIONS.prepare(statement).run()
  if(mode==='upgrade'&&!await releaseMaintenanceRequired(target.env.OPERATIONS,worker))throw Error('Data-preserving upgrades require maintenance protection before migration.')
  let identity:Awaited<ReturnType<typeof administratorIdentity>>|undefined
  if(mode==='development-reset') {
    const old=baseline.resources.find((item:{binding:string;type:string})=>item.binding==='D1'&&item.type==='d1')
    source=await getPlatformProxy<{D1:D1Database}>({configPath:proxyConfig('source',[{binding:'D1',database_id:old.id,database_name:old.name}]),remoteBindings:true,persist:false})
    identity=await administratorIdentity(source.env.D1,String(options['--admin-email']||''))
  }
  const result=await prepareInstallation(target.env.D1,{mode,administratorEmail:String(options['--admin-email']||''),identity,password:mode==='install'?process.env.VORTI_BOOTSTRAP_PASSWORD:undefined,discardDevelopmentData:options['--discard-development-data']===true},name=>console.log(`Applied ${name}`))
  const receipt=path.resolve(String(options['--receipt']))
  mkdirSync(path.dirname(receipt),{recursive:true})
  writeFileSync(receipt,JSON.stringify({format:1,worker,preparedAt:new Date().toISOString(),configurationHash:createHash('sha256').update(sourceText).digest('hex'),resources,...result},null,2)+'\n',{flag:'wx'})
  console.log(`Prepared ${mode}; public traffic has not been switched. Receipt: ${receipt}`)
} catch {
  // Remote SQL errors can echo bound identity material. Never print those errors.
  throw Error('Installation preparation failed. The target remains isolated; inspect its non-sensitive migration ledger before retrying. No traffic was switched.')
} finally { await source?.dispose(); await target.dispose() }
