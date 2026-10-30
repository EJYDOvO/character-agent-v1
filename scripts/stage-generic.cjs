// Private fixtures for real installed-host compatibility tests; no credentials in stdout.
const fs=require('fs'),path=require('path');
const project=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
// The reviewed QQ patch and the two Host services it requires come from the same toolkit source.
const toolkit=path.resolve(process.env.DSH_QQTK_PROJECT||path.join(project,'../harness-qq-toolkit')),local=dir=>'file:'+path.join(toolkit,'plugin-sources',dir).replaceAll('\\','/');
const yaml=require(require.resolve('js-yaml',{paths:[install+'/data/profiles/desktop']}));
class Expression{constructor(value){this.value=value;}}
const schema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:v=>new Expression(v),instanceOf:Expression,represent:v=>v.value})]);
const dump=v=>yaml.dump(v,{schema,noRefs:true,lineWidth:120});
const home=project+'/test-data/generic-home';fs.mkdirSync(home,{recursive:true});
const liveRows=yaml.load(fs.readFileSync(install+'/data/profiles/desktop/cordis.patch.yml','utf8'),{schema});
if(fs.existsSync(install+'/data/.env'))fs.copyFileSync(install+'/data/.env',home+'/.env');
const archive=require('./host-archive.cjs').openArchive();
const creator=yaml.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'),{schema})[0].insert[0];archive.close();
for(const kind of ['qq','memory']){
 const dir=home+'/profiles/generic-'+kind,state=home+'/state/'+kind;fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(state,{recursive:true});
 const dependencies=kind==='qq'?{'@tencent-connect/dsh-qqbot':'0.5.2','dsh-agent-io':local('dsh-agent-io'),'dsh-conversation-manager':local('dsh-conversation-manager')}:Object.fromEntries(['core','tools'].map(k=>['dsh-character-memory-'+k,'file:'+project.replaceAll('\\','/')+'/packages/character-memory-'+k]));
 fs.writeFileSync(dir+'/package.json',JSON.stringify({name:'dsh-profile-generic-'+kind,private:true,dependencies,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}},null,2));
 let workspace='packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n';
 const rows=liveRows.filter(r=>['agent-default-model','llm-pi-ai'].includes(r.id));
 if(kind==='qq'){
  workspace+="patchedDependencies:\n  '@tencent-connect/dsh-qqbot@0.5.2': patches/dsh-qqbot@0.5.2.patch\n";
  fs.mkdirSync(dir+'/patches',{recursive:true});fs.copyFileSync(toolkit+'/maintenance/patches/dsh-qqbot@0.5.2.patch',dir+'/patches/dsh-qqbot@0.5.2.patch');
  const config=structuredClone(liveRows.find(r=>r.id==='im-qqbot').config);config.preset='cordis';config.cwd=project;config.debug=false;
  rows.push({insert:[{id:'agent-io',name:'dsh-agent-io',config:{}},{id:'conversation-manager',name:'dsh-conversation-manager',config:{stateFile:state.replaceAll('\\','/')+'/conversations.json'}},{id:'generic-qq',name:'@tencent-connect/dsh-qqbot',config},{id:'generic-qq-probe',name:project.replaceAll('\\','/')+'/tests/generic-qq-host.mjs',config:{result:project.replaceAll('\\','/')+'/artifacts/generic-qq-host.json'}}]});
 }else{
  creator.id='preset-generic-memory';creator.config.id='generic-memory';creator.config.name='Generic memory compatibility';creator.config.plugins.push({id:'generic-memory-tools',name:'dsh-character-memory-tools'});
  rows.push({insert:[{id:'local-memory-identity',name:project.replaceAll('\\','/')+'/examples/local-agent/identity.mjs',config:{principalId:'local-test',namespaceId:'ordinary-agent',projectId:'isolated-compatibility',allowedPresetId:'generic-memory'}},{id:'generic-memory-core',name:'dsh-character-memory-core',config:{database:state.replaceAll('\\','/')+'/memory.sqlite',autoCapture:true}},creator,{id:'generic-memory-probe',name:project.replaceAll('\\','/')+'/tests/generic-memory-host.mjs',config:{cwd:project,result:project.replaceAll('\\','/')+'/artifacts/generic-memory-host.json'}}]});
 }
 fs.writeFileSync(dir+'/pnpm-workspace.yaml',workspace);fs.writeFileSync(dir+'/cordis.patch.yml',dump(rows));
}
console.log(JSON.stringify({staged:true,home,profiles:['generic-qq','generic-memory'],qqCredentials:'private fixture only; single-active gate required'}));
