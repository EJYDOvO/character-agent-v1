import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import sourceDigest from '../scripts/source-digest.cjs';
import {managerFixture} from './qq-manager-fixture.mjs';
export const name='character-test-probe';export const inject=['agents','agentPresets','tools','characterIdentity','characterMemory'];
export function apply(ctx,config){
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1500);return()=>clearTimeout(timer);});
 async function run(){const handles=[];const report={ok:false,at:new Date().toISOString(),sourceDigest:sourceDigest(),checks:[]};try{
   const create=async preset=>{const h=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd:config.cwd,agentPreset:preset},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});handles.push(h);return h.agent;};
   report.profileBundles=JSON.parse(fs.readFileSync(process.env.DSH_HOME+'/profiles/character-test/package.json','utf8')).dsh.profile.bundles;
   const creator=await create('cordis'),character=await create('qq-character');
   const base=[...ctx.tools.view(creator).visible.keys()],actual=[...ctx.tools.view(character).visible.keys()];
   assert.deepEqual(base.filter(n=>!actual.includes(n)),[]);assert(actual.includes('character_remember'));report.checks.push('Creator tool registry parity');report.tools={creator:base,character:actual};
   const identity=ctx.get('characterIdentity');const deliveries=[],manager=managerFixture();
   const release=identity.attach({manager,config:{appId:'mock-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}},sender:{sendMarkdown:async(t,text)=>deliveries.push({target:t.scope,text})}});
   const bind=async agent=>{manager.commit({sessionId:agent.session.header.id,agent,agentPreset:'qq-character',scope:'c2c',peerId:'mock-owner',senderId:'mock-owner'});await manager.getOrCreate('c2c','mock-owner','mock-owner',{scope:'c2c',targetId:'mock-owner'});};await bind(character);
   const call=async(agent,name,args)=>JSON.parse(await ctx.tools.get(name,agent).execute(args,{agent}));
   const row=await call(character,'character_remember',{kind:'semantic',statement:'集成测试偏好：中文短报告 '+character.id});assert.equal(row.status,'uncertain');
   const second=await create('qq-character');await bind(second);assert((await call(second,'character_recall',{query:'中文短报告'})).some(m=>m.id===row.id));report.checks.push('Real preset tools cross-session memory');
   // Unconfirmed manual inference is not stable L3. Admit a separate synthetic
   // Host fact to verify native prompt injection under the new consumption policy.
   const contextFact=ctx.characterMemory.remember(identity.forSession(second.id),{kind:'semantic',statement:'隔离上下文事实：报告使用中文 '+second.id},{sessionId:second.id,eventSeq:1,messageId:'context:'+second.id,origin:'direct_user'});
   const prompt=await second.ctx.systemPrompt.assemble({agent:second,scope:second});assert(JSON.stringify(prompt).includes(contextFact.statement));report.checks.push('Scoped cross-session L3 context injection');
   await assert.rejects(()=>call(character,'character_recall',{query:''}),/not bound|Historical/);await bind(character);
   await assert.rejects(()=>call(character,'character_correct',{id:row.id,statement:'已纠正',revision:0}),/conflict/);
   const corrected=await call(character,'character_correct',{id:row.id,statement:'集成测试偏好：详细报告 '+character.id,revision:1});assert.equal(corrected.revision,2);
   await call(character,'character_forget',{id:row.id,revision:2});assert(!(await call(character,'character_recall',{query:'详细报告'})).some(m=>m.id===row.id));report.checks.push('Real tool CAS and forget');
   const stranger=await create('qq-character');await assert.rejects(()=>call(stranger,'character_recall',{query:''}),/not bound/);report.checks.push('Unbound agent denied');
   const trusted=identity.forSession(character.session.header.id);const job=ctx.get('characterMemory').enqueue(trusted,{sessionId:character.session.header.id,eventSeq:100,origin:'direct_user',messageId:'probe-'+character.id,text:'每次验收我都会先看错误栈，再检查回滚记录。'});assert(job);report.checks.push('Durable admitted-evidence queue (LLM tested separately)');
   const execution={agent:character,signal:new AbortController().signal};
   const reminder=await ctx.tools.get('schedule_create',character).execute({title:'Character integration cancellation',prompt:'[测试] 不应触发的提醒',after_seconds:86400},execution);
   assert(reminder.id,JSON.stringify(reminder));
   await ctx.tools.get('schedule_delete',character).execute({id:reminder.id},execution);
   const remaining=await ctx.tools.get('schedule_list',character).execute({},execution);assert(!remaining.some(x=>x.id===reminder.id));report.checks.push('Native Schedule create and cancellation');
   await identity.notify(trusted,{eventId:'probe:'+character.id,kind:'task_completed',text:'[隔离测试] 完成'});await identity.notify(trusted,{eventId:'probe:'+character.id,kind:'task_completed',text:'[隔离测试] 完成'});assert.equal(deliveries.length,1);report.checks.push('Host notification ledger dedup');
   await ctx.tools.get('schedule_create',character).execute({title:'Isolated due event',prompt:'[隔离通知测试] 仅回复测试完成',after_seconds:1},execution);
   const deadline=Date.now()+15000;while(Date.now()<deadline&&!deliveries.some(x=>x.text.startsWith('[提醒到期]')))await new Promise(r=>setTimeout(r,250));
   assert(deliveries.some(x=>x.text.startsWith('[提醒到期]')),'Native schedule event did not reach outbox');report.checks.push('Native Schedule due event -> durable outbox -> isolated sender');
   release();assert.throws(()=>identity.forSession(character.id));report.checks.push('Gateway detach revokes contexts');report.ok=true;
 }catch(e){report.error=e.stack;}finally{for(const h of handles)await h.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}}
}
