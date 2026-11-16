// Native Host with the character manager wiring (runtime persona for Owner,
// Contact and Guest; Identity, Memory and Conversation state behind the
// character-current link; role grants in data/account), the actual QQ
// Gateway/middleware, Agent I/O, Conversation Manager, Character Identity and
// Identity & Access; synthetic QQ transport and LLM only.
// Phase 1 runs as character A, phase 2 (a new Host process) as character B
// after stage-character-manager.cjs --phase2 moved the link.
// It is not QQ network delivery, a real model or the watchdog switch.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {NEUTRAL_PERSONA,readCompiled,writeJsonAtomic} from '../packages/character-manager/compiled.mjs';
import {approvePublic} from '../packages/character-manager/compile.mjs';
export const inject=['agents','agentPresets','agentIO','conversationManager','llm','tools','sessions','schedule'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const noYaml=()=>{throw Error('JSON cards only');};
// Text the Host must pass through verbatim: single braces and replacement patterns are not macros.
const HOT={prefix:'HOT_PREFIX_MARK：热更新后的开头 {single} $& $1',suffix:'HOT_SUFFIX_MARK：热更新后的结尾',reminder:'HOT_REMINDER_MARK：热更新后的末尾提醒'};
const REMINDER_PROMPT='A_SCHEDULED_REMINDER_MARK';
const MEMORY='A_PRIVATE_MEMORY_MARK 只属于 Ayla 的记忆';
export function apply(ctx,config){
 // Every model request: the system prompt, the whole request and how many tools it offered.
 const requests=[];
 class Fixture extends LlmAdapter{async *stream(request){
  // The system prompt is the system message DSH assembled (persona sections, rules, contexts).
  const system=(request.messages??[]).filter(m=>m.role==='system').flatMap(m=>Array.isArray(m.content)?m.content:[{type:'text',text:m.content}]).map(b=>b.text??'').join('\n');
  requests.push({system,body:JSON.stringify(request),tools:(request.tools??[]).length});
  yield {type:'text-delta',index:0,text:'reply '+requests.length};yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['character-manager-fixture'],new Fixture());
 // Cold resumes per Session: every attempt (prepended) and those Identity let through (see lifecycle-host).
 const resumes={attempted:new Map(),accepted:new Map()},count=(map,id)=>map.get(id)??0;
 ctx.on('agent/created',({agent,source})=>{if(source==='resume')resumes.attempted.set(agent.id,count(resumes.attempted,agent.id)+1);},true);
 ctx.on('agent/created',({agent,source})=>{if(source==='resume')resumes.accepted.set(agent.id,count(resumes.accepted,agent.id)+1);});
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1200);return()=>clearTimeout(timer);});
 async function run(){
  const phase=config.phase,report={ok:false,runId:config.runId,host:config.version,phase,qqNetwork:false,realModel:false,checks:[],scenarios:{}},forks=[];
  const scenario=(id,text)=>{report.scenarios[id]='pass';report.checks.push(text);};
  try{
   const qq=pathToFileURL(config.qqFixture+'/dist/').href;
   const {bootstrapGateway}=await import(qq+'gateway/bootstrap.js'),{instances}=await import(qq+'gateway/synthetic-bot.mjs'),{ConfigSchema}=await import(qq+'config.js');
   const {activate}=await import('../packages/character-qq-adapter/lifecycle.mjs');
   const access=await import(pathToFileURL(config.toolkit+'/plugin-sources/dsh-identity-access/index.mjs').href);
   forks.push(await ctx.plugin(access,{stateFile:config.account+'/identity-access.json',ownerFile:config.account+'/identity-owner.json',legacyOwnerPresets:['qq-character']}));
   for(let i=0;i<100&&!ctx.get('identityAccess');i++)await sleep(20);assert(ctx.get('identityAccess'));
   const settings=ConfigSchema({appId:'mock-app',appSecret:'synthetic-not-a-credential',provider:'character-manager-fixture',model:'fixture',preset:'character',cwd:config.cwd,access:{c2cMode:'allowlist',c2cAllow:['mock-owner','mock-friend','mock-stranger','mock-visitor'],groupMode:'disabled'},identityAccess:{enabled:true},debug:false,media:{enabled:false},vision:{enabled:false},hitl:{enabled:true},notifications:{enabled:true}});
   let runtime;
   forks.push(await ctx.plugin({name:'synthetic-qq-gateway',inject:['agents','agentIO','conversationManager'],async apply(inner){await activate(inner,settings,(g,c,options)=>bootstrapGateway(g,g.agents,c,g.logger,options));runtime=inner.get('qqGateway');}},{}));
   for(let i=0;i<200&&!runtime;i++){await sleep(25);runtime=ctx.get('qqGateway');}assert(runtime,'Gateway must become active');
   const bot=instances.at(-1),manager=runtime.manager,identity=ctx.get('characterIdentity'),memory=ctx.get('dshMemory');
   let n=0;
   const say=async(sender,content,{expect=true}={})=>{
    const sent=bot.sent.length,asked=requests.length;
    const pushed=await bot.push({kind:'c2c',senderId:sender,senderIsBot:false,messageId:'m-'+(++n),content,attachments:[]});assert.deepEqual(pushed.testErrors,[]);
    const r=manager.getSessionRecord('c2c',sender);if(r)await r.agent.whenIdle();
    for(let i=0;i<200&&bot.sent.length===sent&&expect;i++)await sleep(20);if(!expect)await sleep(400);
    return {out:bot.sent.slice(sent),requests:requests.slice(asked)};
   };
   const record=peer=>manager.getSessionRecord('c2c',peer);
   const one=turn=>{assert.equal(turn.requests.length,1,'one model request per turn');return turn.requests[0];};
   const noTools=(peer,request)=>{assert.equal(request.tools,0,peer+' request offers no tools');assert.equal(ctx.tools.schemas(record(peer).agent).length,0,peer+' sees no tools');};
   const health=()=>JSON.parse(fs.readFileSync(config.current+'/runtime-health.json','utf8'));
   const phaseFile=config.cwd+'/character-manager-phase1.json';

   if(phase===1){
    assert.deepEqual({...health(),at:0},{pid:process.pid,characterId:'a',personaSource:'compiled',compiledRevision:2,at:0});
    // Owner of A: the Owner version, rendered with the Owner's name and relationship.
    let request=one(await say('mock-owner','hello'));const ownerSession=record('mock-owner').sessionId;
    assert.equal(record('mock-owner').agentPreset,'character');assert(request.tools>0,'the Owner keeps its tools');
    for(const mark of ['A_CARD_MARK','A_USERNAME','A_OWNER_REL','A_RULES_MARK'])assert(request.system.includes(mark),'Owner system prompt has '+mark);
    assert(request.body.includes('A_REMINDER_MARK'),'the Owner request carries the reminder');assert(!request.system.includes('A_PUBLIC_REL'));

    // 3. Public version: neutral while only pending, then exactly the approved text.
    request=one(await say('mock-friend','hello'));assert.equal(record('mock-friend').agentPreset,'character-guest');
    assert(request.system.includes(NEUTRAL_PERSONA),'pending only: the neutral persona');
    for(const mark of ['A_CARD_MARK','A_USERNAME','A_OWNER_REL','A_PUBLIC_REL','A_REMINDER_MARK'])assert(!request.body.includes(mark),'pending only: no '+mark);
    noTools('mock-friend',request);
    const pending=readCompiled(config.current+'/compiled.json',{characterId:'a'});assert(pending.pendingPublic&&!pending.public);
    approvePublic({dir:config.current,characterId:'a',parseYaml:noYaml,hash:pending.pendingPublic.hash});
    request=one(await say('mock-friend','hello again'));
    for(const mark of ['A_CARD_MARK','A_PUBLIC_REL','A_RULES_MARK','对方'])assert(request.system.includes(mark),'Guest system prompt has '+mark);
    for(const mark of ['A_USERNAME','A_OWNER_REL',NEUTRAL_PERSONA])assert(!request.body.includes(mark),'Guest request has no '+mark);
    assert(request.body.includes('A_REMINDER_MARK'),'the approved reminder reaches the Guest');noTools('mock-friend',request);
    scenario('public','Public version: Guest gets the neutral persona while A has only a pending public version, then A\'s approved public version without the Owner relationship or userName');

    // 4. Grants before the switch: mock-friend becomes Contact, mock-stranger is blocked.
    let out=(await say('mock-owner','/role list')).out.join('\n');const friend=/principal-[a-f0-9]{64}/.exec(out)?.[0];assert(friend,'the Owner sees the guest Principal');
    assert.match((await say('mock-owner','/role grant contact '+friend)).out.join('\n'),/ contact/);
    request=one(await say('mock-friend','hello as contact'));const contactSession=record('mock-friend').sessionId;assert.equal(record('mock-friend').agentPreset,'character-contact');
    assert(request.system.includes('A_PUBLIC_REL'));assert(!request.body.includes('A_OWNER_REL'));noTools('mock-friend',request);
    request=one(await say('mock-stranger','hello'));assert.equal(record('mock-stranger').agentPreset,'character-guest');noTools('mock-stranger',request);
    out=(await say('mock-owner','/role list')).out.join('\n');const stranger=[...out.matchAll(/principal-[a-f0-9]{64}/g)].map(m=>m[0]).find(p=>p!==friend);assert(stranger);
    await say('mock-owner','/role block '+stranger);assert.deepEqual((await say('mock-stranger','hello',{expect:false})).out,[]);

    // 2 (setup). A Guest who stays a Guest: its first Session has the id Conversation
    // Manager derives from the conversation key (nothing recorded); a new Session,
    // as /new makes it, records a fresh id in A's conversations.json.
    one(await say('mock-visitor','VISITOR_A_HISTORY_MARK 第一次'));assert.equal(record('mock-visitor').agentPreset,'character-guest');
    const visitorDerived=record('mock-visitor').sessionId;
    await manager.remove('c2c','mock-visitor');
    one(await say('mock-visitor','VISITOR_A_HISTORY_MARK 第二次'));const visitorSession=record('mock-visitor').sessionId;
    assert.notEqual(visitorSession,visitorDerived,'the visitor moved to a new Session');assert.equal(record('mock-visitor').agentPreset,'character-guest');

    // 1. Hot reload: an edit of compiled.json reaches the next request through the Host's own prompt assembly.
    const compiled=readCompiled(config.current+'/compiled.json',{characterId:'a'});
    writeJsonAtomic(config.current+'/compiled.json',{...compiled,owner:{prefix:HOT.prefix,suffix:HOT.suffix},reminder:HOT.reminder});
    request=one(await say('mock-owner','hello after edit'));
    assert(request.system.includes(HOT.prefix),'the new prefix verbatim in the system prompt');assert(request.system.includes(HOT.suffix),'the new suffix in the system prompt');
    // Earlier turns keep the reminder they were sent with in the Session history; the latest one is the new text.
    assert(request.body.lastIndexOf(HOT.reminder)>request.body.lastIndexOf('A_REMINDER_MARK'),'the new reminder is the current one');
    assert(!request.system.includes('A_OWNER_REL'),'the old Owner text is gone from the system prompt');
    assert.equal(record('mock-owner').sessionId,ownerSession,'the same Session, no restart');
    scenario('hotReload','Hot reload: rewriting compiled.json owner prefix/suffix/reminder changes the next request in the same Session; the text passes the Host prompt assembly verbatim');

    // 2 (setup). A memory and a reminder of A's Owner Session.
    await say('mock-owner','记住 '+MEMORY);
    const trusted=identity.forSession(ownerSession);
    memory.remember(trusted,{kind:'semantic',statement:MEMORY},{sessionId:ownerSession,eventSeq:1,messageId:'character-manager-memory',origin:'direct_user',quote:MEMORY});
    assert(JSON.stringify(memory.recall(identity.forSession(ownerSession),'A_PRIVATE_MEMORY_MARK')).includes('A_PRIVATE_MEMORY_MARK'),'A recalls its own memory');
    const reminder=await ctx.schedule.create({title:'A reminder',prompt:REMINDER_PROMPT,timing:{kind:'after',after_seconds:60},target:{kind:'session',sessionId:ownerSession}},ownerSession);
    fs.writeFileSync(phaseFile,JSON.stringify({ownerSession,contactSession,visitorDerived,visitorSession,friend,stranger,reminder:reminder.id,dueAt:Date.now()+60000}));
    report.checks.push('Switch setup: A memory remembered and recalled; A reminder due in 60 s on the Owner Session');
    report.ok=true;return;
   }

   // Phase 2: a new Host process whose link points at B.
   const previous=JSON.parse(fs.readFileSync(phaseFile,'utf8'));
   assert.deepEqual({...health(),at:0,compiledRevision:0},{pid:process.pid,characterId:'b',personaSource:'compiled',compiledRevision:0,at:0});
   // 2. Switch isolation: B's Owner Session, persona and memory.
   let request=one(await say('mock-owner','hello B'));const ownerSession=record('mock-owner').sessionId;
   assert.notEqual(ownerSession,previous.ownerSession,'the Owner enters a new Session');
   assert.equal(ownerSession,config.seededOwnerSession,'the Session prepared for B');
   for(const mark of ['B_CARD_MARK','B_USERNAME'])assert(request.system.includes(mark),'B Owner system prompt has '+mark);
   for(const mark of ['A_CARD_MARK','HOT_PREFIX_MARK','HOT_REMINDER_MARK','A_OWNER_REL','A_USERNAME'])assert(!request.body.includes(mark),'nothing of A: '+mark);
   const recalled=JSON.stringify([memory.recall(identity.forSession(ownerSession),'A_PRIVATE_MEMORY_MARK'),memory.recall(identity.forSession(ownerSession),'')]);
   assert(!recalled.includes('A_PRIVATE_MEMORY_MARK'),'B recalls nothing of A');
   assert.throws(()=>identity.forSession(previous.ownerSession),undefined,'A\'s Owner Session has no identity under B');
   // A Guest who keeps the Guest role across the switch: B's own new Session (the
   // one prepared for B), none of A's history, although Guest Sessions of A exist.
   request=one(await say('mock-visitor','hello B'));assert.equal(record('mock-visitor').agentPreset,'character-guest');
   assert(![previous.visitorDerived,previous.visitorSession].includes(record('mock-visitor').sessionId),'the Guest does not resume a Session of A');
   assert.equal(record('mock-visitor').sessionId,config.seededVisitorSession,'the Session prepared for B');
   for(const mark of ['VISITOR_A_HISTORY_MARK','A_CARD_MARK','A_PUBLIC_REL'])assert(!request.body.includes(mark),'Guest request has nothing of A: '+mark);
   assert(request.system.includes('B_CARD_MARK'));noTools('mock-visitor',request);

   // 4. Grants survive the switch; Contact enters B's own new Session with B's public version.
   request=one(await say('mock-friend','hello B'));assert.equal(record('mock-friend').agentPreset,'character-contact','the Contact grant survives');
   assert.notEqual(record('mock-friend').sessionId,previous.contactSession,'the Contact enters B\'s own Session');
   assert(request.system.includes('B_CARD_MARK'));for(const mark of ['A_CARD_MARK','A_PUBLIC_REL','B_USERNAME'])assert(!request.body.includes(mark),'Contact request has no '+mark);
   noTools('mock-friend',request);
   assert.deepEqual((await say('mock-stranger','hello B',{expect:false})).out,[],'the blocked account stays refused');
   assert.match((await say('mock-owner','/role show '+previous.stranger)).out.join('\n'),/ blocked/);
   assert.match((await say('mock-owner','/role show '+previous.friend)).out.join('\n'),/ contact/);
   scenario('grants','Grants across the switch: the blocked account stays refused and the Contact grant stays, now with B\'s public version in a new Session');
   scenario('tools','Contact and Guest requests offer no tools and their agents see no tool schemas (both characters)');

   // 2. A's reminder falls due under B: Identity refuses the cold resume; no model call, nothing to QQ.
   const asked=requests.length,sent=bot.sent.length;
   while(Date.now()<previous.dueAt+20000)await sleep(500);
   assert(count(resumes.attempted,previous.ownerSession)>=1,'control: the native Schedule did try to deliver the reminder');
   assert.equal(count(resumes.accepted,previous.ownerSession),0,'no cold resume of A\'s Session is accepted under B');
   assert.equal(requests.length,asked,'no model request after the reminder fell due');assert(!requests.some(r=>r.body.includes(REMINDER_PROMPT)),'the reminder never reached a model');
   assert.equal(bot.sent.length,sent,'nothing sent to QQ');assert(!bot.sent.some(t=>t.includes(REMINDER_PROMPT)||t.includes('[提醒到期]')));
   report.reminderResumeAttempts=count(resumes.attempted,previous.ownerSession);
   scenario('switch','Switch isolation: new Owner Session (the one prepared for B), B persona only, B recalls nothing of A, A\'s Session has no identity; a Guest who stays a Guest enters B\'s prepared Session without A\'s history; A\'s due reminder: cold resume refused, no model request, nothing sent');
   report.ok=true;
  }catch(error){report.error=error.stack;}
  finally{for(const fork of forks.reverse())await fork.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
