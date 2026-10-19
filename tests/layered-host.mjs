import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import sourceDigest from '../scripts/source-digest.cjs';
export const name='layered-memory-host-probe';
export const inject=['agents','agentPresets','tools','commands','agentDefaultModel','memoryIdentity','dshMemory','localMemoryIngress'];
export function apply(ctx,config){ctx.effect(()=>{const timer=setTimeout(()=>void run(),1200);return()=>clearTimeout(timer);});async function run(){
 const handles=[],report={ok:false,runId:config.runId,mode:config.mode,at:new Date().toISOString(),sourceDigest:sourceDigest(),checks:[]};
 try{
  assert.equal(ctx.get('qqGateway'),undefined);assert.equal(ctx.get('characterIdentity'),undefined);
  const create=async()=>{const route=ctx.agentDefaultModel.currentSelection();const h=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:route.provider,model:route.model},meta:{cwd:config.cwd,agentPreset:'layered-memory'},setup:async c=>{await ctx.agentPresets.mount(c,'layered-memory');}});handles.push(h);return h.agent;};
  const a=await create(),b=await create(),store=ctx.dshMemory,c=ctx.memoryIdentity.forSession(a.id),other=ctx.memoryIdentity.forSession(b.id);
  const call=async(agent,name,args={})=>JSON.parse(await ctx.tools.get('memory_'+name,agent).execute(args,{agent}));
  for(const n of ['remember','recall','correct','forget','inspect','confirm','merge','status','retry','trace','projection','layers_status'])assert(ctx.tools.get('memory_'+n,a));
  assert.equal((await call(a,'layers_status')).mode,config.mode);report.checks.push('Twelve native scoped tools; configured Host mode; no QQ or Character dependency');
  const old=await call(a,'remember',{kind:'semantic',statement:'隔离重启验证：记录复盘结果。'}),checkpoint=config.result+'.checkpoint';
  if(fs.existsSync(checkpoint)){assert.equal(fs.readFileSync(checkpoint,'utf8'),old.id);report.checks.push('Actual Host restart retained L2 identity and revision');}else fs.writeFileSync(checkpoint,old.id);
  const fact=store.remember(c,{kind:'semantic',statement:'隔离事实：日常报告使用中文。 '+config.runId},{sessionId:a.id,eventSeq:1,messageId:'fact:'+config.runId,origin:'direct_user'});
  assert((await call(b,'projection')).refs.some(r=>r.id===fact.id));assert(JSON.stringify(await b.ctx.systemPrompt.assemble({agent:b,scope:b})).includes(fact.statement));assert.equal((await call(b,'trace',{id:fact.id})).evidence.length,1);
  assert.throws(()=>store.projection({...c}));report.checks.push('Native prompt contains cross-session L3 with traceable L1; forged handle rejected');
  if(config.mode==='character'&&!config.restartOnly){
   const events=['周一排查故障时，我先保存错误栈，再核对回滚记录。','周五处理另一场故障，我还是先保存错误栈，然后查看回滚记录。'];
   for(let i=0;i<events.length;i++)ctx.localMemoryIngress.admit(a,{messageId:config.runId+':'+i,eventSeq:i+2,text:events[i]});
   const deadline=Date.now()+240000;let jobs,runs;
   while(Date.now()<deadline){jobs=store.jobs(c).filter(j=>store.db.prepare('SELECT session FROM extraction_jobs WHERE id=?').get(j.id).session===a.id);runs=store.layersStatus(c).consolidation.filter(r=>r.at>=report.at);if(jobs.length===2&&jobs.every(j=>j.status==='done')&&runs.some(r=>r.status==='done'&&r.error&&JSON.parse(r.error).saved>0))break;await new Promise(r=>setTimeout(r,1000));}
   report.extraction=jobs?.map(j=>({status:j.status,attempts:j.attempts,result:j.error}));report.consolidation=runs;
   assert.equal(jobs?.length,2);assert(jobs.every(j=>j.status==='done'&&JSON.parse(j.error).saved>0),'This run did not extract both real model inputs');
   const derived=store.recall(c,'错误栈',16000).filter(r=>store.trace(c,r.id).evidence.filter(e=>e.session===a.id).length>=2);assert(derived.length>0,'No current-run multi-event L2 from real model');
   assert(store.projection(c).tokens<=1200);report.checks.push('Real configured LLM extracted current inputs and consolidated multiple events');
   for(const r of derived){const current=store.get(c,r.id);if(current.status!=='forgotten')store.forget(c,r.id,current.revision);}assert(!store.projection(c).body.includes('错误栈'));report.checks.push('Forget invalidated consolidated L2 and L3');
  }
  if(config.mode==='character'){
   const {createUserMessage}=await import(pathToFileURL(process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js').href);
   // Real native command and summarizer; synthetic surface messages are never L1.
   const before=store.db.prepare('SELECT count(*) n FROM experiences').get().n;
   for(let i=0;i<5;i++)a.session.append('user/message',createUserMessage({content:[{type:'text',text:('隔离压缩测试资料：第'+i+'次整理错误栈并记录复盘。').repeat(180)}],source:{kind:'layered-test-fixture'}}),{surfaceOp:'append'});
   try{const compact=await ctx.commands.execute(a,'/compact',[],AbortSignal.timeout(90000));assert.equal(compact?.result.kind,'success',compact?.result.text);assert(compact.result.sourceEventSeq!==undefined);assert.equal(store.db.prepare('SELECT count(*) n FROM experiences').get().n,before);assert(store.db.prepare('SELECT 1 FROM memory_checkpoints WHERE session=?').get(a.id));report.compaction={status:'verified',native:true};report.checks.push('Actual native compaction success reconciled L1 without importing its summary');}catch(e){report.compaction={status:'BLOCKED',reason:String(e.message).slice(0,300)};}
  }
  const changed=await call(b,'correct',{id:fact.id,revision:fact.revision,statement:'隔离事实：改用详细中文报告。 '+config.runId});assert.equal(changed.status,'uncertain');assert(!(await call(a,'projection')).refs.some(r=>r.id===fact.id));
  await call(a,'forget',{id:fact.id,revision:changed.revision});assert(!(await call(b,'recall',{query:config.runId})).length);report.checks.push('Existing CAS correction/forget tools update projection');
  report.ok=true;
 }catch(e){report.error=e.stack;}finally{for(const h of handles)await h.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
}}
