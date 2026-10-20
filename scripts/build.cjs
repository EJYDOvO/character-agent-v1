const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
const release=JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
const req=require('module').createRequire(install+'/data/profiles/desktop/package.json'),yaml=req('js-yaml');
class Expression {constructor(value){this.value=value;}}
const expressionType=new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new Expression(v),instanceOf:Expression,represent:v=>v.value});
const schema=yaml.DEFAULT_SCHEMA.extend([expressionType]);
const dump=v=>yaml.dump(v,{schema,noRefs:true,lineWidth:120});
const write=(rel,body)=>{fs.mkdirSync(path.dirname(root+'/'+rel),{recursive:true});fs.writeFileSync(root+'/'+rel,body);};
async function main(){
 const {loadDefinition}=await import('../packages/character-definition/loader.mjs');
 const {workerPreset,configureWorkers}=await import('../packages/character-definition/workers.mjs');
 const settings=require('./build-settings.cjs')();
 const definition=loadDefinition(settings.definitionPath,s=>yaml.load(s));
 const a=require('./host-archive.cjs').openArchive();
 const creatorText=a.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml');
 const version=JSON.parse(a.read('dsh/package.json')).version;
 const workerSupported=a.read('dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js').includes('allowedAgentPresets');a.close();
 const creator=yaml.load(creatorText,{schema})[0].insert[0];
 const character=yaml.load(creatorText,{schema})[0].insert[0];character.id='preset-qq-character';character.config.id=settings.presetId;character.config.name=`Character ${definition.definition.name} (V1 测试版)`;
 character.config.plugins.find(x=>x.id==='persona').config.prefix=definition.persona;
 character.config.plugins.push({id:'character-memory-tools',name:'dsh-character-memory-tools/character.mjs'});
 if(!workerSupported)throw Error('Installed DSH lacks independent native Worker presets');
 configureWorkers(character,settings.specialistWorkers);
 if(settings.interaction){const {options}=await import('../packages/interaction-policy/policy.mjs');character.config.plugins.push({id:'interaction-policy',name:'dsh-interaction-policy',isolate:{interactionPolicy:true},config:options(settings.interaction)});}
 const host=[{id:'character-identity',name:'dsh-character-identity',config:{presetId:settings.presetId,bindingFile:settings.dataDirectory+'/binding.json',stateFile:settings.dataDirectory+'/coordination.sqlite'}},
 {id:'character-memory-core',name:'dsh-character-memory-core',config:{database:settings.dataDirectory+'/memory.sqlite',autoCapture:true}},
 {id:'qq-remote-ops',name:'dsh-remote-ops-local',config:{root:install.replaceAll('\\','/')}},
 {id:'im-qqbot',name:'dsh-character-qq-adapter',config:{preset:settings.presetId,access:{c2cMode:'allowlist',c2cAllow:[],groupMode:'disabled',groupAllow:[]}}},workerPreset(),...settings.specialistWorkers.map(workerPreset),character];
 write('bundles/character-core/cordis.patch.yml',dump([{insert:host}]));
 // Extras is maintained independently from generated Core. Rebuilding a persona
 // must neither restore former defaults nor erase reviewed optional declarations.
 const extrasFile=root+'/bundles/character-extras/cordis.patch.yml';
 if(!fs.existsSync(extrasFile))write('bundles/character-extras/cordis.patch.yml','# Empty optional integration layer.\n[]\n');
 else if(!Array.isArray(yaml.load(fs.readFileSync(extrasFile,'utf8'),{schema})))throw Error('Extras patch must be a YAML sequence');
 for(const [folder,name]of [['character-identity','dsh-character-identity'],['character-memory-core','dsh-character-memory-core'],['character-memory-tools','dsh-character-memory-tools'],['character-qq-adapter','dsh-character-qq-adapter']])write('packages/'+folder+'/package.json',JSON.stringify({name,version:release,private:true,type:'module',main:'index.mjs',files:['*.mjs','LICENSE*'],engines:{node:'>=24'}},null,2)+'\n');
 for(const kind of ['core','extras'])write('bundles/character-'+kind+'/package.json',JSON.stringify({name:'dsh-character-'+kind,version:release,private:true,type:'module',dsh:{bundle:{patch:'./cordis.patch.yml'}}},null,2)+'\n');
 write('artifacts/build-manifest.json',JSON.stringify({version,workerSupported,settings,buildSourceDigest:require('./build-inputs.cjs')(),characterId:definition.definition.id,definitionRevision:definition.revision,creatorSha256:crypto.createHash('sha256').update(creatorText).digest('hex'),creatorPluginIds:creator.config.plugins.map(p=>p.id),characterPluginIds:character.config.plugins.map(p=>p.id)},null,2));
 console.log(JSON.stringify({built:true,version,workerSupported,creatorPlugins:creator.config.plugins.length,characterPlugins:character.config.plugins.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
