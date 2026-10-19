// Creates an isolated, QQ-free native DSH profile. Never opens production databases.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
const yaml=require(require.resolve('js-yaml',{paths:[install+'/data/profiles/desktop']}));
class Expression{constructor(value){this.value=value;}}
const schema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new Expression(v),instanceOf:Expression,represent:v=>v.value})]);
const home=path.resolve(process.env.DSH_CHARACTER_TEST_HOME||root+'/test-data/layered-home');
if(!home.startsWith(path.resolve(root,'test-data')+path.sep))throw Error('Layered test home must be inside project test-data');
const dir=home+'/profiles/layered-memory';fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(root+'/artifacts',{recursive:true});
const resultDir=process.env.DSH_CHARACTER_TEST_HOME?home+'/results':root+'/artifacts';fs.mkdirSync(resultDir,{recursive:true});
const modelRows=yaml.load(fs.readFileSync(install+'/data/profiles/desktop/cordis.patch.yml','utf8'),{schema}).filter(r=>['agent-default-model','llm-pi-ai'].includes(r.id));
// Only environment names actually referenced by model configuration are eligible.
const names=new Set(JSON.stringify(modelRows).match(/\b[A-Z][A-Z0-9_]{2,}\b/g)??[]),env=install+'/data/.env';
if(fs.existsSync(env))fs.writeFileSync(home+'/.env',fs.readFileSync(env,'utf8').split(/\r?\n/).filter(line=>names.has(/^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])).join('\n'));
const archive=require('./host-archive.cjs').openArchive(),creator=yaml.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'),{schema})[0].insert[0];archive.close();
creator.id='preset-layered-memory';creator.config.id='layered-memory';creator.config.name='Isolated layered memory';creator.config.plugins.push({id:'memory-tools',name:'dsh-character-memory-tools'});
const runId=randomUUID(),mode=process.argv[2]??'character';if(!['off','assistant','character'].includes(mode))throw Error('Invalid mode');
const normalized=root.replaceAll('\\','/'),state=home+'/state';fs.mkdirSync(state,{recursive:true});
const rows=[...modelRows,{insert:[
 {id:'local-memory-identity',name:normalized+'/examples/local-agent/identity.mjs',config:{principalId:'synthetic-owner',namespaceId:'isolated-layered',projectId:'layered-validation',allowedPresetId:'layered-memory',agentId:'test-agent',memoryMode:mode}},
 {id:'memory-core',name:'dsh-character-memory-core',config:{database:state.replaceAll('\\','/')+'/'+mode+'.sqlite',autoCapture:true,idleMs:1000,extractTimeoutMs:90000,consolidateIntervalMs:0,consolidation:mode==='character'&&!process.argv.includes('--restart')}},
 creator,{id:'layered-probe',name:normalized+'/tests/layered-host.mjs',config:{cwd:root,result:resultDir.replaceAll('\\','/')+'/layered-host-'+mode+'.json',runId,mode,restartOnly:process.argv.includes('--restart')}}
]}];
fs.writeFileSync(dir+'/package.json',JSON.stringify({name:'dsh-profile-layered-memory',private:true,dependencies:Object.fromEntries(['core','tools'].map(k=>['dsh-character-memory-'+k,'file:'+normalized+'/packages/character-memory-'+k])),dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}},null,2));
fs.writeFileSync(dir+'/pnpm-workspace.yaml','packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
fs.writeFileSync(dir+'/cordis.patch.yml',yaml.dump(rows,{schema,noRefs:true,lineWidth:120}));
fs.writeFileSync(home+'/run.json',JSON.stringify({runId,mode}));console.log(JSON.stringify({staged:true,runId,mode,profile:dir,qq:false}));
