import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {verifyCompaction} from './probe-verification.mjs';
const sdk=process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const {LlmAdapter,createUserMessage}=await import(pathToFileURL(sdk+'dsh-llm/lib/index.js').href);
const {defineTool}=await import(pathToFileURL(sdk+'dsh-tools/lib/index.js').href);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const name='inspector-worker-host-test';export const inject=['agents','agentPresets','tools','llm','characterIdentity','memoryIdentity','dshMemory','webServer','connection','subagents','commands'];
export function apply(ctx,config){
 class Fixture extends LlmAdapter{async *stream(request){
  const prompt=JSON.stringify(request.messages);
  if(prompt.includes('guard-attack')&&!request.messages.some(m=>m.role==='tool')){yield {type:'tool-call-delta',index:0,id:'guard-fixture-call',name:'worker_scoped_danger',argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'stop'}};return;}
  let text='Analysis complete. Proposal: parent reviews and performs any required operation with its own approval.';
  if(request.purpose==='memory-extraction'||(JSON.stringify(request.system)??'').includes('后台记忆整理器')){const input=JSON.parse(request.messages.filter(m=>m.role==='user').at(-1).content.filter(b=>b.type==='text').map(b=>b.text).join(''));text=JSON.stringify({memories:[{kind:'procedural',statement:input.evidence,quote:input.evidence}]});}
  yield {type:'text-delta',index:0,text};yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['inspector-fixture'],new Fixture());
 let executed=0;ctx.tools.register(defineTool({name:'inspector_fixture_danger',description:'Synthetic side effect',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){executed++;return 'executed';}}));
 ctx.effect(()=>{const t=setTimeout(()=>void run(),1200);return()=>clearTimeout(t);});
 async function run(){const handles=[],report={ok:false,runId:config.runId,provenance:config.provenance,host:config.version,extras:config.extras,qqNetwork:false,model:'deterministic fixture',checks:[]};let release;
 try{
  const create=async preset=>{const h=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'inspector-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:preset},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});handles.push(h);return h.agent;};
  const parent=await create('qq-character'),base=await create('cordis');
  const deadline=Date.now()+5000;while(!ctx.tools.get('subagent',parent)&&Date.now()<deadline)await sleep(20);
  const baseNames=[...ctx.tools.view(base).visible.keys()],names=[...ctx.tools.view(parent).visible.keys()];assert.deepEqual(baseNames.filter(n=>!names.includes(n)),[]);assert(names.includes('character_recall'));report.checks.push('Native Creator tool/Skills/delegation parity');
  const identity=ctx.characterIdentity,deliveries=[],manager={sessions:new Map(),async getOrCreate(){return this.record;}};
  release=identity.attach({manager,config:{appId:'mock-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}},sender:{async sendMarkdown(_t,text){deliveries.push(text);}}});
  const bind=async a=>{manager.record={sessionId:a.id,agent:a,agentPreset:'qq-character',scope:'c2c',peerId:'mock-owner',senderId:'mock-owner'};manager.sessions.set(a.id,manager.record);await manager.getOrCreate('c2c','mock-owner','mock-owner',{scope:'c2c',targetId:'mock-owner'});};await bind(parent);
  const trusted=ctx.memoryIdentity.forSession(parent.id),memory=ctx.dshMemory;
  const row=memory.remember(trusted,{kind:'semantic',statement:'隔离验收：优先保留错误栈并核对回滚记录。'},{sessionId:parent.id,eventSeq:1,messageId:'fixture-source',origin:'direct_user',quote:'隔离验收：优先保留错误栈并核对回滚记录。'});
  const second=await create('qq-character');await bind(second);assert(memory.recall(ctx.memoryIdentity.forSession(second.id),'错误栈').some(r=>r.id===row.id));report.checks.push('Cross-session memory through actual Character Host capability');
  const spawn=ctx.tools.get('subagent',parent),exec={agent:parent,signal:new AbortController().signal};
  await assert.rejects(()=>spawn.execute({description:'forged',prompt:'test',agent_preset:'cordis'},exec),/agent_preset/);
  if(!config.extras)await assert.rejects(()=>spawn.execute({description:'disabled specialist',prompt:'test',agent_preset:'worker-review'},exec),/agent_preset/);
  const spawned=await spawn.execute({description:'native independent worker',prompt:'Analyze supplied material only.'},exec);
  let worker=ctx.agents.get(spawned.subagentId);assert(worker);assert.notEqual(worker.id,parent.id);assert.equal(ctx.agentPresets.composedPreset(worker.ctx),'worker-general');
  assert(!ctx.tools.get('inspector_fixture_danger',worker));assert(!ctx.tools.get('character_recall',worker));assert(ctx.tools.guardReason({agent:worker}));assert.equal(ctx.tools.guardReason({agent:parent}),undefined);
  assert.throws(()=>ctx.memoryIdentity.forSession(worker.id));assert.throws(()=>memory.recall({...trusted,sessionId:worker.id},''));
  await worker.whenIdle();assert.equal(executed,0);report.checks.push('Actual native Spawn: independent preset/session, inherited tool denied, Memory ACL denies forged capability');
  const removeScoped=worker.ctx.tools.register(defineTool({name:'worker_scoped_danger',description:'Late scoped side effect fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){executed++;return 'must never run';}}));
  worker.followup(createUserMessage({content:[{type:'text',text:'guard-attack'}],source:{kind:'user'}}));await worker.whenIdle();removeScoped();assert.equal(executed,0);
  assert(Array.from({length:worker.session.seq},(_,i)=>worker.session.eventAt(i)).some(e=>JSON.stringify(e).includes('guard-fixture-call')),'No actual attack tool call');
  await assert.rejects(()=>ctx.subagents.sendMessage(second,worker.id,[{type:'text',text:'unauthorized'}],{signal:AbortSignal.timeout(5000)}));
  const workerId=worker.id;await ctx.subagents.drainChildren(parent,[workerId]);assert.equal(ctx.agents.get(workerId),undefined);
  await ctx.subagents.sendMessage(parent,workerId,[{type:'text',text:'Resume the analysis without executing.'}],{signal:AbortSignal.timeout(10000)});worker=ctx.agents.get(workerId);assert(worker);assert.equal(ctx.agentPresets.composedPreset(worker.ctx),'worker-general');assert(ctx.tools.guardReason({agent:worker}));assert.throws(()=>ctx.memoryIdentity.forSession(workerId));await worker.whenIdle();
  report.checks.push('Native execution guard denies late scoped tool; unrelated parent denied; cold resume preserves Worker preset and ACL');
  if(config.extras){const review=await spawn.execute({description:'specialist',prompt:'Review only supplied evidence.',agent_preset:'worker-review'},exec);const a=ctx.agents.get(review.subagentId);assert.equal(ctx.agentPresets.composedPreset(a.ctx),'worker-review');await a.whenIdle();report.checks.push('Optional specialist native Spawn');}
  await identity.notify(trusted,{eventId:'fixture-dedup',kind:'task_completed',text:'synthetic completion'});await identity.notify(trusted,{eventId:'fixture-dedup',kind:'task_completed',text:'synthetic completion'});assert.equal(deliveries.length,1);
  const schedule=await ctx.tools.get('schedule_create',parent).execute({title:'Isolated schedule',prompt:'fixture reminder',after_seconds:1},exec);
  const until=Date.now()+12000;while(deliveries.length<2&&Date.now()<until)await sleep(100);assert.equal(deliveries.length,2);assert(deliveries[1].startsWith('[提醒到期]'));report.checks.push('Native Schedule due → existing outbox, notification dedup');
  assert.equal(identity.route(trusted).automaticRotation,false);assert.equal(identity.route(trusted).session,second.id);
  await bind(parent);const inputId='extract:'+randomUUID(),inputText='每次排查故障时我都会先整理日志，再检查近期变更。';
  await manager.admitInteractionInput({message:{kind:'c2c',senderId:'mock-owner',messageId:inputId,content:inputText}});
  const extractUntil=Date.now()+12000;let extracted;while(Date.now()<extractUntil){extracted=memory.recall(trusted,'近期变更',16000).find(r=>JSON.parse(r.source).messageId===inputId);if(extracted)break;await sleep(100);}assert(extracted,'Current trusted ingress was not extracted');assert.equal(JSON.parse(extracted.source).inputOrigin,'direct_user');
  const l1Before=memory.browse(trusted,{layer:'l1'}).total;
  await parent.whenIdle();for(let i=0;i<5;i++)parent.session.append('user/message',createUserMessage({content:[{type:'text',text:('隔离压缩材料第 '+i+' 次整理日志。').repeat(180)}],source:{kind:'inspector-test-fixture'}}),{surfaceOp:'append'});
  await verifyCompaction(report,()=>ctx.commands.execute(parent,'/compact',[],AbortSignal.timeout(15000)),()=>{assert(memory.db.prepare('SELECT 1 FROM memory_checkpoints WHERE session=?').get(parent.id),'Native compaction did not checkpoint');assert.equal(memory.browse(trusted,{layer:'l1'}).total,l1Before);});
  report.checks.push('Actual automatic extraction from this ingress; native Compaction checkpoints without duplicating L1');
  const origin=ctx.webServer.getOrigin(),path=origin+'/memory-inspector/api';
  if(config.extras){
   assert.equal((await fetch(path,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'})).status,401);
   const login=await fetch(ctx.connection.authenticatedUrl(origin+'/'),{redirect:'manual'});assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
   const call=async(operation,extra={},override={})=>{const response=await fetch(path,{method:'POST',headers:{origin,cookie,'content-type':'application/json',...override},body:JSON.stringify({operation,context:parent.id,...extra})});return {status:response.status,body:await response.json()};};
   const contexts=await call('contexts');assert.equal(contexts.status,200);assert(contexts.body.contexts.some(c=>c.id===parent.id));
   assert.equal((await call('browse',{}, {origin:'http://foreign.invalid'})).status,403);
   assert.equal((await call('browse',{context:worker.id})).status,403);
   assert.equal((await call('detail',{id:row.id})).body.memory.statement,row.statement);
   assert.equal((await call('correct',{id:row.id,revision:0,statement:'stale'})).status,400);
   assert.equal((await call('confirm',{id:row.id,revision:1})).status,200);
   assert.equal((await call('correct',{id:row.id,revision:1,statement:'过时修改'})).status,409);
   assert.equal((await call('forget',{id:row.id,revision:2})).status,200);
   assert((await call('detail',{id:row.id})).body.revisions.every(r=>!r.statement&&r.source==='{}'));
   assert.equal((await call('restore',{id:row.id,revision:3,targetRevision:1})).status,400);
   const oldPage=await fetch(origin+'/memory-inspector/',{headers:{cookie}});assert.equal(oldPage.status,404);
   const html=await fetch(origin+'/',{headers:{cookie}});assert.equal(html.status,200);const shell=await html.text();assert(shell.includes('dsh-memory-inspector'),'Native client graph must include Inspector');
   const rpcId=randomUUID(),rpc=await fetch(path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:'api',payload:{operation:'contexts'}})});
   const envelope=await rpc.json();assert.equal(envelope.type,'server-response');assert.equal(envelope.rpcId,rpcId);assert.equal(envelope.result.ok,true);
   assert(envelope.result.value.contexts.some(c=>c.id===parent.id));
   // Execute the exact installed Desktop relay in isolation, with this fixture's
   // cookie only. No production process, credentials or desktop config is read.
   const desktopSource=fs.readFileSync(process.env.DSH_INSTALL_ROOT+'/resources/app.asar/lib/main.js','utf8');
   const start=desktopSource.indexOf('//#region lib/types/web-document.js'),end=desktopSource.indexOf('//#endregion',start);
   assert(start>=0&&end>start,'Installed Desktop relay seam changed');
   const relay=await import('data:text/javascript;base64,'+Buffer.from(desktopSource.slice(start,end)+'\nexport { forwardWebRequest };').toString('base64'));
   const desktopRequest=new Request('dsh-app://app/memory-inspector/api',{method:'POST',headers:{origin:'dsh-app://app','content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:'api',payload:{operation:'contexts'}})});
   const desktopResult=await relay.forwardWebRequest(desktopRequest,origin,cookie);assert.equal(desktopResult.status,200);assert.equal((await desktopResult.json()).result.ok,true);
   assert.equal(desktopResult.headers.get('set-cookie'),null);
   const hostile=new Request('dsh-app://app/memory-inspector/api',{method:'POST',headers:{origin:'https://foreign.invalid'},body:'{}'});
   assert.equal((await relay.forwardWebRequest(hostile,origin,cookie)).status,403);
   report.checks.push('Exact installed Desktop dsh-app relay: owner RPC succeeds without Origin; foreign renderer denied');
   report.checks.push('Native shell module graph + Connection RPC correlation; standalone page removed');
   report.checks.push('Real native Web login/cookie and HTTP API: unauthenticated/cross-origin/Worker denied, CAS and forget history enforced');
  }else report.checks.push('Core without GUI or specialist still functions');
  release();release=undefined;assert.throws(()=>memory.browse(trusted));report.checks.push('Gateway detach revokes Inspector/Memory authority');report.ok=true;
  if(config.preview&&config.extras){
   // Disposable synthetic fixture only; never shipped in the runtime plugin.
   release=identity.attach({manager,config:{appId:'mock-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}},sender:{async sendMarkdown(){}}});await bind(parent);
   const previewCapability=identity.forSession(parent.id);
   for(let i=0;i<24;i++)memory.remember(previewCapability,{kind:'semantic',statement:'合成分页验收条目 '+String(i).padStart(2,'0')},{sessionId:parent.id,eventSeq:1000+i,messageId:'preview:'+i,origin:'direct_user',quote:'合成分页验收条目 '+i});
   ctx.webServer.register({kind:'exact',path:'/fixture-login',handler(req,res){req.url=new URL(ctx.connection.authenticatedUrl(origin+'/')).search;req.url='/'+req.url;ctx.connection.authorizeIndex(req,res);}});
   report.previewOrigin=origin;fs.writeFileSync(config.result,JSON.stringify(report,null,2));const until=Date.now()+180000;while(Date.now()<until&&!fs.existsSync(config.cwd+'/preview.done'))await sleep(250);
  }
 }catch(e){report.ok=false;report.error=e.stack;}finally{release?.();for(const h of handles)await h.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
