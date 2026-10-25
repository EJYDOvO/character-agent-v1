// Offline, read-only. No Profile/Host, Schedule runtime, Gateway or Memory DB is loaded.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';import {DatabaseSync} from 'node:sqlite';
import {Identity} from '../packages/character-identity/identity.mjs';import {auditBindings} from '../packages/character-identity/bindings.mjs';
const args=process.argv.slice(2),get=name=>{const i=args.indexOf('--'+name);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('Required --'+name);return args[i+1];};
const files=Object.fromEntries(['binding','state','prefs','schedule','sessions'].map(k=>[k,path.resolve(get(k))]));
const presetId=get('preset'),read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),hash=s=>createHash('sha256').update(s).digest('hex');
if(!process.env.DSH_INSTALL_ROOT||!path.isAbsolute(process.env.DSH_INSTALL_ROOT))throw Error('Set absolute DSH_INSTALL_ROOT; run using its Electron with ELECTRON_RUN_AS_NODE=1');
if(read(process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/package.json').version!=='0.2.1-rc.2')throw Error('Audit requires revalidation against this DSH build');
const sdk=process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const {Context}=await import(pathToFileURL(sdk+'cordis/lib/index.js').href),Persistence=await import(pathToFileURL(sdk+'dsh-session-persistence-jsonl/lib/index.js').href);
const binding=read(files.binding),scope=new Identity(binding).conversationScope(),key=`qqbot:${binding.appId}:c2c:${binding.ownerId}`;
const before=Object.fromEntries(['binding','prefs','schedule'].map(k=>[k,hash(fs.readFileSync(files[k]))]));
const db=new DatabaseSync(files.state,{readOnly:true});let ctx,backend;
try{
 const revision=db.prepare('PRAGMA data_version').get().data_version;
 db.exec('BEGIN');const pinned=db.prepare("SELECT value FROM identity_state WHERE key='scope'").get()?.value;
 if(pinned!==hash(JSON.stringify({...scope,presetId})))throw Error('Identity scope fingerprint mismatch; no ownership inference allowed');
 const bindings=db.prepare('SELECT session FROM qq_bindings WHERE conversation=? AND preset=?').all(scope.conversationId,presetId).map(r=>r.session),route=db.prepare('SELECT session FROM routes WHERE conversation=?').get(scope.conversationId)?.session;
 const prefs=read(files.prefs),stored=read(files.schedule);if(stored.unit?.name!=='schedule'||stored.unit.version!==1||!stored.tables?.tasks)throw Error('Unsupported native Schedule storage');
 const roots=[route,prefs.sessionIds?.[key],prefs.lifecycle?.[key]?.previousSessionId].filter(Boolean);
 // Backend alone: stat() reads validated native headers, never resumes/migrates a
 // Session, acquires a write handle, or initializes the actual Host's services.
 ctx=new Context();backend=ctx.plugin(Persistence,{root:files.sessions,compression:args.includes('--uncompressed')?'none':'zstd'});await backend.await();
 const tasks=Object.values(stored.tables.tasks).map(t=>({...t.record,sessionId:t.sessionId,status:t.status}));
 const result=await auditBindings({schedules:tasks,bindings,roots,presetId,readHeader:async id=>(await ctx.get('sessionPersistence').stat(id))?.header});
 db.exec('COMMIT');const consistent=db.prepare('PRAGMA data_version').get().data_version===revision&&Object.keys(before).every(k=>hash(fs.readFileSync(files[k]))===before[k]);
 const alias=id=>hash(id).slice(0,12),report={readOnly:true,consistent,total:result.rows.length,active:result.rows.filter(r=>r.status==='active').length,
  bound:result.rows.filter(r=>r.binding==='bound').length,verifiedMissing:result.rows.filter(r=>r.binding==='verified_missing').length,
  unproven:result.rows.filter(r=>['unproven','unverifiable_binding'].includes(r.binding)).length,
  proposedBindings:result.missing.length,issues:result.issues.map(r=>({session:alias(r.sessionId),code:r.code})),
  tasks:result.rows.map(r=>({task:alias(r.id),session:alias(r.sessionId),status:r.status,binding:r.binding}))};
 console.log(JSON.stringify(report,null,2));if(!consistent||report.unproven||report.issues.length)process.exitCode=2;
}finally{db.close();await backend?.dispose();}
