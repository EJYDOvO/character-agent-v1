// Fresh source-only fixture: no production config, credentials, Persona or database.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
const yaml=require(require.resolve('js-yaml',{paths:[install+'/data/profiles/desktop']}));
class Expression{constructor(value){this.value=value;}}
const schema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new Expression(v),instanceOf:Expression,represent:v=>v.value})]);
(async()=>{
 const {workerPreset,configureWorkers,selectedWorkerIds}=await import('../packages/character-definition/workers.mjs');
 const home=path.join(root,'test-data','inspector-'+randomUUID()),dir=path.join(home,'profiles','inspector'),runId=randomUUID(),extras=process.argv.includes('--extras'),realModel=process.argv.includes('--real-model-ab'),modules=process.argv.includes('--modules'),workerProbe=process.argv.includes('--workers');fs.mkdirSync(dir,{recursive:true});
 if(modules&&(extras||realModel))throw Error('--modules uses an independent ordinary Agent fixture');
 const local=p=>require('node:url').pathToFileURL(path.join(root,p)).href;
 const archive=require('./host-archive.cjs').openArchive();const version=JSON.parse(archive.read('dsh/package.json')).version;
 const creator=yaml.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'),{schema})[0].insert[0];archive.close();
 const character=yaml.load(yaml.dump(creator,{schema}),{schema});character.id='preset-qq-character';character.config.id='qq-character';configureWorkers(character);
 character.config.plugins.find(p=>p.id==='persona').config.prefix='Isolated Character fixture. Retain full assistant abilities.';
 if(realModel){const {loadDefinition}=await import('../packages/character-definition/loader.mjs');character.config.plugins.find(p=>p.id==='persona').config.prefix=loadDefinition(require('./definition-source.cjs')(),s=>yaml.load(s)).persona;}
 if(workerProbe&&(realModel||modules))throw Error('--workers uses its own deterministic native Host fixture');
 const specialists=extras||workerProbe?['worker-review']:[],community=workerProbe?['worker-community',{id:'root-planner-worker',alias:'external-planner'}]:[];
 const workerIds=selectedWorkerIds(specialists,community);configureWorkers(character,specialists,community);
 character.config.plugins.push({id:'memory-tools',name:local('packages/character-memory-tools/character.mjs'),config:{workerPresets:workerIds,communityWorkerPresets:community}});
 const {communityWorkerIds}=await import('../packages/character-memory-tools/worker-policy.mjs');
 const external=communityWorkerIds(community),workers=workerIds.filter(id=>!external.includes(id)).map(workerPreset);
 for(const id of external){const reviewed=workerPreset();reviewed.id='preset-'+id;reviewed.config.id=id;reviewed.config.name='Reviewed community fixture';reviewed.config.plugins[1].config.prefix=reviewed.config.plugins[1].config.prefix.replaceAll('worker-general',id);workers.push(reviewed);}
 for(const worker of workers)worker.config.plugins[0].name=local('packages/character-memory-tools/worker.mjs');
 const binding=home+'/binding.json';fs.writeFileSync(binding,JSON.stringify({appId:'mock-app',ownerId:'mock-owner',characterId:'fixture-character',projectId:'fixture-project'}));
 const inserted=[...workers,character,
  {id:'character-identity',name:local('packages/character-identity/index.mjs'),config:{presetId:'qq-character',bindingFile:binding,stateFile:home+'/coordination.sqlite',memoryMode:'character'}},
  {id:'memory-core',name:local('packages/character-memory-core/index.mjs'),config:{database:home+'/memory.sqlite',autoCapture:true,idleMs:50,consolidation:false}},
  ...(extras?[{id:'memory-inspector',name:local('packages/memory-inspector/index.mjs'),config:{writable:true}}]:[]),
  ...(workerProbe?[{id:'long-tasks',name:local('packages/long-tasks/index.mjs'),config:{cwd:home}}]:[]),
  {id:'inspector-probe',name:local(workerProbe?'tests/workers-host.mjs':realModel?'tests/creator-ab-host.mjs':'tests/inspector-host.mjs'),config:{cwd:home,result:home+'/result.json',runId,extras,version,preview:process.argv.includes('--preview')}}];
 if(modules)inserted.splice(0,inserted.length,{id:'module-contract',name:local('tests/module-lifecycle-host.mjs'),config:{cwd:home,result:home+'/result.json',runId,version}});
 const bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'];
 if(extras){
  const extra=dir+'/node_modules/fixture-extras';fs.mkdirSync(extra,{recursive:true});fs.writeFileSync(extra+'/package.json',JSON.stringify({name:'fixture-extras',version:'1.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}}));
  fs.writeFileSync(extra+'/cordis.patch.yml',yaml.dump([{insert:[{id:'optional-fixture',name:local('tests/module-lifecycle-host.mjs'),config:{role:'extras'}}]}]));bundles.push('fixture-extras');
 }
 fs.writeFileSync(dir+'/package.json',JSON.stringify({name:'inspector-fixture',private:true,dsh:{profile:{bundles}}}));
 const rows=[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',disabled:true},{insert:inserted}];
 inserted.at(-1).config.provenance=require('./audit-evidence.cjs')();
 if(realModel){
  // Explicit opt-in: only the configured LLM route and its provider credential.
  // No QQ settings, sessions or memory are copied; reports exclude prompts.
  const live=yaml.load(fs.readFileSync(install+'/data/profiles/desktop/cordis.patch.yml','utf8'),{schema});
  inserted.at(-1).config.modelRoute=live.find(r=>r.id==='agent-default-model')?.config;
  for(const id of ['agent-default-model','llm-pi-ai']){const row=live.find(r=>r.id===id);if(!row)throw Error('Configured LLM route unavailable');rows.push({...row,disabled:false});}
  const credential=fs.readFileSync(install+'/data/.env','utf8').split(/\r?\n/).find(line=>/^NAVIGATOR_API_KEY=/.test(line));if(!credential)throw Error('Configured provider credential unavailable');fs.writeFileSync(home+'/.env',credential+'\n');
 }
 fs.writeFileSync(dir+'/cordis.patch.yml',yaml.dump(rows,{schema,noRefs:true}));
 fs.writeFileSync(root+'/test-data/inspector-run.json',JSON.stringify({home,result:home+'/result.json',runId,extras}));console.log(JSON.stringify({home,runId,extras,qqOrMemoryCopied:false,realModel}));
})().catch(e=>{console.error(e);process.exitCode=1;});
