// Real Host with the role build of the communication probe wired as the
// character manager builds it: Identity, Memory and Conversation state under
// <data>/character-current, the runtime persona plugin for Owner, Contact and
// Guest, the role grants under <data>/account and the manager Host plugin.
// Character A is the old layout (data/character-a) brought in by
// adopt-character.cjs --link; character B is imported through the registry.
// Synthetic QQ and LLM only; no production data, card or credential.
// --phase2/--phase3 <home>: prepare the next role and move the link.
// --phase4 <home>: interrupt a switch back to A, then recover B's junction
// with the QQTK journal before a new native Host verifies B.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto'),assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),toolkit=path.resolve(process.env.DSH_QQTK_PROJECT||project+'/../harness-qq-toolkit');
const yaml=require('js-yaml'),dialect=require('./deployment-plan.cjs').entryYaml(yaml),{parseCardYaml}=require('./card-yaml.cjs');
const local=p=>pathToFileURL(path.join(project,p)).href,manager=p=>import(local('packages/character-manager/'+p));
const OWNER_KEY='qqbot:mock-app:c2c:mock-owner',VISITOR_KEY='qqbot:mock-app:c2c:mock-visitor';
const card=(name,description)=>JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name,description,personality:'说话简短。'}});
const readRows=dir=>dialect.load(fs.readFileSync(dir+'/cordis.patch.yml','utf8')),writeRows=(dir,rows)=>fs.writeFileSync(dir+'/cordis.patch.yml',dialect.dump(rows,{noRefs:true}));
const probeOf=rows=>rows.find(r=>r.insert).insert.find(r=>r.id==='inspector-probe');

async function stageSwitch(home,phase){
 if(!require('./test-home.cjs').isTestHome(home))throw Error('Switch phase only on a staged isolated test Home');
 const dir=home+'/profiles/inspector',rows=readRows(dir),entry=probeOf(rows),{data,current}=entry.config;
 const {prepareTarget}=await manager('switch.mjs'),{characterDir}=await manager('registry.mjs');
 const [from,to]=phase===2?['a','b']:['b','a'];
 // The link is only unlinked after checking it is the expected junction.
 if(!fs.lstatSync(current).isSymbolicLink()||fs.realpathSync(current)!==fs.realpathSync(characterDir(data,from)))throw Error(`character-current must be the link to ${from}`);
 prepareTarget({root:data,target:to,current:from});
 const target=characterDir(data,to);
 if(phase===4){
  const state=path.join(data,'maintenance');fs.mkdirSync(state,{recursive:true});
  const run=action=>JSON.parse(cp.execFileSync(process.execPath,[path.join(toolkit,'maintenance','character-switch.cjs'),action,home],{encoding:'utf8',windowsHide:true}));
  const nonce=randomUUID();
  fs.writeFileSync(path.join(state,'character-switch.json'),JSON.stringify({previous:from,target:to,requestedAt:Date.now(),nonce}),{flag:'wx'});
  assert.equal(run('pending').nonce,nonce);
  assert.equal(run('check').target,to);
  assert.equal(run('apply').target,to);
  assert.equal(run('recover').link,'target');
  fs.unlinkSync(current);
  assert.equal(run('recover').link,'missing');
  assert.equal(run('revert').previous,from);
  assert.equal(fs.realpathSync(current),fs.realpathSync(characterDir(data,from)));
 }else{
  fs.unlinkSync(current);fs.symlinkSync(target,current,'junction');
 }
 entry.config.phase=phase;
 if(phase===2){
  const seeded=JSON.parse(fs.readFileSync(target+'/conversations.json','utf8')).sessionIds;
  Object.assign(entry.config,{seededOwnerSession:seeded[OWNER_KEY],seededVisitorSession:seeded[VISITOR_KEY]??null});
 }
 writeRows(dir,rows);
}

