// Actual native Host/Agent loop, deterministic provider and synthetic transport.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';import path from 'node:path';
import {registerHooks} from 'node:module';
const sdk=(process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT)+'/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const {LlmAdapter,createUserMessage}=await import(pathToFileURL(sdk+'dsh-llm/lib/index.js').href);
const {defineTool}=await import(pathToFileURL(sdk+'dsh-tools/lib/index.js').href);
export const name='interaction-host-probe';export const inject=['agents','agentPresets','llm','tools','agentIO'];
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
 async function run(){const handles=[],report={ok:false,runId:config.runId,host:config.version,provider:'deterministic-fixture',qqNetwork:false,checks:[]};let resolver,releaseOutbound,releaseInteractionAdapter,conversation;
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
   const sent=[],bubbles=[],record={sessionKey:'fixture',sessionId:a.id,agent:a,scope:'c2c',peerId:'synthetic-owner',replyTarget:{scope:'c2c',targetId:'synthetic-owner',msgId:'synthetic-message'}};
   const manager={ctx,getOrCreate:async()=>record,isCurrentSession:r=>r===record&&ctx.agents.get(a.id)===a,findBySessionId:id=>id===a.id?record:undefined,getSessionRecord:()=>record,hitl:{waiting:()=>false}};
   // The installed dsh-agent-io's shared Conversation wiring (Iteration 03), as the Gateway opens it.
   const io=ctx.get('agentIO');assert(typeof io?.openConversation==='function','Installed dsh-agent-io has no openConversation (pre-Iteration 03 package)');
   conversation=io.openConversation({platform:'qq-official',adapter:'qq-official-gateway',accountId:'synthetic-interaction',manager,scopes:{direct:'c2c',group:'group'},admits:(scope,peer)=>scope==='c2c'&&peer==='synthetic-owner',onInput:(r,m,policy)=>{if(policy)manager.trackInteractionInput?.(r,m);}});
   const logger={debug(){},info(){},warn(){},error(){}};
   // Iteration 04: every Interaction bubble and status line is a logical message of the
   // installed Unified I/O, sent by the reviewed QQ text adapter; the gateway sender is
   // never called directly for chat output, and there is no SDK stream.
   const direct=[],sender={async sendMarkdown(){direct.push('sendMarkdown');},openStream(){direct.push('openStream');throw Error('no stream');}};
   const {createQQTextAdapter,accessAllows,QQ_SCOPES,hitlResponse}=await import(pathToFileURL(config.qqFixture+'/dist/transport/qq-text-adapter.js').href);
   const outbound=createInteractionOutbound(ctx,manager,sender,{streaming:true,textChunkLimit:3500,showToolResults:false},logger,ctx.tools,undefined,io,conversation);
   releaseOutbound=ctx.on('session/event',outbound);
   releaseInteractionAdapter=conversation.registerAdapter(createQQTextAdapter({limit:3500,split:t=>[t],replyTarget:(_r,id)=>outbound.delivery(id)?.target,
    async send(target,t,info){const d=outbound.delivery(info.messageId),row={t,text:t,done:true,id:info.messageId,msgId:target?.msgId,input:d?.input,reply:d?.delivery?.reply,bubble:d?.delivery?.bubble,kind:d?.delivery?.kind};(row.kind==='assistant'?bubbles:sent).push(row);return {id:'receipt-'+(bubbles.length+sent.length)};}}));
   const middleware=[];setupMiddlewares({use:m=>middleware.push(m)},{access:{c2cMode:'allowlist',c2cAllow:['synthetic-owner'],groupMode:'disabled',groupAllow:[]},historyLimit:10,media:{enabled:false}},manager,logger,conversation);
   let admitted=false;await middleware[2]({message:{kind:'c2c',senderId:'stranger'},log:logger,stop(){}},async()=>{admitted=true;});assert(!admitted);
   report.checks.push('Actual modified QQ outbound and middleware load with real SDK; outsider blocked without a gateway');
   // Through the Host's agentPresets, from the dsh-agent-io plugin context: the same scoped service, none for a Preset without it.
   assert.equal(conversation.policy(record),p);assert.equal(conversation.policy({agent:base}),undefined);
   report.checks.push('Installed dsh-agent-io Conversation wiring resolves the native scoped Interaction service; a Preset without it has none');
   // What the shared handoff does for an admitted input before the policy acts (direct policy calls below).
   const input=text=>{const message=createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});manager.trackInteractionInput(record,message);p.admitInput?.(message);return message;};
   const send=async text=>{a.followup(input(text));await a.whenIdle();await p.idle();};
   const handed=conversation.submit(record,'chat-case');assert.equal(handed.status,'accepted');assert.equal(handed.mode,'followup');assert.equal(handed.interactive,true);
   assert.equal(handed.message.source.kind,'user');assert.equal(typeof handed.message.id,'string','the native dsh-llm UserMessage');await a.whenIdle();await p.idle();
   report.checks.push('Shared handoff: one native UserMessage via the Host dsh-llm constructor, admitted to Interaction, followup on the idle Agent');
   assert.deepEqual(bubbles.map(b=>b.text),['嗯，今天还不错。咖啡机终于修好了。']);assert(!sent.length);assert.deepEqual(direct,[]);
   assert(bubbles[0].id.startsWith('qq:'+a.id+':')&&/:\d+:[0-9a-f]{8}:\d+\.\d+:assistant$/.test(bubbles[0].id),'stable logical id: Session, Turn, policy instance, reply, bubble');
   assert(Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i)).some(e=>e?.type==='user/message'&&(e.data?.message??e.data)?.source?.kind==='time-context'),'Native time-context projection must actually run');
   report.checks.push('Official time-context projection preserves trusted QQ admission and reply delivery');
   report.checks.push('Actual native assistant-stream frames produce complete bubbles through the installed Unified I/O and QQ text adapter, with stable ids; durable settlement does not duplicate');
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
   assert.deepEqual(steered.map(b=>[b.input,b.msgId]),[[first.id,'synthetic-message'],[second.id,'synthetic-second']]);
   assert.notEqual(steered[0].reply,steered[1].reply);assert.deepEqual(steered.slice(1).map(b=>b.bubble),[1]);
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
   assert.deepEqual(order,[kept.id,extra.id]);assert(bubbles.filter(b=>b.input===kept.id).every(b=>b.done));
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
   // Plain Agent without Interaction: native reply -> original QQ router -> installed
   // dsh-agent-io -> QQ text adapter, with the logical id from the real Host seq.
   assert(typeof io.sendMessage==='function');
   assert.deepEqual(direct,[],'no Interaction output bypassed the Unified I/O');
   report.checks.push('All Interaction bubbles, hang-on lines and steered replies went through the installed Unified I/O; nothing used a direct send or SDK stream');
   const plainSent=[],ids=[],plainRecord={sessionKey:'plain',sessionId:base.id,agent:base,scope:'c2c',peerId:'synthetic-owner',replyTarget:{scope:'c2c',targetId:'synthetic-owner',msgId:'synthetic-plain'}};
   const plainManager={ctx,getOrCreate:async(scope,peer,senderId,target)=>{assert.deepEqual([scope,peer,senderId],['c2c','synthetic-owner','synthetic-owner']);plainRecord.replyTarget=target;return plainRecord;},findBySessionId:id=>id===base.id?plainRecord:undefined,getSessionRecord:(s,peer)=>s==='c2c'&&peer==='synthetic-owner'?plainRecord:undefined,isCurrentSession:r=>r===plainRecord&&ctx.agents.get(base.id)===base,hitl:{waiting:()=>false}};
   const plainConfig={appId:'synthetic-app',streaming:false,textChunkLimit:3500,showToolResults:false,access:{c2cMode:'allowlist',c2cAllow:['synthetic-owner'],groupMode:'disabled',groupAllow:[]}};
   const plainConversation=io.openConversation({platform:'qq-official',adapter:'qq-official-gateway',accountId:'synthetic-app',manager:plainManager,scopes:QQ_SCOPES,admits:(scope,peer)=>accessAllows(plainConfig.access,scope,peer)});
   // Iteration 05 basic media: the reviewed sendMedia on real files; only the QQ bot is synthetic.
   const {sendMedia}=await import(pathToFileURL(config.qqFixture+'/dist/gateway/bootstrap.js').href);
   const {ReplyLimiter}=await import(pathToFileURL(config.qqFixture+'/dist/transport/reply-limiter.js').href);
   const mediaDir=path.join(config.cwd,'media-probe');fs.mkdirSync(mediaDir,{recursive:true});const mediaConfig={sendFile:{restrictPaths:true,extraRoots:[]},cwd:fs.realpathSync(mediaDir)};
   const mediaCalls=[],mediaBot={creds:{},async uploadMedia(o){mediaCalls.push({stage:'upload',fileType:o.fileType,srvSendMsg:o.srvSendMsg,path:o.localPath});return {file_uuid:'synthetic-uuid',file_info:'synthetic-info'};},
    mediaApi:{async sendMediaMessage(_scope,_target,info,_creds,opts){mediaCalls.push({stage:'message',info,msgId:opts.msgId});return {id:'synthetic-media-'+mediaCalls.length};}}};
   const releaseAdapter=plainConversation.registerAdapter(createQQTextAdapter({limit:3500,split:t=>[t],send:async(target,text,info)=>{if(text==='notify-timeout')throw Object.assign(Error('API'),{name:'ApiError',httpStatus:0});plainSent.push({text,msgId:target.msgId,...(info?.keyboard?{keyboard:info.keyboard}:{}),...(info?.notification?{notification:true,targetId:target.targetId}:{})});return {id:'receipt-'+plainSent.length};},
    sendMedia:(target,attachment)=>sendMedia(mediaBot,new ReplyLimiter({limit:4}),mediaConfig,target,attachment)}));
   const plainHandler=createInteractionOutbound(ctx,plainManager,sender,plainConfig,logger,ctx.tools,null,{...io,sendMessage:r=>{ids.push(r.id);return io.sendMessage(r);}},plainConversation);
   const releasePlain=ctx.on('session/event',plainHandler);
   try{
    base.followup(createUserMessage({content:[{type:'text',text:'chat-case plain'}],source:{kind:'user'}}));await base.whenIdle();await sleep(100);
    assert.deepEqual(plainSent,[{text:'嗯，今天还不错。咖啡机终于修好了。',msgId:'synthetic-plain'}]);
    const settled=Array.from({length:base.session.seq},(_,i)=>base.session.eventAt(i)).filter(e=>e?.type==='assistant/message').at(-1);
    assert(Number.isSafeInteger(settled.seq)&&Number.isSafeInteger(settled.data.turn));assert.equal(ids.at(-1),`qq:${base.id}:${settled.seq}:assistant`);
    plainHandler({header:{id:base.id}},settled);await sleep(100);assert.equal(plainSent.length,1,'a replayed native event is not sent again');
    report.checks.push('Installed dsh-agent-io: a plain Agent reply reaches the QQ adapter once with a stable id from the real Host seq; replay is suppressed');
    // Inbound on the same installed I/O: the reviewed QQ handler hands a QQ event
    // to the channel, the trusted entry creates one native input, the reply comes
    // back out through the outbound path. A re-pushed message id adds nothing.
    {
     const {handleInbound,deliverInbound}=await import(pathToFileURL(config.qqFixture+'/dist/transport/inbound.js').href);
     const channel=plainConversation.openInbound(s=>deliverInbound(s,plainConversation,plainConfig,logger));
     const qqEvent=()=>({message:{kind:'c2c',senderId:'synthetic-owner',messageId:'synthetic-inbound-1',content:'chat-case inbound',attachments:[]},state:{},bot:{async sendMarkdown(){},async sendTyping(){}}});
     try{
      const before=plainSent.length;await handleInbound(qqEvent(),logger,channel);await sleep(100);
      const inputs=()=>Array.from({length:base.session.seq},(_,i)=>base.session.eventAt(i)).filter(e=>e?.type==='user/message'&&JSON.stringify(e.data).includes('chat-case inbound'));
      assert.equal(inputs().length,1);assert.deepEqual(plainSent.slice(before),[{text:'嗯，今天还不错。咖啡机终于修好了。',msgId:'synthetic-inbound-1'}],'reply targets the inbound msg_id');
      await handleInbound(qqEvent(),logger,channel);await base.whenIdle();await sleep(100);
      assert.equal(inputs().length,1,'duplicate push creates no second input');assert.equal(plainSent.length,before+1,'and no second reply');
      const stranger=await channel.receive({conversation:{type:'direct',id:'stranger'},message:{id:'synthetic-inbound-2',text:'hi'},sender:{id:'stranger'},platformData:{context:qqEvent()}});
      assert.equal(stranger.status,'rejected');
      // Iteration 05 commands: the reviewed QQ gate on the installed I/O command router.
      const {commandGate,qqCommand}=await import(pathToFileURL(config.qqFixture+'/dist/gateway/middleware-setup.js').href);
      const router=plainConversation.openCommands({prefixes:['/']});let stops=0;
      router.register(qqCommand({name:'stop',hidden:true,handler:()=>{stops++;return '已中止';}}));
      const gate=commandGate(router),replies=[];
      const cmd=(id,content,sender='synthetic-owner')=>({message:{kind:'c2c',senderId:sender,messageId:id,content},state:{},replyTarget:{scope:'c2c',targetId:sender,msgId:id},bot:{sendText:async(_t,c)=>replies.push(c)},log:logger,stop(r){this.stopped=r;}});
      const through=async c=>{let passed=false;await gate(c,async()=>{passed=true;});return passed;};
      const first=cmd('synthetic-cmd-1','/stop');assert.equal(await through(first),false);assert.equal(first.stopped,'command:handled:stop');assert.equal(stops,1);assert.deepEqual(replies,['已中止']);
      const commandInputs=()=>Array.from({length:base.session.seq},(_,i)=>base.session.eventAt(i)).filter(e=>e?.type==='user/message'&&JSON.stringify(e.data).includes('/stop'));
      const redelivered={...qqEvent(),message:{...qqEvent().message,messageId:'synthetic-cmd-1',content:'/stop'}};
      await handleInbound(redelivered,logger,channel);await sleep(100);assert.equal(commandInputs().length,0,'the claimed command is a duplicate for the chat channel: no native input');
      const again=cmd('synthetic-cmd-1','/stop');await through(again);assert.equal(again.stopped,'command:duplicate');assert.equal(stops,1);
      const outsider=cmd('synthetic-cmd-2','/stop','stranger');await through(outsider);assert.equal(outsider.stopped,'command:rejected');assert.equal(stops,1);
      assert.equal(await through(cmd('synthetic-cmd-3','/unknown-probe')),true,'unknown commands stay ordinary chat');
      report.checks.push('Installed dsh-agent-io command router behind the reviewed QQ gate: /stop runs once and never becomes native input, a re-delivery is a duplicate, strangers and unknown commands are not run');
      // Inbound media: QQ attachments become I/O descriptors and the native input describes them.
      const withImage={...qqEvent(),message:{...qqEvent().message,messageId:'synthetic-inbound-media',content:'看图',attachments:[{content_type:'image/png',filename:'p.png',size:10,url:'https://example.invalid/p.png'}]}};
      await handleInbound(withImage,logger,channel);await base.whenIdle();await sleep(100);
      const mediaInput=Array.from({length:base.session.seq},(_,i)=>base.session.eventAt(i)).filter(e=>e?.type==='user/message'&&JSON.stringify(e.data).includes('看图'));
      assert.equal(mediaInput.length,1);const mediaText=JSON.stringify(mediaInput[0].data);
      assert(mediaText.includes('[图片]')&&mediaText.includes('Image: https://example.invalid/p.png'),'the model-visible body describes the attachment');
      // Outbound media: qqbot_send_file on a real file through the installed I/O and the reviewed adapter.
      const {registerSendFileTool}=await import(pathToFileURL(config.qqFixture+'/dist/media/send-file-tool.js').href);
      const defs=[];plainManager.findByAgent=agent=>agent===base?plainRecord:undefined;
      registerSendFileTool({get:n=>n==='tools'?{register:d=>defs.push(d)}:undefined},null,plainManager,mediaConfig,logger);
      const tool=defs.find(d=>d.name==='qqbot_send_file'),png=path.join(mediaConfig.cwd,'chart.png');fs.writeFileSync(png,'synthetic-png');
      const out=await tool.execute({file_path:png},{agent:base});
      assert.deepEqual([out.fileName,out.fileUuid,out.target],['chart.png','synthetic-uuid','c2c:synthetic-owner']);
      assert.deepEqual(mediaCalls.map(c=>c.stage),['upload','message']);assert.equal(mediaCalls[0].srvSendMsg,false);assert.equal(mediaCalls[0].path,fs.realpathSync(png));
      assert(ids.some(id=>/^qq:.+:file:[0-9a-f]{16}$/.test(id??'')),'stable logical id of the file message');
      await tool.execute({file_path:png},{agent:base});assert.equal(mediaCalls.length,2,'the same file in the same Turn is not resent');
      await assert.rejects(tool.execute({file_path:png,target:'c2c:someone-else'},{agent:base}),/current conversation/);
      const outsideFile=path.join(config.cwd,'outside-probe.txt');fs.writeFileSync(outsideFile,'x');
      await assert.rejects(tool.execute({file_path:outsideFile},{agent:base}),/不在允许的目录内/);assert.equal(mediaCalls.length,2);
      const remote=await io.sendMessage({target:plainConversation.target(plainRecord),origin:{sessionId:base.id},message:{attachments:[{kind:'image',resource:{type:'remote',url:'https://example.invalid/x.png'}}]}});
      assert.deepEqual([remote.status,remote.reason],['not-sent','unsupported']);
      report.checks.push('Installed dsh-agent-io basic media: QQ attachments reach the native input as descriptors; qqbot_send_file sends a real whitelisted file once through the I/O (upload, then media message), other targets, outside paths and remote resources are refused');report.media='exercised';
      // Iteration 06 HITL Bridge: the native Approval service and userQuestions.ask() of
      // the real Host reach the installed Bridge through their own waterfalls; prompts
      // go out through the installed I/O and only the expected person's answer settles them.
      {
       const approval=ctx.get('approval'),questions=ctx.get('userQuestions');
       assert(typeof approval?.decide==='function'&&typeof questions?.ask==='function','native Approval and userQuestions services');
       const {openQQHITL}=await import(pathToFileURL(config.qqFixture+'/dist/gateway/bootstrap.js').href);
       const hitl=openQQHITL(plainConversation,{...plainConfig,askTimeoutMs:60_000,requireMention:true},logger);plainManager.hitl=hitl;
       const keyboardOf=m=>m.keyboard.content.rows.flatMap(r=>r.buttons).map(b=>b.action.data);
       // A request the Bridge does not take: still open after a while, then cancelled natively.
       const nativeWait=async agent=>{
        const stop=new AbortController(),ask=questions.ask({agent,questions:[{id:'n',question:'native'}],signal:stop.signal}).then(()=>'answered',e=>e?.code),decided=approval.decide({agent,toolName:'probe_tool',signal:stop.signal},agent.session);
        const state=await Promise.race([ask,decided.then(o=>'decided:'+o),sleep(500).then(()=>'pending')]);
        stop.abort();assert.equal(await ask,'ASK_ABORTED');return [state,await decided];
       };
       const press=(data,user='synthetic-owner')=>{const response=hitlResponse({user_openid:user,data:{resolved:{button_data:data}}});return response?hitl.respond(response).status:'not-hitl';};
       try{
        let before=plainSent.length;
        const allowed=approval.decide({agent:base,toolName:'probe_tool',reason:'probe'},base.session);await sleep(100);
        const prompt=plainSent.at(-1);assert.equal(plainSent.length,before+1);assert.match(prompt.text,/执行审批[\s\S]*probe_tool/);
        const [allow,deny]=keyboardOf(prompt);
        assert.equal(press(allow,'stranger'),'rejected','a stranger is another Conversation');
        assert.equal(press(allow),'accepted');assert.equal(await allowed,'allowed-once');assert.equal(press(deny),'rejected','one decision only');
        const denied=approval.decide({agent:base,toolName:'probe_tool'},base.session);await sleep(100);
        assert.equal(press(keyboardOf(plainSent.at(-1))[1]),'accepted');assert.equal(await denied,'rejected');
        // userQuestions.ask() on the live root Agent: a button, then a typed answer claimed in the inbound scope.
        before=plainSent.length;
        const answered=questions.ask({agent:base,questions:[{id:'pick',question:'选哪个',options:[{label:'甲'},{label:'乙'}]},{id:'note',question:'备注'}]});await sleep(100);
        assert.equal(press(keyboardOf(plainSent[before])[1]),'accepted');await sleep(100);
        assert.equal(plainSent[before+1].keyboard,undefined,'a free-text question has no buttons');
        const typed={conversation:{type:'direct',id:'synthetic-owner'},sender:{id:'synthetic-owner'},message:{id:'synthetic-hitl-answer',text:'下午'}};
        assert.equal(hitl.answer(typed).status,'answered');assert.equal(hitl.answer(typed).status,'pass','nothing open any more');
        assert.deepEqual(JSON.parse(JSON.stringify(await answered)),{answers:[{id:'pick',selected:['乙']},{id:'note',selected:[],custom:'下午'}]});
        const redelivered=await channel.receive({conversation:{type:'direct',id:'synthetic-owner'},message:{id:'synthetic-hitl-answer',text:'下午'},sender:{id:'synthetic-owner'},platformData:{context:qqEvent()}});
        assert.equal(redelivered.status,'duplicate','the claimed answer never becomes native input');
        const stop=new AbortController(),aborted=questions.ask({agent:base,questions:[{id:'x',question:'中止测试'}],signal:stop.signal});await sleep(50);stop.abort();
        await assert.rejects(aborted,e=>e?.name==='UserQuestionError'&&e.code==='ASK_ABORTED');
        assert.equal(hitl.waiting(plainRecord),false);
        // Another live Agent is not this Bridge's: its requests stay with the native
        // answerers (waiting for a Web/Desktop client, none connected here) and send nothing to QQ.
        before=plainSent.length;
        assert.deepEqual(await nativeWait(full),['pending','cancelled']);
        assert.equal(plainSent.length,before,'nothing of another Agent reaches QQ');
        report.checks.push('Installed dsh-agent-io HITL Bridge on the real Host: native approval decide() and userQuestions.ask() reach it through their own waterfalls; prompts and buttons go through the I/O; only the owner settles a request, once; button and typed answers, abort and another Agent stay native');report.hitl='exercised';
       }finally{hitl?.close();plainManager.hitl=undefined;}
       const after=plainSent.length;
       assert.deepEqual(await nativeWait(base),['pending','cancelled'],'after close the native answerers own the requests again');
       assert.equal(plainSent.length,after);
      }
      // Iteration 07 Notification: the installed Agent I/O notifier and the real Character
      // Outbox (temporary SQLite) behind the reviewed QQ adapter on the real Host.
      {
       const notifier=plainConversation.openNotifications();assert(notifier&&typeof notifier.send==='function','installed dsh-agent-io offers openNotifications');
       const historic=await io.sendMessage({target:plainConversation.target(plainRecord),origin:{sessionId:'historical-session'},message:{text:'旧会话聊天'}});
       assert.deepEqual([historic.status,historic.reason],['not-sent','stale'],'chat keeps the current-Session check');
       const owner={type:'direct',id:'synthetic-owner'};let before=plainSent.length;
       const ok=await notifier.send({id:'probe-notify-1',conversation:owner,text:'[提醒到期] probe',authorize:t=>t.type==='direct'&&t.id==='synthetic-owner'});
       assert.equal(ok.status,'sent');assert.deepEqual(plainSent.slice(before),[{text:'[提醒到期] probe',msgId:undefined,notification:true,targetId:'synthetic-owner'}],'stable target, no Session');
       assert.equal((await notifier.send({id:'probe-notify-2',conversation:owner,text:'x',authorize:()=>false})).reason,'unauthorized');
       assert.equal((await notifier.send({id:'probe-notify-3',conversation:{type:'direct',id:'stranger'},text:'x',authorize:()=>true})).reason,'unauthorized','Gateway admission still applies');
       const forged=await io.sendMessage({target:plainConversation.target(plainRecord),origin:{notification:{authorize:()=>true,closed:()=>false}},message:{text:'伪造通知'}});
       assert.deepEqual([forged.status,forged.reason],['not-sent','unauthorized']);
       // The real Outbox state machine on the real notifier.
       const {createOutbox}=await import(new URL('../packages/character-identity/outbox.mjs',import.meta.url).href);
       const {DatabaseSync}=await import('node:sqlite');
       const dbFile=path.join(config.cwd,'outbox-probe.sqlite'),db=new DatabaseSync(dbFile);
       db.exec("CREATE TABLE outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,conversation TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL);CREATE TABLE identity_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);");
       db.prepare("INSERT INTO outbox VALUES('crashed','task_completed','qq-probe','interrupted','sending',?)").run(new Date().toISOString());
       const outbox=createOutbox({db,key:dbFile});await outbox.ready;
       for(const [id,text] of [['ok','notify-ok'],['lost','notify-timeout']])outbox.enqueue({eventId:id,kind:'task_completed',text,conversation:'qq-probe'});
       before=plainSent.length;
       const opts={notifier,conversation:'qq-probe',target:owner,eligible:()=>true,authorize:(_row,_src,t)=>t.id==='synthetic-owner'};
       await outbox.pump(opts);await outbox.pump(opts);
       const statuses=Object.fromEntries(db.prepare('SELECT id,status FROM outbox').all().map(r=>[r.id,r.status]));
       assert.deepEqual(statuses,{crashed:'unknown',ok:'sent',lost:'unknown'},'interrupted → unknown, sent, timed out → unknown');
       assert.deepEqual(plainSent.slice(before).map(m=>m.text),['notify-ok'],'unknown and interrupted rows are never resent');
       await outbox.close();
       // Keep this installed I/O and its result cache alive while only Outbox
       // reloads. A proven-unsent result must not poison the next owner's id.
       let admitted=false;const retryOpts={...opts,authorize:()=>admitted};
       const retry=createOutbox({db,key:dbFile});retry.enqueue({eventId:'hmr-retry',kind:'task_completed',text:'notify-hmr-retry',conversation:'qq-probe'});
       await retry.pump(retryOpts);assert.equal(retry.status('hmr-retry'),'pending');await retry.close();
       admitted=true;const next=createOutbox({db,key:dbFile});await next.pump(retryOpts);
       assert.equal(next.status('hmr-retry'),'sent');assert.equal(plainSent.filter(m=>m.text==='notify-hmr-retry').length,1,'real I/O cache retained across Outbox HMR');
       await next.close();db.close();notifier.close();
       report.checks.push('Installed dsh-agent-io notifier on the real Host: stable-target notification without a current Session, authority and Gateway admission per part, forged grant refused, chat stays Session-checked; the real Character Outbox records sent/unknown and never resends an interrupted or unknown row');report.notifications='exercised';
      }
     }finally{channel.close();}
     report.checks.push('Installed dsh-agent-io inbound: a QQ event becomes one native input through the shared Conversation handoff and its reply goes out through the I/O; duplicate push and stranger add nothing');report.inbound='exercised';
    }
   }finally{releasePlain?.();releaseAdapter();plainConversation.close();}
   report.ok=true;
  }catch(e){report.ok=false;report.error=e.stack;}finally{releaseTool();releaseOutbound?.();releaseInteractionAdapter?.();conversation?.close();for(const h of handles)await h.dispose().catch(()=>{});resolver?.deregister();fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
