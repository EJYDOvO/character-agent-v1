import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {rolePresets,TOOL_SCOPE} from '../packages/character-definition/role-presets.mjs';
import {apply} from '../packages/character-identity/index.mjs';

const owner=()=>({id:'preset-qq-character',name:'@deepseek-ai/dsh-agent-preset',config:{id:'qq-character',name:'Character',plugins:[{id:'persona',name:'persona',config:{prefix:'private-owner-definition'}},{id:'creator-tool',name:'fixture-tool'},{id:'character-memory-tools',name:'dsh-character-memory-tools/character.mjs',config:{characterPresetId:'qq-character'}}]}});
test('Owner keeps its full composition and private Persona; contact/guest are assembled independently',()=>{
 const source=owner(),before=structuredClone(source),rows=rolePresets({owner:source,publicPersona:'Reviewed public Persona'});
 assert.deepEqual(source,before,'the reviewed composition is not mutated');
 assert.deepEqual(rows.map(r=>r.config.id),['character','character-contact','character-guest']);
 const root=rows[0];assert.equal(root.id,'preset-character');
 assert.equal(root.config.plugins.find(p=>p.id==='persona').config.prefix,'private-owner-definition','Owner Persona is never replaced');
 assert(root.config.plugins.some(r=>r.id==='creator-tool'));assert.equal(root.config.plugins.find(p=>p.id==='character-memory-tools').config.characterPresetId,'character');
 for(const row of rows.slice(1)){
  assert.deepEqual(row.config.plugins.map(p=>p.id),['persona','role-tool-scope'],'no Creator, Memory, Worker, Schedule or Remote Ops plugin');
  assert.equal(row.config.plugins[0].config.prefix,'Reviewed public Persona');assert.equal(row.config.plugins[1].name,TOOL_SCOPE);assert.deepEqual(row.config.plugins[1].config.allow,[]);
  assert(!JSON.stringify(row).includes('private-owner-definition'));
 }
 assert.throws(()=>rolePresets({owner:owner()}),/public Persona/);assert.throws(()=>rolePresets({owner:owner(),publicPersona:'  '}),/public Persona/);
});
test('the legacy Owner id is an exact Owner alias and cannot name a role Preset',()=>{
 const rows=rolePresets({owner:owner(),publicPersona:'public',legacyOwner:'qq-character'}),alias=rows.at(-1);
 assert.equal(alias.config.id,'qq-character');assert.equal(alias.id,'preset-qq-character');
 assert.deepEqual(alias.config.plugins,rows[0].config.plugins,'same Owner plugins, no public Persona');
 for(const bad of ['character-guest','character','Bad id'])assert.throws(()=>rolePresets({owner:owner(),publicPersona:'p',legacyOwner:bad}),/legacy/);
});
test('native Creator expression objects survive role cloning',()=>{class Expression{constructor(source){this.source=source;}}const source={config:{plugins:[{id:'persona',config:{prefix:'private'}},{id:'native-path',config:{path:new Expression('process.cwd()')}}]}};const result=rolePresets({owner:source,publicPersona:'public'});assert(result[0].config.plugins[1].config.path instanceof Expression);assert.notEqual(result[0].config.plugins[1].config.path,source.config.plugins[1].config.path);});

// ── Character Identity with roles: Owner-only capabilities, legacy Owner Preset ──
function identity(t,config={},dir){
 dir??=fs.mkdtempSync(path.join(os.tmpdir(),'identity-roles-'));const bindingFile=path.join(dir,'binding.json');
 if(!fs.existsSync(bindingFile))fs.writeFileSync(bindingFile,JSON.stringify({appId:'fixture-app',ownerId:'owner'}));
 const services={};let dispose;apply({provide:(name,s)=>{services[name]=s;},effect:f=>dispose=f(),on(){},get:name=>name==='agentPresets'?{composedPreset:c=>c?.preset}:undefined},{bindingFile,stateFile:path.join(dir,'state.sqlite'),...config});
 let closing;const close=()=>closing??=Promise.resolve().then(()=>dispose?.());t.after(close);return {...services,dir,dispose:close};
}
function manager(){
 const sessions=new Map();let n=0;
 const m={sessions,sessionKey:(scope,peer)=>scope+':'+peer,records:()=>sessions.values(),currentSessionId(key){return sessions.get(key)?.sessionId;},ownershipState(key){return {sessionId:this.currentSessionId(key),generation:1};},
  isCurrentSession:r=>sessions.get(r.sessionKey)===r,calls:[],
  async getOrCreate(scope,peer,sender,target,options){m.calls.push(options);const preset=options?.presets?.[0]??'character';const id='s'+(++n),record={sessionKey:scope+':'+peer,sessionId:id,scope,peerId:peer,senderId:sender,agentPreset:preset,agent:{id,ctx:{preset,get:()=>({guard(){}}),on(){}},session:{seq:1}}};sessions.set(record.sessionKey,record);return record;}};
 return m;
}
const ROLES={presetId:'character',legacyPresetIds:['qq-character'],roles:{enabled:true,presets:['character-contact','character-guest']}};
const gateway=(extra={})=>({appId:'fixture-app',preset:'character',access:{c2cMode:'allowlist',c2cAllow:['owner','friend'],groupMode:'disabled'},identityAccess:{enabled:true},...extra});
const target=peer=>({scope:'c2c',targetId:peer,msgId:'m'});

