// Actual native Host/Agent loop, deterministic provider and synthetic transport.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
const sdk=process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const {LlmAdapter,createUserMessage}=await import(pathToFileURL(sdk+'dsh-llm/lib/index.js').href);
const {defineTool}=await import(pathToFileURL(sdk+'dsh-tools/lib/index.js').href);
export const name='interaction-host-probe';export const inject=['agents','agentPresets','llm','tools'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function apply(ctx,config){
 let toolStarted=false,toolAborted=false,releaseTool;const toolGate=new Promise(r=>releaseTool=r);
 class Provider extends LlmAdapter{async *stream(request){
  const users=request.messages.filter(m=>m.role==='user'),text=JSON.stringify(users.at(-1)?.content??[]);
  if(text.includes('tool-case')&&!request.messages.some(m=>m.role==='tool')){
   yield {type:'text-delta',index:0,text:'嗯，我先检查。'};
   yield {type:'tool-call-delta',index:1,id:'fixture-call',name:'interaction_fixture',argumentsDelta:'{}'};
  }else{
   if(text.includes('slow-case'))await sleep(100);
   yield {type:'text-delta',index:0,text:'嗯，今天还不错。'};await sleep(20);
   yield {type:'text-delta',index:0,text:'咖啡机终于修好了。'};
  }
  yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['interaction-fixture'],new Provider());
 ctx.tools.register(defineTool({name:'interaction_fixture',description:'Isolated synthetic tool',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(_a,{signal}){toolStarted=true;signal.addEventListener('abort',()=>toolAborted=true,{once:true});await toolGate;return 'fixture-result';}}));
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),700);return()=>clearTimeout(timer);});
 async function run(){const handles=[],report={ok:false,runId:config.runId,host:'0.2.1-rc.2',provider:'deterministic-fixture',qqNetwork:false,checks:[]};let resolver,releaseOutbound;
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
   const fixtureUrl=pathToFileURL(config.qqFixture+'/').href,official=pathToFileURL(process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/package.json').href,installed=pathToFileURL(process.env.DSH_INSTALL_ROOT+'/data/profiles/desktop/package.json').href;
   resolver=registerHooks({resolve(specifier,context,next){if(context.parentURL?.startsWith(fixtureUrl)&&!specifier.startsWith('.')&&!specifier.startsWith('node:')&&!specifier.startsWith('file:'))return next(specifier,{...context,parentURL:specifier.startsWith('@deepseek-ai/')?official:installed});return next(specifier,context);}});
   const {createInteractionOutbound}=await import(pathToFileURL(config.qqFixture+'/dist/gateway/bootstrap.js').href);
   const {setupMiddlewares}=await import(pathToFileURL(config.qqFixture+'/dist/gateway/middleware-setup.js').href);
   const sent=[],bubbles=[],record={sessionKey:'fixture',agent:a,replyTarget:{scope:'c2c',targetId:'synthetic-owner',msgId:'synthetic-message'}};
   const manager={ctx,findBySessionId:id=>id===a.id?record:undefined,getSessionRecord:()=>record,approvalChannel:{pending:new Map()},questionChannel:{pending:new Map()}};
   const logger={debug(){},info(){},warn(){},error(){}};
   const sender={async sendMarkdown(_target,t){sent.push({t});},openStream(){const row={text:'',done:false};bubbles.push(row);return {async update(t){row.text=t;},async complete(){row.done=true;}};}};
   releaseOutbound=ctx.on('session/event',createInteractionOutbound(ctx,manager,sender,{streaming:true,textChunkLimit:3500,showToolResults:false},logger,ctx.tools));
   const middleware=[];setupMiddlewares({use:m=>middleware.push(m)},{access:{c2cMode:'allowlist',c2cAllow:['synthetic-owner'],groupMode:'disabled',groupAllow:[]},historyLimit:10,media:{enabled:false}},manager,logger);
   let admitted=false;await middleware[2]({message:{kind:'c2c',senderId:'stranger'},log:logger,stop(){}},async()=>{admitted=true;});assert(!admitted);
   report.checks.push('Actual modified QQ outbound and middleware load with real SDK; outsider blocked without a gateway');
   const send=async text=>{a.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await a.whenIdle();await p.idle();};
   await send('chat-case');assert.deepEqual(bubbles.map(b=>b.text),['嗯，今天还不错。','咖啡机终于修好了。']);assert(bubbles.every(b=>b.done));assert(!sent.length);
   report.checks.push('Actual native assistant-stream frames produce ordered bubbles, durable settlement does not duplicate');
   await send('slow-case');assert.equal(sent.filter(x=>x.t==='还在处理中，稍等一下。').length,1);
   assert(!JSON.stringify(Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i))).includes('还在处理中，稍等一下。'));
   report.checks.push('Real running loop delay produces one status outside Session history');
   a.followup(createUserMessage({content:[{type:'text',text:'tool-case'}],source:{kind:'user'}}));
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
   report.ok=true;
  }catch(e){report.ok=false;report.error=e.stack;}finally{releaseTool();releaseOutbound?.();for(const h of handles)await h.dispose().catch(()=>{});resolver?.deregister();fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
