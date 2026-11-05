// Isolated v1 -> v2 Schedule storage drill. One synthetic DSH_HOME, four Host
// processes: rc.3 writes v1 rows, rc.1 loads them read-only and performs the
// first write, rc.1 restarts on v2, rc.3 observes v2 (rollback boundary).
// No Character plugin, credentials, QQ network or production data.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
const sdk=process.env.DSH_CHARACTER_HOST_ROOT+'/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const {LlmAdapter}=await import(pathToFileURL(sdk+'dsh-llm/lib/index.js').href);
export const name='schedule-migration-probe';
export const inject=['agents','schedule','sessions','agentPresets','llm'];
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Locate the native Schedule domain on disk without assuming its file name.
function scheduleFiles(home){
 const found=[];
 (function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
  if(e.isDirectory()){if(!['node_modules','tmp','agents'].includes(e.name))walk(p);continue;}
  if(fs.statSync(p).size>8e6)continue;let j;try{j=JSON.parse(fs.readFileSync(p,'utf8'));}catch{continue;}
  if(j?.unit?.name==='schedule')found.push(p);}})(home);
 return found;
}
const summary=e=>({kind:e.kind,title:e.title,prompt:e.prompt,scheduledAt:e.scheduledAt});
export function apply(ctx,config){
 class Fixture extends LlmAdapter{async *stream(){yield {type:'text-delta',index:0,text:'Synthetic migration reminder handled.'};yield {type:'finish',reason:{kind:'stop'}};}}
 ctx.llm.registerAdapter(['migration-fixture'],new Fixture());
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1500);return()=>clearTimeout(timer);});
 async function run(){
  const phase=config.phase,state=path.join(config.home,'migration-state.json'),saved=fs.existsSync(state)?JSON.parse(fs.readFileSync(state,'utf8')):{};
  const version=JSON.parse(fs.readFileSync(process.env.DSH_CHARACTER_HOST_ROOT+'/resources/app.asar/dsh/package.json','utf8')).version;
  const report={ok:false,runId:config.runId,phase,host:version,qqNetwork:false,checks:[],observations:{}};
  try{
   if(phase===0){
    assert.equal(version,'0.2.1-rc.3');
    const sessions=[];for(let i=0;i<2;i++){const h=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'migration-fixture',model:'fixture'},meta:{cwd:config.home,agentPreset:'minimal'},setup:async c=>{await ctx.agentPresets.mount(c,'minimal');}});assert(await ctx.sessions.flush(h.agent.session));sessions.push(h.agent.id);await h.dispose();}
    const [a,b]=sessions,made=[];
    made.push(await ctx.schedule.create(a,{title:'after fixture',prompt:'v1 after',after_seconds:7200}));
    made.push(await ctx.schedule.create(a,{title:'every fixture',prompt:'v1 every',every_seconds:3600}));
    made.push(await ctx.schedule.create(b,{title:'daily fixture',prompt:'v1 daily',daily:{time:'08:00:00',time_zone:'Asia/Shanghai'}}));
    const gone=await ctx.schedule.create(b,{title:'deleted fixture',prompt:'v1 deleted',after_seconds:7200});assert.equal((await ctx.schedule.delete({sessionId:b,id:gone.id})).deleted,true);
    const ended=await ctx.schedule.create(a,{title:'ended fixture',prompt:'v1 ended',after_seconds:2});
    const until=Date.now()+25000;let row;while(Date.now()<until){row=(await ctx.schedule.catalog()).find(r=>r.id===ended.id);if(row?.status==='inactive')break;await sleep(250);}
    report.observations.endedDelivered=row?.status==='inactive';
    const catalog=await ctx.schedule.catalog(),files=scheduleFiles(config.home);assert.equal(files.length,1,'One native Schedule domain file');
    const raw=JSON.parse(fs.readFileSync(files[0],'utf8'));assert.equal(raw.unit.version,1,'rc.3 writes Schedule v1');
    const tasks=Object.fromEntries(catalog.map(r=>[r.id,{...summary(r),sessionId:r.sessionId,status:r.status,lastDelivery:r.lastDelivery??null}]));
    assert(!tasks[gone.id]);for(const m of made)assert.equal(tasks[m.id].status,'active');
    fs.writeFileSync(state,JSON.stringify({sessions,file:files[0],v1Hash:sha(files[0]),tasks,deleted:gone.id,ended:ended.id,every:made[1].id}));
    report.checks.push(`rc.3 wrote ${catalog.length} v1 tasks (one deleted, ended delivered: ${report.observations.endedDelivered})`);
   }else if(phase===1){
    assert.equal(version,'0.2.2-rc.1');
    report.observations.startupWrite=sha(saved.file)!==saved.v1Hash;
    assert.equal(report.observations.startupWrite,false,'rc.1 startup must not rewrite v1 storage');
    const catalog=await ctx.schedule.catalog();assert.equal(sha(saved.file),saved.v1Hash,'Catalog read must not write');
    assert.equal(JSON.parse(fs.readFileSync(saved.file,'utf8')).unit.version,1);
    assert.equal(catalog.length,Object.keys(saved.tasks).length);assert(!catalog.some(r=>r.id===saved.deleted));
    for(const [id,v1] of Object.entries(saved.tasks)){const e=catalog.find(r=>r.id===id);assert(e,'v1 task readable: '+id);
     assert.deepEqual(e.target,{kind:'session',sessionId:v1.sessionId},'v1 binding becomes a fixed session target');assert.deepEqual(e.involvedSessionIds,[v1.sessionId]);
     assert.equal(e.status,v1.status==='inactive'?'ended':v1.status);assert.deepEqual(summary(e),{kind:v1.kind,title:v1.title,prompt:v1.prompt,scheduledAt:v1.scheduledAt});
     if(v1.lastDelivery)assert.equal(e.lastDelivery.targetSessionId,v1.sessionId);}
    report.checks.push('rc.1 reads every v1 row read-only: ids, fixed targets, status (inactive→ended), kind, due time, last delivery');
    const every=catalog.find(r=>r.id===saved.every);
    const stale=await ctx.schedule.edit({id:every.id,action:'update',expectedUpdatedAt:'1999-01-01T00:00:00.000Z',patch:{title:'stale'}});assert.equal(stale.code,'schedule_conflict');assert.equal(sha(saved.file),saved.v1Hash,'A conflict writes nothing');
    const edited=await ctx.schedule.edit({id:every.id,action:'update',expectedUpdatedAt:every.updatedAt??null,patch:{title:'every fixture edited'}});assert.equal(edited.title,'every fixture edited');assert.equal(edited.scheduledAt,every.scheduledAt,'A title edit keeps the due time');
    await sleep(500);const raw=JSON.parse(fs.readFileSync(saved.file,'utf8'));
    report.observations.afterFirstWrite={version:raw.unit.version,hashChanged:sha(saved.file)!==saved.v1Hash};
    const rows=Object.values(raw.tables.tasks);report.observations.rowShapes=rows.map(t=>({id:t.record?.id===every.id?'edited':'other',hasTarget:'target' in t,hasSessionId:'sessionId' in t}));
    assert.equal(raw.unit.version,2,'First write upgrades the domain to v2');
    const after=await ctx.schedule.catalog();for(const [id,v1] of Object.entries(saved.tasks)){if(id===every.id)continue;const e=after.find(r=>r.id===id);assert.deepEqual(summary(e),{kind:v1.kind,title:v1.title,prompt:v1.prompt,scheduledAt:v1.scheduledAt});assert.deepEqual(e.target,{kind:'session',sessionId:v1.sessionId});}
    fs.writeFileSync(state,JSON.stringify({...saved,v2Hash:sha(saved.file),edited:summary(edited)}));
    report.checks.push('Stale CAS writes nothing; first real edit upgrades storage to v2; other rows keep id/target/due time');
   }else if(phase===2){
    assert.equal(version,'0.2.2-rc.1');
    const catalog=await ctx.schedule.catalog();const e=catalog.find(r=>r.id===saved.every);assert.deepEqual(summary(e),saved.edited);
    assert.equal(JSON.parse(fs.readFileSync(saved.file,'utf8')).unit.version,2);
    for(const [id,v1] of Object.entries(saved.tasks)){const row=catalog.find(r=>r.id===id);assert(row);assert.deepEqual(row.target,{kind:'session',sessionId:v1.sessionId});}
    report.observations.restartWrite=sha(saved.file)!==saved.v2Hash;
    report.checks.push('Second rc.1 process reads v2 with the edit and every fixed target intact');
   }else{
    // Rollback boundary: observe what the previous Host does with v2 data. Never asserted as supported.
    try{const rows=await ctx.schedule.catalog();report.observations.oldHostRead={ok:true,count:rows.length};}catch(error){report.observations.oldHostRead={ok:false,error:String(error).slice(0,300)};}
    report.checks.push('rc.3 on v2 storage observed (not a supported rollback)');
   }
   report.ok=true;
  }catch(error){report.error=error.stack;}
  finally{fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
