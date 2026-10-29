// Actual native Host/Agent loop, deterministic provider and synthetic transport.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
const sdk=(process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT)+'/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const {LlmAdapter,createUserMessage}=await import(pathToFileURL(sdk+'dsh-llm/lib/index.js').href);
const {defineTool}=await import(pathToFileURL(sdk+'dsh-tools/lib/index.js').href);
export const name='interaction-host-probe';export const inject=['agents','agentPresets','llm','tools'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function apply(ctx,config){
 let toolStarted=false,toolAborted=false,releaseTool;let toolGate=new Promise(r=>releaseTool=r);
 const hangOnRequests=[],judgeRequests=[];let hangOnDelay=0;
 class Provider extends LlmAdapter{async *stream(request){
  if(request.system?.includes('【等待提示】')){
   hangOnRequests.push({model:request.model,sessionId:request.sessionId,purpose:request.purpose,tools:request.tools?.length??0,messages:request.messages.length});
   await sleep(hangOnDelay);if(request.signal?.aborted){yield {type:'finish',reason:{kind:'aborted'}};return;}
   yield {type:'text-delta',index:0,text:'嗯，再等我一下下。'};yield {type:'finish',reason:{kind:'stop'}};return;
  }
  if(request.system?.includes('只做分类')){
   judgeRequests.push({sessionId:request.sessionId,purpose:request.purpose,tools:request.tools?.length??0});const asked=JSON.stringify(request.messages);
   yield {type:'text-delta',index:0,text:asked.includes('先说说')?'priority':asked.includes('不对')?'revise':'append'};yield {type:'finish',reason:{kind:'stop'}};return;
  }
  const users=request.messages.filter(m=>m.role==='user'&&m.source?.kind==='user'),text=JSON.stringify(users.at(-1)?.content??[]);
  // Only a tool result for the latest input counts; earlier cases stay in history.
  if(text.includes('tool-case')&&!request.messages.slice(request.messages.lastIndexOf(users.at(-1))).some(m=>m.role==='tool')){
   yield {type:'text-delta',index:0,text:'嗯，我先检查。'};
   yield {type:'tool-call-delta',index:1,id:'fixture-call',name:'interaction_fixture',argumentsDelta:'{}'};
  }else{
   if(text.includes('slow-case'))await sleep(1000);
   yield {type:'text-delta',index:0,text:'嗯，今天还不错。'};await sleep(20);
   yield {type:'text-delta',index:0,text:'咖啡机终于修好了。'};
  }
  yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['interaction-fixture'],new Provider());
 ctx.tools.register(defineTool({name:'interaction_fixture',description:'Isolated synthetic tool',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(_a,{signal}){toolStarted=true;const aborted=()=>toolAborted=true;signal.addEventListener('abort',aborted,{once:true});try{await toolGate;return 'fixture-result';}finally{signal.removeEventListener('abort',aborted);}}}));
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),700);return()=>clearTimeout(timer);});
 async function run(){const handles=[],report={ok:false,runId:config.runId,host:config.version,provider:'deterministic-fixture',qqNetwork:false,checks:[]};let resolver,releaseOutbound;
  try{
   assert(!ctx.get('qqGateway'));assert(!ctx.get('characterMemory'));
   const create=async preset=>{const h=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'interaction-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:preset},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});handles.push(h);return h.agent;};
   const a=await create('interaction-test'),b=await create('interaction-off');
   const service=ctx.agentPresets.serviceFor(a,'interactionPolicy');assert(service,'Scoped service accessible through native preset registry');
   const p=service.get(a);assert.throws(()=>service.get(b),'Cross-preset Agent must be rejected');
   const prompt=await a.ctx.systemPrompt.assemble({agent:a,scope:a});assert(JSON.stringify(prompt).includes('Interaction Policy V1'));
   const offPrompt=await b.ctx.systemPrompt.assemble({agent:b,scope:b});assert(!JSON.stringify(offPrompt).includes('Interaction Policy V1'));
   report.checks.push('Native scoped service, prompt injection and disabled preset isolation');
   const base=await create('interaction-control'),full=await create('interaction-creator');
   // Some native per-Agent tool registrations settle asynchronously after create.
   const toolsReady=Date.now()+2000;while(!ctx.tools.get('subagent',full)&&Date.now()<toolsReady)await sleep(20);
   assert.deepEqual([...ctx.tools.view(base).visible.keys()].sort(),[...ctx.tools.view(full).visible.keys()].sort());
   assert(!ctx.agentPresets.serviceFor(base,'interactionPolicy'));
   const fullService=ctx.agentPresets.serviceFor(full,'interactionPolicy');assert(fullService);assert.throws(()=>fullService.get(a));assert.throws(()=>service.get(full));
   report.checks.push('Actual Creator tool parity and two enabled Preset services remain isolated');
   // Resolve only the copied QQ fixture against read-only installed dependencies.
   // No official file or installed node_modules is changed by these local hooks.
   const fixtureUrl=pathToFileURL(config.qqFixture+'/').href,official=pathToFileURL((process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT)+'/resources/app.asar/dsh/package.json').href,installed=pathToFileURL(process.env.DSH_INSTALL_ROOT+'/data/profiles/desktop/package.json').href;
   resolver=registerHooks({resolve(specifier,context,next){if(context.parentURL?.startsWith(fixtureUrl)&&!specifier.startsWith('.')&&!specifier.startsWith('node:')&&!specifier.startsWith('file:'))return next(specifier,{...context,parentURL:specifier.startsWith('@deepseek-ai/')?official:installed});return next(specifier,context);}});
   const {createInteractionOutbound}=await import(pathToFileURL(config.qqFixture+'/dist/gateway/bootstrap.js').href);
   const {setupMiddlewares}=await import(pathToFileURL(config.qqFixture+'/dist/gateway/middleware-setup.js').href);
   const sent=[],bubbles=[],record={sessionKey:'fixture',agent:a,replyTarget:{scope:'c2c',targetId:'synthetic-owner',msgId:'synthetic-message'}};
   const manager={ctx,findBySessionId:id=>id===a.id?record:undefined,getSessionRecord:()=>record,approvalChannel:{pending:new Map()},questionChannel:{pending:new Map()}};
   const logger={debug(){},info(){},warn(){},error(){}};
   const sender={async sendMarkdown(target,t,opts){sent.push({t,msgId:target?.msgId,input:opts?.delivery?.input,reply:opts?.delivery?.reply});},openStream(target,meta){const row={text:'',done:false,msgId:target?.msgId,input:meta?.input,reply:meta?.reply,bubble:meta?.bubble};bubbles.push(row);return {async update(t){row.text=t;meta?.onDelivered?.();},async complete(){row.done=true;}};}};
   releaseOutbound=ctx.on('session/event',createInteractionOutbound(ctx,manager,sender,{streaming:true,textChunkLimit:3500,showToolResults:false},logger,ctx.tools));
   const middleware=[];setupMiddlewares({use:m=>middleware.push(m)},{access:{c2cMode:'allowlist',c2cAllow:['synthetic-owner'],groupMode:'disabled',groupAllow:[]},historyLimit:10,media:{enabled:false}},manager,logger);
   let admitted=false;await middleware[2]({message:{kind:'c2c',senderId:'stranger'},log:logger,stop(){}},async()=>{admitted=true;});assert(!admitted);
   report.checks.push('Actual modified QQ outbound and middleware load with real SDK; outsider blocked without a gateway');
   const input=text=>{const message=createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});manager.registerInteractionInput(record,message);return message;};
   const send=async text=>{a.followup(input(text));await a.whenIdle();await p.idle();};
   await send('chat-case');assert.deepEqual(bubbles.map(b=>b.text),['嗯，今天还不错。','咖啡机终于修好了。']);assert(bubbles.every(b=>b.done));assert(!sent.length);
   assert(Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i)).some(e=>e?.type==='user/message'&&(e.data?.message??e.data)?.source?.kind==='time-context'),'Native time-context projection must actually run');
   report.checks.push('Official time-context projection preserves trusted QQ admission and reply delivery');
   report.checks.push('Actual native assistant-stream frames produce ordered bubbles, durable settlement does not duplicate');
   const history=()=>JSON.stringify(Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i)));
   const agentsBefore=ctx.agents.store.size;
   await send('slow-case');assert.equal(sent.filter(x=>x.t==='嗯，再等我一下下。').length,1);assert.equal(sent.filter(x=>x.t==='还在处理中，稍等一下。').length,0);
   assert.equal(hangOnRequests.length,1);assert.deepEqual(hangOnRequests[0],{model:'fixture',sessionId:undefined,purpose:undefined,tools:0,messages:1});
   assert(!history().includes('再等我一下下')&&!history().includes('【等待提示】'));assert.equal(ctx.agents.store.size,agentsBefore);
   report.checks.push('Real running loop delay drafts one Persona hang-on through native llm on the inherited route, outside Session history');
   hangOnDelay=900;await send('slow-case late draft');assert.equal(sent.filter(x=>x.t==='还在处理中，稍等一下。').length,1);assert.equal(sent.filter(x=>x.t==='嗯，再等我一下下。').length,1);hangOnDelay=0;
   assert(!history().includes('还在处理中，稍等一下。'));
   report.checks.push('Draft unfinished at the deadline falls back once to the fixed text');
   fs.writeFileSync(config.hangOnModelFile,JSON.stringify({provider:'interaction-fixture',model:'hang-on-only'}));
   await send('slow-case routed');assert.equal(hangOnRequests.at(-1).model,'hang-on-only');assert.equal(sent.filter(x=>x.t==='嗯，再等我一下下。').length,2);fs.rmSync(config.hangOnModelFile);
   report.checks.push('hangon-model.json overrides the hang-on draft route and removal restores inheritance');
   const beforeWeb={sent:sent.length,bubbles:bubbles.length};
   a.followup(createUserMessage({content:[{type:'text',text:'slow-case native Web input'}],source:{kind:'user'}}));await a.whenIdle();await p.idle();
   assert.equal(sent.length,beforeWeb.sent);assert.equal(bubbles.length,beforeWeb.bubbles);
   report.checks.push('Unregistered native user input on the same Agent does not deliver to QQ');
   a.followup(input('tool-case'));
   const until=Date.now()+10000;while(!toolStarted&&Date.now()<until)await sleep(10);assert(toolStarted,'Native tool did not dispatch');
   assert.equal(p.revise(createUserMessage({content:[{type:'text',text:'更正：请保留检查结果。'}],source:{kind:'user'}})),'steered');
   releaseTool();await a.whenIdle();await p.idle();assert(!toolAborted);assert(JSON.stringify(Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i))).includes('fixture-result'));
   report.checks.push('Native executing tool survives explicit correction; steer admitted at next step');
   a.followup(createUserMessage({content:[{type:'text',text:'slow-case cancel'}],source:{kind:'user'}}));await sleep(10);a.cancel({kind:'user'});await a.whenIdle();await p.idle();assert(!p.active);
   report.checks.push('Native cancel closes policy turn without replaying queued reply');
   a.followup(createUserMessage({content:[{type:'text',text:'slow-case revise'}],source:{kind:'user'}}));await sleep(10);
   assert.equal(p.revise(createUserMessage({content:[{type:'text',text:'corrected-case'}],source:{kind:'user'}})),'restarted');
   await a.whenIdle();await sleep(100);await a.whenIdle();await p.idle();
   assert(JSON.stringify(Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i))).includes('corrected-case'));
   report.checks.push('Actual text-only cancel plus native followup admits explicit correction');
   // Native steer: the claimed input is appended before its step's attempt, so
   // the steered reply gets its own context and its own QQ target.
   toolStarted=false;toolGate=new Promise(r=>releaseTool=r);
   const steerFrom=bubbles.length,first=input('tool-case steer');a.followup(first);
   const steerUntil=Date.now()+10000;while(!toolStarted&&Date.now()<steerUntil)await sleep(10);assert(toolStarted);
   record.replyTarget={...record.replyTarget,msgId:'synthetic-second'};const second=input('chat-case steered');a.steer(second);
   releaseTool();await a.whenIdle();await p.idle();
   const steered=bubbles.slice(steerFrom);
   assert.deepEqual(steered.map(b=>[b.input,b.msgId]),[[first.id,'synthetic-message'],[second.id,'synthetic-second'],[second.id,'synthetic-second']]);
   assert.notEqual(steered[0].reply,steered[1].reply);assert.deepEqual(steered.slice(1).map(b=>b.bubble),[1,2]);
   report.checks.push('Native steer opens a separate reply context routed to its own QQ input target');
   // Worker continuation: a settlement for a child catalogued in an admitted reply is delivered to that reply's target.
   let catalogued=false;
   const spawnFrom=bubbles.length;record.replyTarget={...record.replyTarget,msgId:'synthetic-research'};const research=input('slow-case research');a.followup(research);
   // The catalog is injected synthetically while the admitted turn runs; the settlement below is a real native followup.
   const activeUntil=Date.now()+5000;while(p.replyCtx?.input!==research.id&&Date.now()<activeUntil)await sleep(5);assert(p.active&&!p.background);
   p.event({type:'subagent/catalog',seq:-1,data:{version:1,childId:'synthetic-child',mode:'one-shot',label:'probe'}});catalogued=true;
   await a.whenIdle();await p.idle();
   assert.equal(bubbles.slice(spawnFrom).every(b=>b.input===research.id),true);
   record.replyTarget={...record.replyTarget,msgId:'synthetic-later'};
   const settledFrom=bubbles.length;
   a.followup(createUserMessage({content:[{type:'text',text:'chat-case settlement'}],source:{kind:'subagent-settled',form:'notice',senderSessionId:'synthetic-child'}}));await a.whenIdle();await p.idle();
   const settledOut=bubbles.slice(settledFrom);assert(catalogued&&settledOut.length>0,'Worker settlement must reach QQ');assert(settledOut.every(b=>b.input===research.id&&b.msgId==='synthetic-research'));
   const forgedFrom=bubbles.length;
   a.followup(createUserMessage({content:[{type:'text',text:'chat-case forged'}],source:{kind:'subagent-settled',form:'notice',senderSessionId:'other-child'}}));await a.whenIdle();await p.idle();
   assert.equal(bubbles.length,forgedFrom);
   report.checks.push('Worker settlement (synthetic catalog, native followup) continues its admitted reply on the original QQ target; unknown child stays suppressed');
   // Interjections through the real loop: priority cancels a text-only reply and the
   // new input is answered next; an independent question waits for the reply.
   const events=()=>Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i)).filter(Boolean);
   const waitFor=async id=>{const until=Date.now()+5000;while(p.replyCtx?.input!==id&&Date.now()<until)await sleep(5);assert.equal(p.replyCtx?.input,id);};
   const settle=async()=>{await a.whenIdle();await sleep(100);await a.whenIdle();await p.idle();};
   let mark=a.session.seq;const interrupted=input('slow-case interrupted');a.followup(interrupted);await waitFor(interrupted.id);
   const priority=input('chat-case 先说说晚饭');assert.equal(p.intervene(priority),'judging');await settle();
   const after=events().filter(e=>e.seq>=mark);
   assert(after.some(e=>e.type==='turn/end'&&e.data.reason?.kind==='aborted'),'text-only reply was cancelled');
   assert(bubbles.some(b=>b.input===priority.id),'new input answered');assert(!bubbles.some(b=>b.input===interrupted.id),'stale reply never sent');
   assert.deepEqual(judgeRequests.at(-1),{sessionId:undefined,purpose:undefined,tools:0});
   report.checks.push('Judged priority interjection cancels a text-only reply via native cancel and answers the new input next');
   mark=a.session.seq;const kept=input('slow-case kept');a.followup(kept);await waitFor(kept.id);
   const extra=input('chat-case 另外一个问题');p.intervene(extra);await settle();
   assert(!events().filter(e=>e.seq>=mark).some(e=>e.type==='turn/end'&&e.data.reason?.kind==='aborted'),'independent question never cancels');
   const order=bubbles.filter(b=>b.input===kept.id||b.input===extra.id).map(b=>b.input);
   assert.deepEqual(order,[kept.id,kept.id,extra.id,extra.id]);assert(bubbles.filter(b=>b.input===kept.id).every(b=>b.done));
   report.checks.push('Judged independent question is queued: current reply completes first, then the new input');
   for(const kind of ['priority','revise']){
    mark=a.session.seq;toolStarted=false;
    const old=input('tool-case slow-case post-tool-'+kind);a.followup(old);await waitFor(old.id);
    const until=Date.now()+5000;while(!events().some(e=>e.seq>=mark&&e.type==='tool/result')&&Date.now()<until)await sleep(5);
    assert(events().some(e=>e.seq>=mark&&e.type==='tool/result'));assert.equal(p.tools.size,0);assert.equal(p.toolSeen,false);
    const next=input(kind==='priority'?'chat-case 先说说新话题':'chat-case 不对，改看新目标');p.intervene(next);await settle();
    assert(events().some(e=>e.seq>=mark&&e.type==='turn/end'&&e.data.reason?.kind==='aborted'));
    assert(bubbles.some(b=>b.input===next.id));assert(!toolAborted);
   }
   report.checks.push('Completed native tools return to text: judged priority/revise cancel text without cancelling a tool');
   report.ok=true;
  }catch(e){report.ok=false;report.error=e.stack;}finally{releaseTool();releaseOutbound?.();for(const h of handles)await h.dispose().catch(()=>{});resolver?.deregister();fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
