// Isolated native Host fixture for semantic recall (D1): source copies only, a new empty Home,
// synthetic memories, a deterministic model adapter. No production configuration, data or QQ.
// Needs a provisioned embedding runtime and model (packages/memory-semantic/provision.mjs):
//   DSH_SEMANTIC_RUNTIME_DIR, DSH_SEMANTIC_MODEL_DIR  (absolute paths)
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),yaml=require('js-yaml'),dialect=require('./deployment-plan.cjs').entryYaml(yaml);
const runtimeDir=process.env.DSH_SEMANTIC_RUNTIME_DIR,modelDir=process.env.DSH_SEMANTIC_MODEL_DIR;
for(const [name,dir]of [['DSH_SEMANTIC_RUNTIME_DIR',runtimeDir],['DSH_SEMANTIC_MODEL_DIR',modelDir]])if(!dir||!path.isAbsolute(dir)||!fs.existsSync(dir))throw Error('Set '+name+' to a provisioned absolute directory');
const archive=require('./host-archive.cjs').openArchive(),version=JSON.parse(archive.read('dsh/package.json')).version;
const preset=dialect.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'))[0].insert[0];archive.close();
const home=require('./test-home.cjs').newHome('semantic'),dir=path.join(home,'profiles','semantic'),runId=randomUUID(),local=rel=>pathToFileURL(path.join(root,rel)).href;
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(home,'tmp'));
preset.id='preset-semantic-agent';preset.config.id='semantic-agent';preset.config.name='Semantic recall fixture';
preset.config.plugins.find(p=>p.id==='persona').config.prefix='Synthetic assistant fixture. No private Persona.';
preset.config.plugins.push({id:'memory-tools',name:local('packages/character-memory-tools/index.mjs'),config:{}});
const semantic={indexFile:path.join(home,'memory-vectors.sqlite').replaceAll('\\','/'),indexIntervalMs:400,indexBatch:16,provider:{kind:'subprocess',runtimeDir:runtimeDir.replaceAll('\\','/'),modelDir:modelDir.replaceAll('\\','/'),threads:2,idleUnloadMs:0}};
const rows=[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',disabled:true},{insert:[preset,
 {id:'memory-identity',name:local('examples/local-agent/identity.mjs'),config:{principalId:'fixture-owner',namespaceId:'fixture-character',projectId:'fixture-project',allowedPresetId:'semantic-agent'}},
 {id:'memory-core',name:local('packages/character-memory-core/index.mjs'),config:{database:path.join(home,'memory.sqlite').replaceAll('\\','/'),autoCapture:false,consolidation:false}},
 // Declared through the Host loader exactly as an operator would, and left off: the probe verifies that
 // a declared-but-off plugin changes nothing, then loads shadow/active instances itself.
 {id:'memory-semantic',name:local('packages/memory-semantic/index.mjs'),config:{mode:'off',...semantic}},
 {id:'semantic-probe',name:local('tests/semantic-host.mjs'),config:{cwd:home.replaceAll('\\','/'),result:path.join(home,'result.json'),runId,version,semantic,provenance:require('./audit-evidence.cjs')()}}]}];
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'semantic-fixture',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
fs.writeFileSync(path.join(dir,'cordis.patch.yml'),dialect.dump(rows,{noRefs:true}));
fs.mkdirSync(path.join(root,'test-data'),{recursive:true});fs.writeFileSync(path.join(root,'test-data','semantic-run.json'),JSON.stringify({home,result:path.join(home,'result.json'),runId}));
console.log(JSON.stringify({home,runId,version,productionDataCopied:false,qqNetwork:false}));
