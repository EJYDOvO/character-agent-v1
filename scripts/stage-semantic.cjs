// Isolated native Host fixture for semantic recall (D1) in the Character combination: the Character
// preset with a Persona rendered from the template Character Card, Character Identity, Character
// Memory Core and Memory Tools, and the semantic recall row produced by the same generator the
// Character build uses (scripts/semantic-settings.cjs; no explicit mode, so the default applies).
// Source copies only, a new empty Home, synthetic memories, a deterministic chat model. No production
// configuration, data or QQ. Needs a provisioned embedding runtime and model:
//   DSH_SEMANTIC_RUNTIME_DIR, DSH_SEMANTIC_MODEL_DIR  (absolute paths)
//
// One Profile per phase; scripts/run-semantic.ps1 copies a phase's file over cordis.patch.yml before
// each Host start, the way an operator switches the mode:
//   active       the generated row unchanged (default mode)
//   shadow       mode: shadow (the runner corrupts the sidecar index before this start)
//   off          mode: off
//   unavailable  the generated row, but nothing is provisioned at its runtime/model paths
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),yaml=require('js-yaml'),dialect=require('./deployment-plan.cjs').entryYaml(yaml);
const runtimeDir=process.env.DSH_SEMANTIC_RUNTIME_DIR,modelDir=process.env.DSH_SEMANTIC_MODEL_DIR;
for(const [name,dir]of [['DSH_SEMANTIC_RUNTIME_DIR',runtimeDir],['DSH_SEMANTIC_MODEL_DIR',modelDir]])if(!dir||!path.isAbsolute(dir)||!fs.existsSync(dir))throw Error('Set '+name+' to a provisioned absolute directory');
const slash=p=>p.split(path.sep).join('/');
(async()=>{
 const {loadCard}=await import('../packages/character-definition/card.mjs');
 const {configureWorkers}=await import('../packages/character-definition/workers.mjs');
 const archive=require('./host-archive.cjs').openArchive(),version=JSON.parse(archive.read('dsh/package.json')).version;
 const creator=dialect.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'))[0].insert[0];archive.close();
 const home=require('./test-home.cjs').newHome('semantic'),dir=path.join(home,'profiles','semantic'),data=slash(path.join(home,'character')),runId=randomUUID(),local=rel=>pathToFileURL(path.join(root,rel)).href;
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(home,'tmp'));fs.mkdirSync(data,{recursive:true});
 // Character preset exactly as the build composes it, from the public template card.
 const card=loadCard({cardPath:path.join(root,'characters/template/card.yaml'),systemRulesPath:path.join(root,'characters/template/rules.md'),reminderPath:path.join(root,'characters/template/reminder.md'),parseYaml:require('./card-yaml.cjs').parseCardYaml});
 const character=dialect.load(dialect.dump(creator));character.id='preset-qq-character';character.config.id='qq-character';configureWorkers(character);
 const persona=character.config.plugins.find(p=>p.id==='persona').config;persona.prefix=card.prefix;if(card.suffix)persona.suffix=card.suffix;else delete persona.suffix;
 character.config.plugins.find(p=>p.id==='delegation').config.find(p=>p.id==='tool-subagent').name=local('packages/character-memory-tools/subagent.mjs');
 character.config.plugins.push({id:'character-memory-tools',name:local('packages/character-memory-tools/character.mjs'),config:{workerPresets:[],communityWorkerPresets:[],characterPresetId:'qq-character',...(card.reminder?{reminder:card.reminder}:{})}});
 const binding=path.join(home,'binding.json');fs.writeFileSync(binding,JSON.stringify({appId:'mock-app',ownerId:'mock-owner',characterId:'semantic-fixture',projectId:'semantic-project'}));
 const {semanticSettings,semanticRow}=require('./semantic-settings.cjs');
 const row=semanticRow(semanticSettings({runtimeDir,modelDir},{install:home,dataDirectory:data}));
 if(row.config.mode!=='active')throw Error('The generated row must default to active');
 row.name=local('packages/memory-semantic/index.mjs');row.config.indexIntervalMs=400;row.config.indexBatch=16;
 const variants={
  active:row.config,
  shadow:{...row.config,mode:'shadow'},
  off:{...row.config,mode:'off'},
  unavailable:{...row.config,provider:{...row.config.provider,runtimeDir:slash(path.join(home,'not-provisioned','runtime')),modelDir:slash(path.join(home,'not-provisioned','models'))}},
 };
 const profile=phase=>[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',disabled:true},{insert:[character,
  {id:'character-identity',name:local('packages/character-identity/index.mjs'),config:{presetId:'qq-character',bindingFile:binding,stateFile:path.join(home,'coordination.sqlite'),memoryMode:'off'}},
  {id:'character-memory-core',name:local('packages/character-memory-core/index.mjs'),config:{database:data+'/memory.sqlite',autoCapture:false,consolidation:false}},
  {...row,config:variants[phase]},
  {id:'semantic-probe',name:local('tests/semantic-host.mjs'),config:{cwd:slash(home),phase,result:path.join(home,'result-'+phase+'.json'),runId,version,indexFile:row.config.indexFile,declared:variants[phase],provenance:require('./audit-evidence.cjs')()}}]}];
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'semantic-fixture',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
 for(const phase of Object.keys(variants))fs.writeFileSync(path.join(dir,'cordis.patch.'+phase+'.yml'),dialect.dump(profile(phase),{noRefs:true}));
 fs.mkdirSync(path.join(root,'test-data'),{recursive:true});
 fs.writeFileSync(path.join(root,'test-data','semantic-run.json'),JSON.stringify({home,dir,runId,indexFile:row.config.indexFile,phases:Object.keys(variants)}));
 console.log(JSON.stringify({home,runId,version,character:card.name,defaultMode:row.config.mode,productionDataCopied:false,qqNetwork:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
