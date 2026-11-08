// Real rc.3 Host with the Character composition of the communication probe,
// turned into the role build: character / character-contact / character-guest
// plus the qq-character Owner alias, Character Identity with roles, and the
// Identity & Access service loaded from QQTK source. Synthetic QQ and LLM only.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
const project=path.resolve(__dirname,'..'),toolkit=path.resolve(process.env.DSH_QQTK_PROJECT||project+'/../harness-qq-toolkit');
// --phase2 <home>: the same staged Home and data, only the probe switches to its restart checks.
const phase2=process.argv.indexOf('--phase2');
if(phase2>=0){
 const home=path.resolve(process.argv[phase2+1]),file=home+'/profiles/inspector/cordis.patch.yml',yaml=require('js-yaml'),dialect=require('./deployment-plan.cjs').entryYaml(yaml);
 if(!require('./test-home.cjs').isTestHome(home))throw Error('Restart phase only on a staged isolated test Home');
 const rows=dialect.load(fs.readFileSync(file,'utf8'));rows.find(r=>r.insert).insert.find(r=>r.id==='inspector-probe').config.phase=2;fs.writeFileSync(file,dialect.dump(rows,{noRefs:true}));
 process.exit(0);
}
cp.execFileSync(process.execPath,[project+'/scripts/stage-communication.cjs'],{stdio:'pipe',windowsHide:true});
const probe=JSON.parse(fs.readFileSync(project+'/test-data/communication-run.json')),dir=probe.home+'/profiles/inspector';
const yaml=require('js-yaml'),dialect=require('./deployment-plan.cjs').entryYaml(yaml),rows=dialect.load(fs.readFileSync(dir+'/cordis.patch.yml','utf8'));
const inserted=rows.find(r=>r.insert).insert,entry=inserted.find(r=>r.id==='inspector-probe');
entry.name=pathToFileURL(project+'/tests/roles-host.mjs').href;
(async()=>{
 const {rolePresets,TOOL_SCOPE}=await import(pathToFileURL(project+'/packages/character-definition/role-presets.mjs').href);
 const index=inserted.findIndex(r=>r.id==='preset-qq-character');if(index<0)throw Error('Character fixture Preset missing');
 const presets=rolePresets({owner:inserted[index],publicPersona:'Synthetic public Character persona. Answer briefly.',legacyOwner:'qq-character'});
 for(const row of presets)for(const plugin of row.config.plugins)if(plugin.name===TOOL_SCOPE)plugin.name=pathToFileURL(toolkit+'/plugin-sources/dsh-identity-access/tool-scope.mjs').href;
 inserted.splice(index,1,...presets);
 const identity=inserted.find(r=>r.id==='character-identity');
 Object.assign(identity.config,{presetId:'character',legacyPresetIds:['qq-character'],memoryAgentId:'qq-character',roles:{enabled:true,presets:['character-contact','character-guest']}});
 fs.writeFileSync(probe.home+'/identity-owner.json',JSON.stringify({provider:'qq-official:qq-official-gateway:mock-app',subject:'mock-owner'}));
 fs.writeFileSync(dir+'/cordis.patch.yml',dialect.dump(rows,{noRefs:true}));
 if(fs.existsSync(probe.home+'/.env')||fs.existsSync(probe.home+'/.credentials.yaml'))throw Error('Role fixture must have no credentials');
 fs.writeFileSync(project+'/test-data/roles-run.json',JSON.stringify(probe));
 console.log(JSON.stringify({home:probe.home,runId:probe.runId,presets:presets.map(p=>p.config.id),qqNetwork:false,credentialsCopied:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
