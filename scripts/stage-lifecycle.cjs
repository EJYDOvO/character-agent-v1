// Isolated rc.2 lifecycle fixture: code copies only, no production preferences/data.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const project=path.resolve(__dirname,'..'),install=require('./installation.cjs').install,toolkit=path.resolve(process.env.DSH_QQTK_PROJECT||path.join(project,'../harness-qq-toolkit'));
for(const [name,version]of [['dsh-qqbot','0.5.2'],['qqbot-nodejs','1.0.5']])if(JSON.parse(fs.readFileSync(install+'/data/profiles/desktop/node_modules/@tencent-connect/'+name+'/package.json')).version!==version)throw Error('Revalidate installed QQ package version');
for(const args of [[],['--sdk']])require('node:child_process').execFileSync(process.execPath,[toolkit+'/maintenance/build-qqbot-patch.cjs',...args,'--check'],{stdio:'pipe',windowsHide:true});
const provenance={...require('./audit-evidence.cjs')(),qqPatches:Object.fromEntries(['dsh-qqbot@0.5.2.patch','qqbot-nodejs@1.0.5.patch'].map(file=>[file,createHash('sha256').update(fs.readFileSync(toolkit+'/maintenance/patches/'+file)).digest('hex')]))};
const yaml=require(require.resolve('js-yaml',{paths:[install+'/data/profiles/desktop']})),dialect=require('./deployment-plan.cjs').entryYaml(yaml),archive=require('./host-archive.cjs').openArchive();
const version=JSON.parse(archive.read('dsh/package.json')).version;if(!['0.2.1-rc.2','0.2.1-rc.3'].includes(version))throw Error('Revalidate lifecycle SDK fixture for this Host');
const creator=dialect.load(archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'))[0].insert[0];archive.close();
const home=path.join(project,'test-data','lifecycle-'+randomUUID()),dir=home+'/profiles/lifecycle',runId=randomUUID(),local=rel=>pathToFileURL(path.join(project,rel)).href;
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(home+'/tmp');
const pnpm=install+'/resources/runtime/pnpm/bin/pnpm.cjs',managerSource=toolkit+'/plugin-sources/dsh-conversation-manager';
require('node:child_process').execFileSync(process.execPath,[pnpm,'pack','--pack-destination',home+'/tmp'],{cwd:managerSource,stdio:'pipe',windowsHide:true});
const managerPackage=home+'/tmp/'+JSON.parse(fs.readFileSync(managerSource+'/package.json')).name+'-'+JSON.parse(fs.readFileSync(managerSource+'/package.json')).version+'.tgz';
fs.writeFileSync(dir+'/package.json',JSON.stringify({private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
require('node:child_process').execFileSync(process.execPath,[pnpm,'add','--offline','--ignore-scripts','--config.auto-install-peers=false','--node-linker=hoisted','--store-dir',home+'/store','file:'+managerPackage],{cwd:dir,stdio:'pipe',windowsHide:true});
provenance.conversationPackageSha256=createHash('sha256').update(fs.readFileSync(managerPackage)).digest('hex');
const qq=home+'/qq-fixture';fs.cpSync(install+'/data/profiles/desktop/node_modules/@tencent-connect/dsh-qqbot/dist',qq+'/dist',{recursive:true});fs.cpSync(toolkit+'/maintenance/qqbot-src/dist',qq+'/dist',{recursive:true});
fs.writeFileSync(qq+'/package.json',JSON.stringify({type:'module'}));
creator.id='preset-qq-character';creator.config.id='qq-character';creator.config.plugins.find(p=>p.id==='persona').config.prefix='Synthetic Character. No private Persona.';
fs.writeFileSync(home+'/binding.json',JSON.stringify({appId:'fixture-app',ownerId:'fixture-owner',characterId:'fixture-character',projectId:'fixture-project'}));
const rows=[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',disabled:true},{id:'agent-default-model',config:{provider:'task-fixture',model:'fixture'}},{insert:[creator,
 {id:'identity',name:local('packages/character-identity/index.mjs'),config:{presetId:'qq-character',bindingFile:home+'/binding.json',stateFile:home+'/coordination.sqlite',memoryMode:'character'}},
 {id:'memory',name:local('packages/character-memory-core/index.mjs'),config:{database:home+'/memory.sqlite',autoCapture:false,consolidation:false}},
 {id:'long-tasks',name:local('tests/lifecycle-fixture.mjs'),config:{cwd:home,conversationModule:pathToFileURL(dir+'/node_modules/dsh-conversation-manager/index.mjs').href,conversationStateFile:home+'/conversations.json',allowTools:['task_fixture_read'],taskPlugins:[{id:'fixture-read',name:local('tests/task-fixture-tools.mjs')}]}},
 {id:'probe',name:local('tests/lifecycle-host.mjs'),config:{cwd:home,result:home+'/result.json',runId,qqFixture:qq,version,provenance}}
]}];
fs.writeFileSync(dir+'/cordis.patch.yml',dialect.dump(rows,{noRefs:true}));
fs.writeFileSync(project+'/test-data/lifecycle-run.json',JSON.stringify({home,runId,result:home+'/result.json'}));console.log(JSON.stringify({home,runId,version,qqNetwork:false,productionDataCopied:false}));
