// Isolated profile only; no live Profile, credentials, memory or QQ is copied.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),home=path.join(root,'test-data','interaction-'+randomUUID()),dir=path.join(home,'profiles','interaction');
fs.mkdirSync(dir,{recursive:true});
const plugin=require('node:url').pathToFileURL(path.join(root,'packages/interaction-policy/index.mjs')).href;
// Leave headroom for native startup/IO; the slow provider waits twice this limit.
// The fast-no-status and slow-exactly-one-status assertions remain unchanged.
const preset=(id,enabled)=>({id:'preset-'+id,name:'@deepseek-ai/dsh-agent-preset',config:{id,name:id,plugins:[{id:'interaction',name:plugin,isolate:{interactionPolicy:true},config:{enabled,hangOnMs:500,throttleMs:5,hangOnModelFile:path.join(home,'hangon-model.json')}},...(enabled?[{id:'time-context',name:'@deepseek-ai/dsh-time-context',config:{refreshIntervalMs:1}}]:[])]}});
const install=require('./installation.cjs').install,yaml=require(require.resolve('js-yaml',{paths:[install+'/data/profiles/desktop']}));
class Expression{constructor(value){this.value=value;}}
const schema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new Expression(v),instanceOf:Expression,represent:v=>v.value})]);
const archive=require('./host-archive.cjs').openArchive();let creator,version;
try{version=JSON.parse(archive.read('dsh/package.json')).version;creator=yaml.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'),{schema})[0].insert[0];}finally{archive.close();}
const control=yaml.load(yaml.dump(creator,{schema}),{schema});control.id='preset-interaction-control';control.config.id='interaction-control';
creator.id='preset-interaction-creator';creator.config.id='interaction-creator';creator.config.plugins.push(preset('unused',true).config.plugins[0]);
const result=path.join(home,'result.json'),runId=randomUUID();
const toolkit=path.resolve(process.env.DSH_QQTK_PROJECT||path.join(root,'../harness-qq-toolkit'));
const qqFixture=path.join(home,'qq-fixture');fs.mkdirSync(qqFixture);
const installedQQ=path.join(install,'data/profiles/desktop/node_modules/@tencent-connect/dsh-qqbot');
fs.cpSync(path.join(installedQQ,'dist'),path.join(qqFixture,'dist'),{recursive:true});
fs.copyFileSync(path.join(installedQQ,'package.json'),path.join(qqFixture,'package.json'));
fs.cpSync(path.join(toolkit,'maintenance/qqbot-src/dist'),path.join(qqFixture,'dist'),{recursive:true});
fs.writeFileSync(dir+'/package.json',JSON.stringify({name:'interaction-isolated',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}},null,2));
fs.writeFileSync(dir+'/cordis.patch.yml',yaml.dump([{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',disabled:true},{insert:[preset('interaction-test',true),preset('interaction-off',false),control,creator,{id:'interaction-probe',name:path.join(root,'tests/interaction-host.mjs').replaceAll('\\','/'),config:{cwd:home,result,runId,qqFixture,version,hangOnModelFile:path.join(home,'hangon-model.json')}}]}],{schema,noRefs:true}));
fs.writeFileSync(root+'/test-data/interaction-run.json',JSON.stringify({home,result,runId}));console.log(JSON.stringify({home,result,runId,productionCopied:false}));
