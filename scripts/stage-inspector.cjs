// Fresh source-only fixture: no production config, credentials, Persona or database.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
const yaml=require(require.resolve('js-yaml',{paths:[install+'/data/profiles/desktop']}));
class Expression{constructor(value){this.value=value;}}
const schema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new Expression(v),instanceOf:Expression,represent:v=>v.value})]);
(async()=>{
 const {workerPreset,configureWorkers}=await import('../packages/character-definition/workers.mjs');
 const home=path.join(root,'test-data','inspector-'+randomUUID()),dir=path.join(home,'profiles','inspector'),runId=randomUUID(),extras=process.argv.includes('--extras');fs.mkdirSync(dir,{recursive:true});
 const local=p=>require('node:url').pathToFileURL(path.join(root,p)).href;
 const archive=require('./host-archive.cjs').openArchive();const version=JSON.parse(archive.read('dsh/package.json')).version;
 const creator=yaml.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'),{schema})[0].insert[0];archive.close();
 const character=yaml.load(yaml.dump(creator,{schema}),{schema});character.id='preset-qq-character';character.config.id='qq-character';configureWorkers(character);
 character.config.plugins.find(p=>p.id==='persona').config.prefix='Isolated Character fixture. Retain full assistant abilities.';
 character.config.plugins.push({id:'memory-tools',name:local('packages/character-memory-tools/character.mjs')});
 const workers=[workerPreset()];if(extras){workers.push(workerPreset('worker-review'));character.config.plugins.find(p=>p.id==='delegation').config.find(p=>p.id==='tool-subagent').config.allowedAgentPresets.push('worker-review');}
 for(const worker of workers)worker.config.plugins[0].name=local('packages/character-memory-tools/worker.mjs');
 const binding=home+'/binding.json';fs.writeFileSync(binding,JSON.stringify({appId:'mock-app',ownerId:'mock-owner',characterId:'fixture-character',projectId:'fixture-project'}));
 const inserted=[...workers,character,
  {id:'character-identity',name:local('packages/character-identity/index.mjs'),config:{presetId:'qq-character',bindingFile:binding,stateFile:home+'/coordination.sqlite',memoryMode:'character'}},
  {id:'memory-core',name:local('packages/character-memory-core/index.mjs'),config:{database:home+'/memory.sqlite',autoCapture:true,idleMs:50,consolidation:false}},
  ...(extras?[{id:'memory-inspector',name:local('packages/memory-inspector/index.mjs'),config:{writable:true}}]:[]),
  {id:'inspector-probe',name:local('tests/inspector-host.mjs'),config:{cwd:home,result:home+'/result.json',runId,extras,version,preview:process.argv.includes('--preview')}}];
 fs.writeFileSync(dir+'/package.json',JSON.stringify({name:'inspector-fixture',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
 fs.writeFileSync(dir+'/cordis.patch.yml',yaml.dump([{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',disabled:true},{insert:inserted}],{schema,noRefs:true}));
 fs.writeFileSync(root+'/test-data/inspector-run.json',JSON.stringify({home,result:home+'/result.json',runId,extras}));console.log(JSON.stringify({home,runId,extras,productionCopied:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
