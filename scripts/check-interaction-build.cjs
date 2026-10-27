// Build only in a fresh fixture. Never load the project's private persona/config.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'test-data'),{recursive:true});
const fixture=fs.mkdtempSync(path.join(root,'test-data','interaction-build-'));
for(const file of ['package.json','scripts/build.cjs','scripts/build-settings.cjs','scripts/build-inputs.cjs','scripts/definition-source.cjs','scripts/installation.cjs','scripts/host-archive.cjs','packages/character-definition/loader.mjs','packages/character-definition/workers.mjs','packages/character-memory-tools/worker-policy.mjs','packages/interaction-policy/policy.mjs']){
 const dest=path.join(fixture,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);
}
fs.writeFileSync(path.join(fixture,'fixture.yaml'),'id: fixture\nname: Fixture\ncharacter:\n  identity: Isolated build fixture.\n');
const extras=path.join(fixture,'bundles/character-extras/cordis.patch.yml');fs.mkdirSync(path.dirname(extras),{recursive:true});
const optional='# Keep reviewed optional declarations unchanged.\n[]\n';fs.writeFileSync(extras,optional);
const configs=[];
for(const mode of ['on','off']){
 const community=mode==='on'?[{id:'root-planner-worker',alias:'external-planner'}]:[];
 fs.mkdirSync(path.join(fixture,'private'),{recursive:true});fs.writeFileSync(path.join(fixture,'private/build-config.json'),JSON.stringify({communityWorkerPresets:community}));
 const env={...process.env,DSH_CHARACTER_INTERACTION:mode,DSH_CHARACTER_PRESET_ID:'fixture-character',DSH_CHARACTER_DATA_DIR:path.join(fixture,'data'),DSH_CHARACTER_DEFINITION:path.join(fixture,'fixture.yaml')};
 const result=spawnSync(process.execPath,[path.join(fixture,'scripts/build.cjs')],{env,cwd:fixture,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
 const manifest=JSON.parse(fs.readFileSync(path.join(fixture,'artifacts/build-manifest.json'),'utf8'));
 const patch=fs.readFileSync(path.join(fixture,'bundles/character-core/cordis.patch.yml'),'utf8');
 assert.equal(manifest.workerPolicyVersion,3);assert.equal(manifest.workerPresets.length,7+community.length);
 for(const id of manifest.workerPresets.filter(id=>id!=='root-planner-worker'))assert(patch.includes('id: preset-'+id),'Missing independent Worker declaration');
 assert(!patch.includes('worker-boundary')&&!patch.includes('dsh-character-memory-tools/worker.mjs'));
 assert(!patch.includes('id: preset-root-planner-worker'),'External presets must not be cloned or installed');
 assert(!manifest.workerPresets.includes('external-planner'));
 assert.deepEqual(manifest.settings.communityWorkerPresets,community);
 const yaml=require(require.resolve('js-yaml',{paths:[process.env.DSH_INSTALL_ROOT+'/data/profiles/desktop']}));
 const schema=yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:value=>({expression:value})}));
 const character=yaml.load(patch,{schema})[0].insert.find(row=>row.config?.id==='fixture-character');
 const spawn=character.config.plugins.find(p=>p.id==='delegation').config.find(p=>p.id==='tool-subagent');
 assert.deepEqual(spawn.config.allowedAgentPresets,manifest.workerPresets);
 assert.deepEqual(character.config.plugins.find(p=>p.id==='character-memory-tools').config.communityWorkerPresets,community);
 assert.equal(manifest.characterPluginIds.includes('interaction-policy'),mode==='on');
 assert.equal(patch.includes('name: dsh-interaction-policy'),mode==='on');
 if(mode==='on')assert.match(patch,/interactionPolicy: true/);
 assert(manifest.creatorPluginIds.every(id=>manifest.characterPluginIds.includes(id)));
 assert.equal(fs.readFileSync(extras,'utf8'),optional);
 configs.push({mode,creatorPluginsPreserved:true,extrasUnchanged:true,optionalEntry:mode==='on'});
}
for(const community of [['fixture-character'],['cordis'],[{id:'one',alias:'worker-general'}],[{id:'one'},'one']]){
 fs.writeFileSync(path.join(fixture,'private/build-config.json'),JSON.stringify({communityWorkerPresets:community}));
 const failed=spawnSync(process.execPath,[path.join(fixture,'scripts/build.cjs')],{env:{...process.env,DSH_CHARACTER_PRESET_ID:'fixture-character',DSH_CHARACTER_DATA_DIR:path.join(fixture,'data'),DSH_CHARACTER_DEFINITION:path.join(fixture,'fixture.yaml')},cwd:fixture,encoding:'utf8',windowsHide:true});assert.notEqual(failed.status,0,'Unsafe configuration must reject the build');
}
console.log(JSON.stringify({ok:true,privateConfigCopied:false,configs}));
