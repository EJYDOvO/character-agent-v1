// Native Host + actual Gateway/middleware/I/O/Manager/Identity; synthetic QQ and LLM.
import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['agents','agentPresets','agentIO','conversationManager','llm'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function apply(ctx,config){
 class Fixture extends LlmAdapter{async *stream(){yield {type:'text-delta',index:0,text:'嗯，通信链路正常。'};yield {type:'finish',reason:{kind:'stop'}};}}
 ctx.llm.registerAdapter(['communication-fixture'],new Fixture());
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1200);return()=>clearTimeout(timer);});
 async function run(){
  const report={ok:false,runId:config.runId,host:config.version,provenance:config.provenance,generic:config.generic,qqNetwork:false,realModel:false,checks:[]},forks=[],rows=[];
  const stop=ctx.agentIO.diagnostics.subscribe(row=>rows.push(row));
  try{
   const qq=pathToFileURL(config.qqFixture+'/dist/').href;
   const {bootstrapGateway}=await import(qq+'gateway/bootstrap.js'),{QQBot,instances}=await import(qq+'gateway/synthetic-bot.mjs'),{ConfigSchema}=await import(qq+'config.js');
   const activate=config.generic?undefined:(await import('../packages/character-qq-adapter/lifecycle.mjs')).activate;
   if(config.generic)assert.equal(ctx.get('characterIdentity'),undefined,'ordinary QQ fixture must have no Character Identity');
   else{const ops=await import(pathToFileURL(config.toolkit+'/plugin-sources/dsh-remote-ops/index.js').href);forks.push(await ctx.plugin(ops,{stateDirectory:config.cwd+'/ops',ownerId:'mock-owner'}));}
   for(const disabled of [false,true]){
    if(disabled&&!config.generic){await forks.shift().dispose();assert.equal(ctx.get('qqRemoteOps'),undefined,'Character must work after Remote Ops unload');}
    const settings=ConfigSchema({appId:'mock-app',appSecret:'synthetic-not-a-credential',provider:'communication-fixture',model:'fixture',preset:config.generic?'cordis':'qq-character',cwd:config.cwd,access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'},debug:false,media:{enabled:false},vision:{enabled:false},hitl:{enabled:!disabled},notifications:{enabled:!disabled}});
    let runtime,stage='registered';
    const module={name:'synthetic-qq-gateway',inject:['agents','agentIO','conversationManager'],async apply(gateway){
     stage='applying';
     if(config.generic)await bootstrapGateway(gateway,gateway.agents,settings,gateway.logger);
     else await activate(gateway,settings,(inner,c,options)=>bootstrapGateway(inner,inner.agents,c,inner.logger,options));
     stage='bootstrapped';runtime=gateway.get('qqGateway');stage=runtime?'active':'missing-service';
    }};
    const fork=await ctx.plugin(module,{});forks.push(fork);
    for(let i=0;i<200&&!runtime;i++){await sleep(25);runtime=ctx.get('qqGateway');}assert(runtime,'Gateway must become active: '+stage);
    const bot=instances.at(-1);assert(bot instanceof QQBot);
    const previous=await runtime.manager.getOrCreate('c2c','mock-owner','mock-owner',{scope:'c2c',targetId:'mock-owner'});
    const inputCount=agent=>agent.session.snapshotEvents().filter(e=>e.type==='user/message'&&(e.data?.message??e.data)?.source?.kind==='user').length;
    const previousCount=inputCount(previous.agent);
    const input={kind:'c2c',senderId:'mock-owner',senderIsBot:false,messageId:'message-'+disabled,content:'hello communication',attachments:[]};
    const received=await bot.push(input);assert.deepEqual(received.testErrors,[]);
    const record=runtime.manager.getSessionRecord('c2c','mock-owner');assert(record);await record.agent.whenIdle();
    for(let i=0;i<100&&!bot.sent.some(t=>t.includes('通信链路正常'));i++)await sleep(20);
    assert(bot.sent.some(t=>t.includes('通信链路正常')),'native response must reach I/O and QQ Adapter');
    assert.equal(inputCount(record.agent),previousCount+1,'exactly one new native message; cold history stays intact');
    await bot.push(input);assert.equal(inputCount(record.agent),previousCount+1,'duplicate input creates no native message');
    if(!config.generic){
     const trusted=ctx.get('characterIdentity').forSession(record.sessionId);assert.equal(ctx.get('characterIdentity').latestInput(trusted).text,'hello communication','raw evidence comes from the trusted I/O hook, not the envelope');
     if(!disabled){const before=bot.sent.length;await bot.push({...input,messageId:'command-'+disabled,content:'/ops status'});assert(bot.sent.length>before,'command reply must use I/O');await ctx.get('characterIdentity').notifySystem({eventId:'qqtk:communication-probe',kind:'configured_alert',text:'synthetic notification',target:{scope:'c2c',targetId:'mock-owner'}});const count=bot.sent.filter(t=>t==='synthetic notification').length;await ctx.get('characterIdentity').notifySystem({eventId:'qqtk:communication-probe',kind:'configured_alert',text:'synthetic notification',target:{scope:'c2c',targetId:'mock-owner'}});assert.equal(count,1);assert.equal(bot.sent.filter(t=>t==='synthetic notification').length,1);}
     else assert.equal(runtime.manager.hitl,undefined,'HITL disabled leaves native requests unclaimed');
    }
    await fork.dispose();forks.pop();assert(bot.stopped);assert.equal(record.typingKeepAlive,undefined);assert.equal(runtime.manager.size,0);
    if(!config.generic)assert.throws(()=>ctx.get('characterIdentity').forSession(record.sessionId),'old Gateway handle must lose Memory authorization');
    report.checks.push((config.generic?'ordinary QQ, no Character':'Character + Interaction + Memory')+(disabled?' / Remote Ops absent, HITL and Notifications disabled':' / Remote Ops optional, HITL and Notifications enabled')+': native input/reply, dedup, teardown and permission fence');
   }
   assert(rows.some(r=>r.component==='conversation'&&r.event==='input'));assert(rows.some(r=>r.component==='io'&&r.event==='part'&&r.status==='sent'));
   if(!config.generic){const event=rows.find(r=>r.component==='notification'&&r.event==='send');assert(event);assert(rows.some(r=>r.component==='io'&&r.event==='send'&&r.logical===event.logical&&r.status==='sent'),'redacted Outbox and physical I/O events correlate');}
   assert(!JSON.stringify(rows).includes('mock-owner'));assert(!JSON.stringify(rows).includes('hello communication'));
   report.diagnosticEvents=rows.length;report.checks.push('redacted cross-module diagnostics reconstruct real Host I/O without bodies or raw identities');report.ok=true;
  }catch(error){report.error=error.stack;}finally{for(const f of forks.reverse())await f.dispose().catch(()=>{});stop();fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