test('Gateway policy: Owner-only without roles; with roles only behind the Identity & Access gate',t=>{
 const plain=identity(t,{presetId:'character'}).characterIdentity;
 assert.throws(()=>plain.validateGateway(gateway()),/mismatch/,'multiple admitted accounts need roles');
 plain.validateGateway(gateway({access:{c2cMode:'allowlist',c2cAllow:['owner'],groupMode:'disabled'},identityAccess:{enabled:false}}));
 const roles=identity(t,ROLES).characterIdentity;roles.validateGateway(gateway());
 assert.throws(()=>roles.validateGateway(gateway({identityAccess:{enabled:false}})),/mismatch/);
 assert.throws(()=>roles.validateGateway(gateway({access:{c2cMode:'allowlist',c2cAllow:['friend'],groupMode:'disabled'}})),/mismatch/,'the Owner stays admitted');
 assert.throws(()=>roles.validateGateway(gateway({access:{c2cMode:'allowlist',c2cAllow:['owner','friend'],groupMode:'allowlist'}})),/mismatch/);
 assert.deepEqual(JSON.parse(JSON.stringify(roles.allowedPresets())),{owner:['character','qq-character'],roles:['character-contact','character-guest']});
 assert.throws(()=>identity(t,{presetId:'character',roles:{enabled:true,presets:['qq-character']},legacyPresetIds:['qq-character']}),/distinct/);
});

test('role accounts get their own Session and no Owner identity, Memory evidence or reminder authority',async t=>{
 const f=identity(t,ROLES),id=f.characterIdentity,m=manager();const evidence=[];id.onIngress((_h,e)=>evidence.push(e));
 id.attach({manager:m,config:gateway()});
 const owner=await m.getOrCreate('c2c','owner','owner',target('owner'),{presets:['character','qq-character']});assert.equal(id.forSession(owner.sessionId).sessionId,owner.sessionId);
 const guest=await m.getOrCreate('c2c','friend','friend',target('friend'),{presets:['character-guest']});
 assert.throws(()=>id.forSession(guest.sessionId),'no Owner identity for a role Session');assert.throws(()=>f.memoryIdentity.forSession(guest.sessionId));
 assert.equal(id.canDeliverReminder(guest.agent),false);
 const input=(peer,text)=>({platform:'qq-official',adapter:'qq-official-gateway',accountId:'fixture-app',conversation:{type:'direct',id:peer},sender:{id:peer},message:{id:'i-'+text,text}});
 m.admitInput(guest,input('friend','guest text'));assert.equal(evidence.length,0,'guest input is never Owner evidence');
 assert.throws(()=>m.admitInput(owner,input('friend','spoofed')),/Untrusted Owner input/,'a role input cannot enter the Owner Session');
 m.admitInput(owner,input('owner','owner text'));assert.equal(evidence.length,1);
 await assert.rejects(m.getOrCreate('c2c','friend','friend',target('friend'),{presets:['character']}),/Owner-only/,'a role account never gets an Owner Preset');
 await assert.rejects(m.getOrCreate('c2c','friend','friend',target('friend')),/Owner-only/,'a role account needs gate-selected Presets');
 await assert.rejects(m.getOrCreate('c2c','owner','owner',target('owner'),{presets:['character-guest']}),/Owner-only/,'the Owner never runs in a role Preset');
 const plain=identity(t,{presetId:'character'}),pm=manager();plain.characterIdentity.attach({manager:pm,config:gateway({access:{c2cMode:'allowlist',c2cAllow:['owner'],groupMode:'disabled'},identityAccess:{enabled:false}})});
 await assert.rejects(pm.getOrCreate('c2c','friend','friend',target('friend'),{presets:['character-guest']}),/Owner-only/,'without roles nothing but the Owner passes');
});

test('legacy qq-character Owner Sessions stay bound; the scope moves only with the reviewed legacy id',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'identity-migrate-'));
 const before=identity(t,{presetId:'qq-character'},dir),m=manager();
 before.characterIdentity.attach({manager:m,config:{appId:'fixture-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['owner'],groupMode:'disabled'}}});
 const legacy=await m.getOrCreate('c2c','owner','owner',target('owner'),{presets:['qq-character']});await before.dispose();
 assert.throws(()=>identity(t,{presetId:'character'},dir),/scope changed/,'a different Preset id without the reviewed legacy id stops');
 const after=identity(t,ROLES,dir),m2=manager();m2.sessions.set(legacy.sessionKey,legacy);
 after.characterIdentity.attach({manager:m2,config:gateway()});
 assert.equal(after.characterIdentity.forSession(legacy.sessionId).sessionId,legacy.sessionId,'the historical Owner Session keeps its identity');
 assert.equal(after.characterIdentity.canDeliverReminder({...legacy.agent}),false,'an unregistered Agent object is not trusted');
 const audit=await after.characterIdentity.auditSchedules().catch(e=>e.message);assert.match(String(audit),/unavailable|rows/);
});
