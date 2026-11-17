const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
const release=JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
const yaml=require('js-yaml');
class Expression {constructor(value){this.value=value;}}
const expressionType=new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new Expression(v),instanceOf:Expression,represent:v=>v.value});
const schema=yaml.DEFAULT_SCHEMA.extend([expressionType]);
const dump=v=>yaml.dump(v,{schema,noRefs:true,lineWidth:120});
const write=(rel,body)=>{fs.mkdirSync(path.dirname(root+'/'+rel),{recursive:true});fs.writeFileSync(root+'/'+rel,body);};
async function main(){
 const {loadCard}=await import('../packages/character-definition/card.mjs');
 const {workerPreset,configureWorkers,selectedWorkerIds}=await import('../packages/character-definition/workers.mjs');
 const {communityWorkerIds}=await import('../packages/character-memory-tools/worker-policy.mjs');
 const settings=require('./build-settings.cjs')();
 const card=loadCard({...settings.card,parseYaml:require('./card-yaml.cjs').parseCardYaml});
 for(const warning of card.warnings)console.warn('角色卡警告：'+warning);
 const cardRevisions=require('./card-source.cjs').revisionsOf(card.inputs);
 const a=require('./host-archive.cjs').openArchive();
 const creatorText=a.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml');
 const version=JSON.parse(a.read('dsh/package.json')).version;
 const workerSupported=a.read('dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js').includes('allowedAgentPresets');a.close();
 const creator=yaml.load(creatorText,{schema})[0].insert[0];
 const character=yaml.load(creatorText,{schema})[0].insert[0];character.id='preset-qq-character';character.config.id=settings.presetId;character.config.name=`Character ${card.name} (V1 测试版)`;
 const persona=character.config.plugins.find(x=>x.id==='persona').config;persona.prefix=card.prefix;if(card.suffix)persona.suffix=card.suffix;else delete persona.suffix;
 const workerIds=selectedWorkerIds(settings.specialistWorkers,settings.communityWorkerPresets,{characterPresetId:settings.presetId,rootPresetIds:[creator.config.id]});
 const externalIds=new Set(communityWorkerIds(settings.communityWorkerPresets,{characterPresetId:settings.presetId,rootPresetIds:[creator.config.id]}));
 character.config.plugins.push({id:'character-memory-tools',name:'dsh-character-memory-tools/character.mjs',config:{workerPresets:workerIds,communityWorkerPresets:settings.communityWorkerPresets,characterPresetId:settings.presetId,...(card.reminder?{reminder:card.reminder}:{})}});
 if(!workerSupported)throw Error('Installed DSH lacks independent native Worker presets');
 configureWorkers(character,settings.specialistWorkers,settings.communityWorkerPresets);
 // Optional roles: Owner keeps this exact composition (and Persona); contact/guest
 // are assembled independently from the explicit public Persona.
 let presets=[character];const roleHost=settings.roles?require('./role-settings.cjs').roleConfig(settings.roles,settings.dataDirectory):undefined;
 if(settings.interaction){const {options}=await import('../packages/interaction-policy/policy.mjs');character.config.plugins.push({id:'interaction-policy',name:'dsh-interaction-policy',isolate:{interactionPolicy:true},config:options({hangOnModelFile:settings.dataDirectory+'/hangon-model.json',...settings.interaction,...(card.reminder?{styleReminder:card.reminder}:{})})});}
 if(settings.roles){const {rolePresets}=await import('../packages/character-definition/role-presets.mjs');presets=rolePresets({owner:character,publicPersona:fs.readFileSync(settings.roles.publicPersonaFile,'utf8').replace(/^\uFEFF/,'').trim(),legacyOwner:settings.roles.legacyOwnerPreset});}
 const host=[{id:'agent-io',name:'dsh-agent-io',config:{}},{id:'conversation-manager',name:'dsh-conversation-manager',config:{stateFile:settings.dataDirectory+'/conversations.json'}},...(roleHost?[{id:'identity-access',name:'dsh-identity-access',config:roleHost.identityAccess}]:[]),{id:'character-identity',name:'dsh-character-identity',config:{presetId:settings.presetId,bindingFile:settings.dataDirectory+'/binding.json',stateFile:settings.dataDirectory+'/coordination.sqlite',...roleHost?.characterIdentity}},
 {id:'character-memory-core',name:'dsh-character-memory-core',config:{database:settings.dataDirectory+'/memory.sqlite',autoCapture:true}},
 {id:'qq-remote-ops',name:'dsh-remote-ops-local',config:{root:install.replaceAll('\\','/')}},
 {id:'im-qqbot',name:'dsh-character-qq-adapter',config:{preset:settings.presetId,access:{c2cMode:'allowlist',c2cAllow:[],groupMode:'disabled',groupAllow:[]},...roleHost?.qq}},...workerIds.filter(id=>!externalIds.has(id)).map(workerPreset),...presets];
 write('bundles/character-core/cordis.patch.yml',dump([{insert:host}]));
 // Extras is maintained independently from generated Core. Rebuilding a persona
 // must neither restore former defaults nor erase reviewed optional declarations.
 const extrasFile=root+'/bundles/character-extras/cordis.patch.yml';
 if(!fs.existsSync(extrasFile))write('bundles/character-extras/cordis.patch.yml','# Empty optional integration layer.\n[]\n');
 else if(!Array.isArray(yaml.load(fs.readFileSync(extrasFile,'utf8'),{schema})))throw Error('Extras patch must be a YAML sequence');
 for(const [folder,name]of [['character-identity','dsh-character-identity'],['character-memory-core','dsh-character-memory-core'],['character-memory-tools','dsh-character-memory-tools'],['character-qq-adapter','dsh-character-qq-adapter']])write('packages/'+folder+'/package.json',JSON.stringify({name,version:release,private:true,type:'module',main:'index.mjs',files:['*.mjs','LICENSE*'],engines:{node:'>=24'}},null,2)+'\n');
 for(const kind of ['core','extras'])write('bundles/character-'+kind+'/package.json',JSON.stringify({name:'dsh-character-'+kind,version:release,private:true,type:'module',dsh:{bundle:{patch:'./cordis.patch.yml'}}},null,2)+'\n');
 write('artifacts/build-manifest.json',JSON.stringify({version,workerSupported,workerPolicyVersion:4,workerPresets:workerIds,settings,buildSourceDigest:require('./build-inputs.cjs')(),characterId:settings.characterId,card:{spec:card.spec,revision:cardRevisions.revision,tokens:card.tokens,warnings:card.warnings},rulesRevision:cardRevisions.rulesRevision,creatorSha256:crypto.createHash('sha256').update(creatorText).digest('hex'),creatorPluginIds:creator.config.plugins.map(p=>p.id),characterPluginIds:character.config.plugins.map(p=>p.id),rolePresets:presets.map(p=>p.config.id)},null,2));
 console.log(JSON.stringify({built:true,version,workerSupported,creatorPlugins:creator.config.plugins.length,characterPlugins:character.config.plugins.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