async function phase1(){
 cp.execFileSync(process.execPath,[project+'/scripts/stage-communication.cjs'],{stdio:'pipe',windowsHide:true});
 const probe=JSON.parse(fs.readFileSync(project+'/test-data/communication-run.json')),dir=probe.home+'/profiles/inspector',rows=readRows(dir),inserted=rows.find(r=>r.insert).insert;
 const data=probe.home+'/data',current=data+'/character-current',account=data+'/account',sources=probe.home+'/sources';
 fs.mkdirSync(account,{recursive:true});fs.mkdirSync(sources);fs.rmSync(probe.home+'/binding.json');

 // A: an existing character directory of the old layout, adopted and linked.
 const a=data+'/character-a';fs.mkdirSync(a,{recursive:true});
 fs.writeFileSync(a+'/binding.json',JSON.stringify({appId:'mock-app',ownerId:'mock-owner',projectId:'fixture-project',characterId:'a'}));
 fs.writeFileSync(sources+'/a.json',card('Ayla','A_CARD_MARK：Ayla 和 {{user}} 是多年的朋友。'));
 fs.writeFileSync(sources+'/rules.md','# 规则\nA_RULES_MARK：回复简短。\n');fs.writeFileSync(sources+'/reminder.md','A_REMINDER_MARK：保持 Ayla 的口吻。\n');
 cp.execFileSync(process.execPath,[project+'/scripts/adopt-character.cjs','--root',data,'--id','a','--dir',a,'--card',sources+'/a.json','--rules',sources+'/rules.md','--reminder',sources+'/reminder.md','--user-name','A_USERNAME','--hang-on-text','A 稍等。','--link'],{stdio:'pipe',windowsHide:true});
 const {saveCharacter,approvePublic}=await manager('compile.mjs'),registry=await manager('registry.mjs');
 saveCharacter({dir:a,characterId:'a',parseYaml:parseCardYaml,revision:1,draft:{settings:{relationship:{owner:'A_OWNER_REL：你是对方最信任的人。',public:'A_PUBLIC_REL：对方只是来聊天的人。'}}}});

 // B: imported through the registry (identity copied from the current A), public version approved.
 const upload=registry.beginUpload(data);registry.appendUpload(data,upload,0,Buffer.from(card('Bryn','B_CARD_MARK：Bryn 第一次见到 {{user}}。')).toString('base64'));
 const b=registry.importCharacter(data,{uploadId:upload,id:'b',userName:'B_USERNAME',parseYaml:parseCardYaml});
 approvePublic({dir:registry.characterDir(data,'b'),characterId:'b',parseYaml:parseCardYaml,hash:b.pendingPublic.hash});
 if(registry.currentId(data)!=='a')throw Error('A must be current after adoption');

 // The rows the build writes with characterManager enabled, pointed at this Home.
 const row=id=>{const found=inserted.find(r=>r.id===id);if(!found)throw Error('Fixture row missing: '+id);return found;};
 const personaRow=audience=>({id:'persona',name:local('packages/character-manager/runtime-persona.mjs'),config:{audience,compiledFile:current+'/compiled.json',bindingFile:current+'/binding.json'}});
 row('conversation-manager').config.stateFile=current+'/conversations.json';
 row('memory-core').config.database=current+'/memory.sqlite';
 Object.assign(row('character-identity').config,{bindingFile:current+'/binding.json',stateFile:current+'/coordination.sqlite',presetId:'character',legacyPresetIds:['qq-character'],memoryAgentId:'qq-character',roles:{enabled:true,presets:['character-contact','character-guest']}});
 const owner=row('preset-qq-character'),plugins=owner.config.plugins;
 plugins[plugins.findIndex(p=>p.id==='persona')]=personaRow('owner');
 plugins.find(p=>p.id==='communication-interaction').config.compiledFile=current+'/compiled.json';
 const {rolePresets,TOOL_SCOPE}=await import(local('packages/character-definition/role-presets.mjs'));
 const presets=rolePresets({owner,publicPersonaRow:personaRow('public'),legacyOwner:'qq-character'});
 for(const preset of presets)for(const plugin of preset.config.plugins)if(plugin.name===TOOL_SCOPE)plugin.name=pathToFileURL(toolkit+'/plugin-sources/dsh-identity-access/tool-scope.mjs').href;
 inserted.splice(inserted.indexOf(owner),1,...presets);
 inserted.splice(inserted.indexOf(row('character-identity'))+1,0,{id:'character-manager',name:local('packages/character-manager/index.mjs'),config:{root:data,maintenanceDirectory:data+'/maintenance',featuresFile:data+'/maintenance/features.json'}});
 const entry=probeOf(rows);entry.name=local('tests/character-manager-host.mjs');Object.assign(entry.config,{data,current,account,phase:1});
 fs.writeFileSync(account+'/identity-owner.json',JSON.stringify({provider:'qq-official:qq-official-gateway:mock-app',subject:'mock-owner'}));
 writeRows(dir,rows);
 if(fs.existsSync(probe.home+'/.env')||fs.existsSync(probe.home+'/.credentials.yaml'))throw Error('Character manager fixture must have no credentials');
 fs.writeFileSync(project+'/test-data/character-manager-run.json',JSON.stringify(probe));
 console.log(JSON.stringify({home:probe.home,runId:probe.runId,characters:registry.readRegistry(data).characters.map(c=>c.id),presets:presets.map(p=>p.config.id),qqNetwork:false,credentialsCopied:false}));
}

const switchPhase=process.argv.findIndex(arg=>['--phase2','--phase3','--phase4'].includes(arg));
(switchPhase>=0?stageSwitch(path.resolve(process.argv[switchPhase+1]),Number(process.argv[switchPhase].at(-1))):phase1()).catch(e=>{console.error(e);process.exitCode=1;});
