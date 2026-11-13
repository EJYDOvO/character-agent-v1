const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function toolkit(dir){assert(dir&&path.isAbsolute(dir),'Supply --qqtk with the public QQTK clone path');const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));assert.equal(p.name,'harness-qq-toolkit');return require(path.join(dir,'scripts/portable.cjs'));}
// Card keys of the portable config, as build-config keys (see card-source.cjs).
// Paths are relative to the portable config file.
function cardBuildConfig(c,dir){
 if(c.definition!==undefined)throw Error('Portable config "definition" is no longer supported: the definition.yaml format was replaced by Character Card V3; set "card"');
 const resolve=value=>value===undefined?undefined:path.resolve(dir,value);
 const rules={};if(c.rules?.system!==undefined)rules.systemFile=resolve(c.rules.system);if(c.rules?.reminder!==undefined)rules.reminderFile=resolve(c.rules.reminder);
 return {cardPath:c.card===undefined?path.join(root,'characters','template','card.yaml'):resolve(c.card),rules,...(c.userName!==undefined?{userName:c.userName}:{}),...(c.characterId!==undefined?{characterId:c.characterId}:{})};
}
function prepare(file,home,qqtk){
 const q=toolkit(qqtk),c=q.config(file),rt=q.runtime(c);assert(!path.resolve(home).startsWith(root+path.sep)&&path.resolve(home)!==root,'Home must be outside Character source');q.freshHome(home);const rel=c.dataDirectory||'character',data=path.resolve(home,rel);assert(data.startsWith(path.resolve(home)+path.sep),'Character dataDirectory must be inside its separate DSH_HOME');
 const card=cardBuildConfig(c,path.dirname(file));assert(fs.existsSync(card.cardPath),'Character card is missing');
 // Optional roles: explicit public Persona file; extra admitted private accounts only with roles.
 const {roleSettings,roleConfig}=require('./role-settings.cjs'),roles=c.roles?.enabled===true?roleSettings({...c.roles,publicPersonaFile:c.roles.publicPersona&&path.resolve(path.dirname(file),c.roles.publicPersona)}):undefined;
 const allow=c.qq.allow??[];assert(Array.isArray(allow)&&allow.every(id=>typeof id==='string'&&id&&!id.includes('<')&&id!=='*'&&id!==c.qq.ownerId),'qq.allow lists explicit other private accounts');
 assert(roles||!allow.length,'Admitting other accounts requires roles.enabled');
 const build={...card,dataDirectory:data,presetId:c.characterPresetId||(roles?'character':'qq-character'),...(roles?{roles}:{}),interaction:c.interaction||{enabled:false},specialistWorkers:c.specialistWorkers||[],communityWorkerPresets:c.communityWorkerPresets||[]};
 const buildFile=home+'/build-config.private.json';fs.writeFileSync(buildFile,JSON.stringify(build,null,2),{mode:0o600});
 const env={...process.env,DSH_INSTALL_ROOT:home,DSH_HOME:home,DSH_CHARACTER_HOST_ROOT:rt.root,DSH_RESOURCES_DIR:rt.resources,DSH_QQTK_PROJECT:qqtk,DSH_CHARACTER_BUILD_CONFIG:buildFile};
 for(const script of ['build','pack']){const result=cp.spawnSync(process.execPath,[root+'/scripts/'+script+'.cjs'],{cwd:root,env,stdio:'pipe',windowsHide:true});assert.equal(result.status,0,'Private Character build/pack failed; no running Profile was modified');}
 const source=JSON.parse(fs.readFileSync(root+'/artifacts/package-source.json')),selected=new Set(['dsh-character-core','dsh-character-identity','dsh-character-memory-core','dsh-character-memory-tools','dsh-character-qq-adapter']);
 if(c.extras||c.longTasks)selected.add('dsh-character-extras');if(c.longTasks)selected.add('dsh-character-long-tasks');if(c.interaction?.enabled)selected.add('dsh-interaction-policy');if(c.inspector?.enabled)selected.add('dsh-memory-inspector');
 const own=source.artifacts.filter(p=>selected.has(p.name)).map(p=>({...p,file:root+'/artifacts/packages/'+p.filename})),artifacts=[...q.pack(home+'/packages'),...own];
 const {rows,im}=q.baseRows(c,home);im.config.preset=build.presetId;const host=roles&&roleConfig(roles,data);
 if(host){Object.assign(im.config,host.qq);im.config.access.c2cAllow=[c.qq.ownerId,...allow];}
 rows.push(im,{id:'qq-remote-ops',disabled:!c.remoteOps?.enabled,config:{root:null,stateDirectory:home+'/remote-ops',ownerId:c.qq.ownerId}},{id:'character-identity',config:{presetId:build.presetId,bindingFile:data+'/binding.json',stateFile:data+'/coordination.sqlite',memoryMode:c.memoryMode||'off',...host?.characterIdentity}});
 if(host)rows.push({id:'identity-access',config:host.identityAccess});
 if(c.inspector?.enabled)rows.push({insert:[{id:'memory-inspector',name:'dsh-memory-inspector',config:{writable:c.inspector.writable===true}}]});
 if(c.longTasks)rows.push({id:'long-tasks',disabled:false,config:{cwd:home+'/workspace'}});
 const manifest=JSON.parse(fs.readFileSync(root+'/artifacts/build-manifest.json'));fs.mkdirSync(data,{recursive:true});
 // The Owner binding of Identity & Access comes from the same private config, never from QQ messages.
 if(roles)fs.writeFileSync(data+'/identity-owner.json',JSON.stringify({provider:'qq-official:qq-official-gateway:'+c.qq.appId,subject:c.qq.ownerId},null,2),{mode:0o600});fs.writeFileSync(data+'/binding.json',JSON.stringify({appId:c.qq.appId,ownerId:c.qq.ownerId,characterId:manifest.characterId,projectId:c.projectId||'personal'},null,2),{mode:0o600});
 return q.writeProfile({c,home,kind:'character',artifacts,rows,bundles:['dsh-character-core',...(selected.has('dsh-character-extras')?['dsh-character-extras']:[])],marker:{dataDirectory:path.relative(home,data).replaceAll('\\','/'),characterVersion:JSON.parse(fs.readFileSync(root+'/package.json')).version}});
}
if(require.main===module){const args=process.argv.slice(2),flag=k=>{const i=args.indexOf('--'+k);return i<0?undefined:args[i+1];};(async()=>{const command=args[0],home=flag('home')&&path.resolve(flag('home')),q=toolkit(path.resolve(flag('qqtk')||process.env.DSH_QQTK_PROJECT||''));let result;if(command==='prepare')result=prepare(path.resolve(flag('config')),home,q.root);else if(command==='install')result=q.install(home,{offline:args.includes('--offline')});else if(command==='verify')result=q.verify(home);else if(command==='start')result=q.start(home,{noOpen:!args.includes('--open')});else if(command==='backup')result=q.backup(home,path.resolve(flag('out')));else if(command==='restore')result=q.restore(home,path.resolve(flag('backup')));else throw Error('Commands: prepare, install, verify, start, backup, restore');console.log(JSON.stringify(result));})().catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={prepare,toolkit,cardBuildConfig};
