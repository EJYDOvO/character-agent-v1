import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('T14 failed Profile switch restores Profile, QQ routing, binding and maintenance policy',()=>{
 const root=mkdtempSync(join(tmpdir(),'profile-switch-')),state=join(root,'data/maintenance/character-deploy'),live=join(root,'data/profiles/desktop'),candidate=join(root,'data/profiles/candidate');
 for(const dir of [state,live,candidate,join(root,'data/qqbot'),join(root,'data/character'),join(root,'maintenance')])mkdirSync(dir,{recursive:true});
 const original={profile:'{"name":"previous"}',prefs:'{"sessionIds":{"existing":"stable-session"}}',binding:'{"appId":"old-app","ownerId":"old-owner"}',policy:'{"sentinel":"unchanged"}'};
 writeFileSync(join(live,'package.json'),original.profile);writeFileSync(join(candidate,'package.json'),'{}');writeFileSync(join(root,'data/qqbot/model-prefs.json'),original.prefs);writeFileSync(join(root,'data/character/binding.json'),original.binding);writeFileSync(join(root,'maintenance/plugin-policy.json'),original.policy);
 // Missing localPackages makes the real switch fail AFTER binding/routing writes.
 writeFileSync(join(state,'binding.json'),JSON.stringify({appId:'new-app',ownerId:'new-owner'}));writeFileSync(join(state,'candidate.json'),JSON.stringify({candidate,verifiedAt:new Date().toISOString(),sealed:{'package.json':createHash('sha256').update('{}').digest('hex')},artifacts:{'dsh-remote-ops-local':{version:'fixture'}}}));
 assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/switch-profile.cjs',import.meta.url))],{env:{...process.env,DSH_INSTALL_ROOT:root},stdio:'pipe'}),error=>/Cannot set properties of undefined/.test(error.stderr?.toString())&&/dsh-remote-ops-local/.test(error.stderr.toString()),'Must reach the injected failure after routing writes, not an unrelated permission/launch error');
 for(const [file,text]of [[join(live,'package.json'),original.profile],[join(root,'data/qqbot/model-prefs.json'),original.prefs],[join(root,'data/character/binding.json'),original.binding],[join(root,'maintenance/plugin-policy.json'),original.policy]])assert.equal(readFileSync(file,'utf8'),text);
});
test('Profile switch updates all reviewed artifact pins and preserves existing QQ Session and unrelated policy',()=>{
 const root=mkdtempSync(join(tmpdir(),'profile-switch-pins-')),state=join(root,'data/maintenance/character-deploy'),live=join(root,'data/profiles/desktop'),candidate=join(root,'data/profiles/candidate');
 for(const dir of [state,live,candidate,join(root,'data/qqbot'),join(root,'data/character'),join(root,'maintenance')])mkdirSync(dir,{recursive:true});
 const key='qqbot:fixture-app:c2c:fixture-owner',prefs={sessionIds:{[key]:'stable-session'},presets:{[key]:'qq-character'}},binding={appId:'fixture-app',ownerId:'fixture-owner',projectId:'fixture-project',characterId:'fixture-character'};
 const artifacts=Object.fromEntries(['dsh-remote-ops-local','dsh-character-core','dsh-character-memory-core','dsh-memory-inspector'].map(name=>[name,{source:'file:/fixture/'+name+'.tgz',version:'new',sha256:'fixture-'+name}]));
 const retained={source:'file:/fixture/unrelated.tgz',version:'unchanged',sha256:'unchanged'};
 writeFileSync(join(live,'package.json'),'{"name":"previous"}');writeFileSync(join(candidate,'package.json'),'{"name":"candidate"}');
 writeFileSync(join(root,'data/qqbot/model-prefs.json'),JSON.stringify(prefs));writeFileSync(join(root,'data/character/binding.json'),JSON.stringify(binding));
 writeFileSync(join(root,'maintenance/plugin-policy.json'),JSON.stringify({sentinel:'preserved',localPackages:{'dsh-character-core':{version:'old'},unrelated:retained}}));
 writeFileSync(join(state,'binding.json'),JSON.stringify(binding));writeFileSync(join(state,'candidate.json'),JSON.stringify({candidate,verifiedAt:new Date().toISOString(),sealed:{'package.json':createHash('sha256').update('{"name":"candidate"}').digest('hex')},artifacts}));
 execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/switch-profile.cjs',import.meta.url))],{env:{...process.env,DSH_INSTALL_ROOT:root},stdio:'pipe'});
 const policy=JSON.parse(readFileSync(join(root,'maintenance/plugin-policy.json'),'utf8'));
 assert.deepEqual(policy.localPackages,{...artifacts,unrelated:retained});assert.equal(policy.sentinel,'preserved');
 assert.deepEqual(JSON.parse(readFileSync(join(root,'data/qqbot/model-prefs.json'),'utf8')),prefs);
 assert.deepEqual(JSON.parse(readFileSync(join(root,'data/character/binding.json'),'utf8')),binding);
 assert.equal(JSON.parse(readFileSync(join(live,'package.json'),'utf8')).name,'candidate');
});
