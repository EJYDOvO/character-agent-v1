import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
export const name='character-test-probe';export const inject=['agents','agentPresets','tools','characterIdentity','characterMemory'];
export function apply(ctx,config){
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1500);return()=>clearTimeout(timer);});
 async function run(){const handles=[];const report={ok:false,checks:[]};try{
   const create=async preset=>{const h=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd:config.cwd,agentPreset:preset},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});handles.push(h);return h.agent;};
   const creator=await create('cordis'),character=await create('qq-character');
   const base=[...ctx.tools.view(creator).visible.keys()],actual=[...ctx.tools.view(character).visible.keys()];
   assert.deepEqual(base.filter(n=>!actual.includes(n)),[]);assert(actual.includes('character_remember'));report.checks.push('Creator tool registry parity');report.tools={creator:base,character:actual};
   const identity=ctx.get('characterIdentity');const bind=agent=>identity.identity.bind({appId:'mock-app',scope:'c2c',senderId:'mock-owner',peerId:'mock-owner',sessionId:agent.session.header.id});bind(character);
   const call=async(agent,name,args)=>JSON.parse(await ctx.tools.get(name,agent).execute(args,{agent}));
   const row=await call(character,'character_remember',{kind:'semantic',statement:'集成测试偏好：中文短报告 '+character.id});assert.equal(row.status,'uncertain');
   const second=await create('qq-character');bind(second);assert((await call(second,'character_recall',{query:'中文短报告'})).some(m=>m.id===row.id));report.checks.push('Real preset tools cross-session memory');
   await assert.rejects(()=>call(character,'character_correct',{id:row.id,statement:'已纠正',revision:0}),/conflict/);
   const corrected=await call(character,'character_correct',{id:row.id,statement:'集成测试偏好：详细报告 '+character.id,revision:1});assert.equal(corrected.revision,2);
   await call(character,'character_forget',{id:row.id,revision:2});assert(!(await call(second,'character_recall',{query:'详细报告'})).some(m=>m.id===row.id));report.checks.push('Real tool CAS and forget');
   const stranger=await create('qq-character');await assert.rejects(()=>call(stranger,'character_recall',{query:''}),/not bound/);report.checks.push('Unbound agent denied');
   const trusted=identity.forSession(character.session.header.id);ctx.get('characterMemory').capture(trusted,character.session.header.id,100,'我喜欢稳定的验收流程');assert((await call(second,'character_recall',{query:'验收流程'})).length);report.checks.push('Automatic extraction and recall');
   const execution={agent:character,signal:new AbortController().signal};
   const reminder=await ctx.tools.get('schedule_create',character).execute({title:'Character integration cancellation',prompt:'[测试] 不应触发的提醒',after_seconds:86400},execution);
   assert(reminder.id,JSON.stringify(reminder));
   await ctx.tools.get('schedule_delete',character).execute({id:reminder.id},execution);
   const remaining=await ctx.tools.get('schedule_list',character).execute({},execution);assert(!remaining.some(x=>x.id===reminder.id));report.checks.push('Native Schedule create and cancellation');
   report.ok=true;
 }catch(e){report.error=e.stack;}finally{for(const h of handles)await h.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}}
}
