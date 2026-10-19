import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import sourceDigest from '../scripts/source-digest.cjs';
export const name='generic-memory-host-probe';export const inject=['agents','agentPresets','tools','memoryIdentity','dshMemory','localMemoryIngress'];
export function apply(ctx,config){ctx.effect(()=>{const t=setTimeout(()=>void run(),1000);return()=>clearTimeout(t);});async function run(){
 const handles=[],report={ok:false,at:new Date().toISOString(),sourceDigest:sourceDigest(),checks:[]};
 try{
  assert.equal(ctx.get('characterIdentity'),undefined);assert.equal(ctx.get('qqRemoteOps'),undefined);assert.equal(ctx.get('qqGateway'),undefined);report.checks.push('Real host without Character Identity, QQ or Remote Ops');
  const create=async()=>{const h=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd:config.cwd,agentPreset:'generic-memory'},setup:async c=>{await ctx.agentPresets.mount(c,'generic-memory');}});handles.push(h);return h.agent;};
  const a=await create(),b=await create(),call=async(agent,name,args)=>JSON.parse(await ctx.tools.get('memory_'+name,agent).execute(args,{agent}));
  const names=[...ctx.tools.view(a).visible.keys()];for(const n of ['remember','recall','correct','forget','inspect','confirm','merge','status','retry'])assert(names.includes('memory_'+n));assert(!names.some(n=>n.startsWith('character_')));report.checks.push('Nine generic tools on native Creator-derived Agent');
  const r=await call(a,'remember',{kind:'semantic',statement:'独立项目验收偏好：先检查错误栈 '+a.id});assert.equal(r.status,'uncertain');assert((await call(b,'recall',{query:'错误栈'})).some(x=>x.id===r.id));
  assert(!JSON.stringify(await b.ctx.systemPrompt.assemble({agent:b,scope:b})).includes(r.statement));report.checks.push('Chinese retrieval; unconfirmed manual inference excluded from stable L3');
  assert.throws(()=>ctx.dshMemory.recall({...ctx.memoryIdentity.forSession(a.id)},''));
  await assert.rejects(()=>call(a,'confirm',{id:r.id,revision:1,quote:'confirm:'+r.id}));
  ctx.localMemoryIngress.admit(a,{messageId:'generic-confirm-'+a.id,text:'confirm:'+r.id,eventSeq:1});
  const confirmed=await call(a,'confirm',{id:r.id,revision:1,quote:'confirm:'+r.id});assert.equal(confirmed.status,'active');assert.equal(confirmed.confidence,1);assert(JSON.stringify(await b.ctx.systemPrompt.assemble({agent:b,scope:b})).includes(r.statement));report.checks.push('Host capability, independent confirmation and cross-session L3');
  await assert.rejects(()=>call(b,'correct',{id:r.id,revision:1,statement:'stale'}),/conflict/);
  const fixed=await call(b,'correct',{id:r.id,revision:confirmed.revision,statement:'独立项目验收偏好：先保留错误栈 '+a.id});
  await call(a,'forget',{id:r.id,revision:fixed.revision});assert(!(await call(b,'recall',{query:'错误栈'})).some(x=>x.id===r.id));report.checks.push('CAS, correction and durable forget');
  const trusted=ctx.memoryIdentity.forSession(a.id),evidence={sessionId:a.id,eventSeq:2,messageId:'generic-job-'+a.id,origin:'direct_user',text:'每次整理旅行照片，我都会按照拍摄日期建立目录，再给每张照片添加地点标签。'};
  ctx.localMemoryIngress.admit(a,evidence);const job=ctx.dshMemory.enqueue(trusted,evidence);assert(job);report.checks.push('Generic Host evidence event persisted once');
  const persistence=await call(await create(),'remember',{kind:'procedural',statement:'独立项目重启验收：保留持久记忆'}),checkpoint=config.result+'.checkpoint';if(fs.existsSync(checkpoint)){assert.equal(fs.readFileSync(checkpoint,'utf8'),persistence.id);report.checks.push('Persisted SQLite memory recovered across real Host restart');}else fs.writeFileSync(checkpoint,persistence.id);
  const deadline=Date.now()+120000;let result;while(Date.now()<deadline){result=ctx.dshMemory.jobs(trusted).find(j=>j.id===job);if(['done','failed'].includes(result?.status))break;await new Promise(r=>setTimeout(r,500));}
  report.extraction={status:result?.status,attempts:result?.attempts,realModel:true};assert.equal(result?.status,'done','Real provider extraction did not complete');assert(JSON.parse(result.error).saved>0,'This request saved no grounded memory');assert(ctx.dshMemory.db.prepare('SELECT 1 FROM sources WHERE source_key LIKE ?').get(a.id+':'+evidence.messageId+':%'),'No source record for this request');assert(ctx.dshMemory.recall(trusted,'照片').length>0);report.checks.push('Real configured LLM extracted this request and Chinese recall found it');
  report.ok=true;
 }catch(e){report.error=e.stack;}finally{for(const h of handles)await h.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
}}
