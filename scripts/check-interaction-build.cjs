// Build only in a fresh fixture. Never load the project's private persona/config.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'test-data'),{recursive:true});
const fixture=fs.mkdtempSync(path.join(root,'test-data','interaction-build-'));
for(const file of ['package.json','scripts/build.cjs','scripts/build-settings.cjs','scripts/build-inputs.cjs','scripts/card-source.cjs','scripts/card-yaml.cjs','scripts/role-settings.cjs','scripts/installation.cjs','scripts/host-archive.cjs',...['card','card-error','card-normalize','card-reader','card-render','card-tokens'].map(name=>`packages/character-definition/${name}.mjs`),'packages/character-definition/workers.mjs','packages/character-definition/role-presets.mjs','packages/character-memory-tools/worker-policy.mjs','packages/character-memory-tools/subagent.mjs','packages/interaction-policy/policy.mjs']){
 const dest=path.join(fixture,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);
}
fs.writeFileSync(path.join(fixture,'fixture.json'),JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'Fixture',description:'Isolated build fixture. {{random::a,b}} {{ user }} }} {{{char}}} {{',mes_example:'<START>\n{{user}}: hi {{getvar::x}}\n{{char}}: hello'}}));
fs.writeFileSync(path.join(fixture,'fixture-reminder.md'),'Fixture reminder.');
const extras=path.join(fixture,'bundles/character-extras/cordis.patch.yml');fs.mkdirSync(path.dirname(extras),{recursive:true});
const optional='# Keep reviewed optional declarations unchanged.\n[]\n';fs.writeFileSync(extras,optional);
const configs=[],personas=[];
for(const mode of ['on','off']){
 const community=mode==='on'?[{id:'root-planner-worker',alias:'external-planner'}]:[];
 fs.mkdirSync(path.join(fixture,'private'),{recursive:true});fs.writeFileSync(path.join(fixture,'private/build-config.json'),JSON.stringify({communityWorkerPresets:community,rules:{reminderFile:'fixture-reminder.md'}}));
 const env={...process.env,DSH_CHARACTER_INTERACTION:mode,DSH_CHARACTER_PRESET_ID:'fixture-character',DSH_CHARACTER_DATA_DIR:path.join(fixture,'data'),DSH_CHARACTER_CARD:path.join(fixture,'fixture.json')};
 const result=spawnSync(process.execPath,[path.join(fixture,'scripts/build.cjs')],{env,cwd:fixture,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
 const manifest=JSON.parse(fs.readFileSync(path.join(fixture,'artifacts/build-manifest.json'),'utf8'));
 const patch=fs.readFileSync(path.join(fixture,'bundles/character-core/cordis.patch.yml'),'utf8');
 assert.equal(manifest.workerPolicyVersion,4);assert.equal(manifest.workerPresets.length,7+community.length);
 assert.equal(patch.split('name: dsh-character-memory-tools/worker-scope.mjs').length-1,manifest.workerPresets.filter(id=>id!=='root-planner-worker').length,'Every built-in Worker mounts the native tool scope');
 for(const id of manifest.workerPresets.filter(id=>id!=='root-planner-worker'))assert(patch.includes('id: preset-'+id),'Missing independent Worker declaration');
 assert(!patch.includes('worker-boundary')&&!patch.includes('dsh-character-memory-tools/worker.mjs'));
 assert(!patch.includes('id: preset-root-planner-worker'),'External presets must not be cloned or installed');
 assert(!manifest.workerPresets.includes('external-planner'));
 assert.deepEqual(manifest.settings.communityWorkerPresets,community);
 const yaml=require('js-yaml');
 const schema=yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:value=>({expression:value})}));
 const character=yaml.load(patch,{schema})[0].insert.find(row=>row.config?.id==='fixture-character');
 const spawn=character.config.plugins.find(p=>p.id==='delegation').config.find(p=>p.id==='tool-subagent');
 assert.equal(spawn.name,'dsh-character-memory-tools/subagent.mjs');
 assert.deepEqual(spawn.config.allowedAgentPresets,manifest.workerPresets);
 assert.deepEqual(character.config.plugins.find(p=>p.id==='character-memory-tools').config.communityWorkerPresets,community);
 const persona=character.config.plugins.find(p=>p.id==='persona').config;
 assert(persona.prefix.includes('## 角色：Fixture\nIsolated build fixture.'),'Persona prefix comes from the card');
 assert(persona.suffix.includes('用户: hi {getvar::x}\nFixture: hello'),'Persona suffix holds the card examples');
 assert.equal(character.config.plugins.find(p=>p.id==='character-memory-tools').config.reminder,'Fixture reminder.');personas.push(persona);
 assert.equal(manifest.characterId,'character-a');assert.equal(manifest.card.spec,'v3');
 // ensure-build re-reads the files; the build fingerprints the bytes it rendered. Both must agree.
 const revisions=require('./card-source.cjs').cardRevisions({cardPath:path.join(fixture,'fixture.json'),systemRulesPath:null,reminderPath:path.join(fixture,'fixture-reminder.md')});
 assert.equal(manifest.card.revision,revisions.revision);assert.equal(manifest.rulesRevision,revisions.rulesRevision);
 assert.equal(manifest.characterPluginIds.includes('interaction-policy'),mode==='on');
 assert.equal(patch.includes('name: dsh-interaction-policy'),mode==='on');
 if(mode==='on')assert.match(patch,/interactionPolicy: true/);
 assert.equal(patch.includes('styleReminder: Fixture reminder.'),mode==='on','Interaction gets the style reminder');
 assert(manifest.creatorPluginIds.every(id=>manifest.characterPluginIds.includes(id)));
 assert.equal(fs.readFileSync(extras,'utf8'),optional);
 configs.push({mode,creatorPluginsPreserved:true,extrasUnchanged:true,optionalEntry:mode==='on'});
}
for(const community of [['fixture-character'],['cordis'],[{id:'one',alias:'worker-general'}],[{id:'one'},'one']]){
 fs.writeFileSync(path.join(fixture,'private/build-config.json'),JSON.stringify({communityWorkerPresets:community,rules:{reminderFile:'fixture-reminder.md'}}));
 const failed=spawnSync(process.execPath,[path.join(fixture,'scripts/build.cjs')],{env:{...process.env,DSH_CHARACTER_PRESET_ID:'fixture-character',DSH_CHARACTER_DATA_DIR:path.join(fixture,'data'),DSH_CHARACTER_CARD:path.join(fixture,'fixture.json')},cwd:fixture,encoding:'utf8',windowsHide:true});assert.notEqual(failed.status,0,'Unsafe configuration must reject the build');
}
// The Host's own renderer with no prompt variables registered: a reference
// left anywhere in the built Persona would throw here, as it would at runtime.
require('./host-prompt.cjs').hostPromptRenderer(fs.mkdtempSync(path.join(root,'test-data','host-prompt-'))).then(({renderPrompt})=>{
 for(const persona of personas)assert.equal(renderPrompt({sections:[{name:'deployment:persona-prefix',text:persona.prefix},{name:'deployment:persona-suffix',text:persona.suffix}],variables:{}}),persona.prefix+'\n\n'+persona.suffix);
 console.log(JSON.stringify({ok:true,privateConfigCopied:false,hostPromptRendered:personas.length,configs}));
}).catch(e=>{console.error(e);process.exitCode=1;});
