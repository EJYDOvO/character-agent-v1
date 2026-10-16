const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install,live=install+'/data/profiles/desktop';
const yaml=require(require.resolve('js-yaml',{paths:[live]}));
const home=root+'/test-data/home',stage=home+'/profiles/character-test';
fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(root+'/test-data/state',{recursive:true});
const manifest=JSON.parse(fs.readFileSync(live+'/package.json','utf8'));
for(const kind of ['identity','memory-core','memory-tools','qq-adapter'])manifest.dependencies['dsh-character-'+kind]='file:'+root.replaceAll('\\','/')+'/packages/character-'+kind;
for(const kind of ['core','extras'])manifest.dependencies['dsh-character-'+kind]='file:'+root.replaceAll('\\','/')+'/bundles/character-'+kind;
manifest.name='dsh-profile-character-test';
manifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@deepseek-ai/dsh-experimental-schedule-bundle','dsh-character-core',...(process.argv.includes('--extras')?['dsh-character-extras']:[])];
fs.writeFileSync(stage+'/package.json',JSON.stringify(manifest,null,2));
fs.copyFileSync(live+'/pnpm-workspace.yaml',stage+'/pnpm-workspace.yaml');
fs.mkdirSync(stage+'/patches',{recursive:true});fs.copyFileSync(install+'/maintenance/patches/dsh-qqbot@0.5.2.patch',stage+'/patches/dsh-qqbot@0.5.2.patch');
fs.writeFileSync(root+'/test-data/state/binding.json',JSON.stringify({appId:'mock-app',ownerId:'mock-owner',characterId:'character-a',projectId:'personal'}));
const state=(root+'/test-data/state').replaceAll('\\','/');
const rows=[{id:'im-qqbot',disabled:true},{id:'qq-remote-ops',disabled:true},
 {id:'character-identity',config:{bindingFile:state+'/binding.json',stateFile:state+'/coordination.sqlite'}},
 {id:'character-memory-core',config:{database:state+'/memory.sqlite',autoCapture:true}}];
fs.writeFileSync(stage+'/cordis.patch.yml',yaml.dump(rows));
console.log(JSON.stringify({stage,home,productionCredentialsCopied:false,qqDisabled:true,extras:process.argv.includes('--extras')}));
