import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),helper='../scripts/test-home.cjs';
const fresh=()=>{delete require.cache[require.resolve(helper)];return require(helper);};
test('isolated native-test Homes are created outside any git work tree and marked',()=>{
 const saved=process.env.DSH_CHARACTER_TEST_ROOT;const outside=fs.mkdtempSync(path.join(os.tmpdir(),'character-test-root-'));
 try{
  process.env.DSH_CHARACTER_TEST_ROOT=outside;const {newHome,isTestHome,enclosingRepository}=fresh();
  const home=newHome('lifecycle');assert(home.startsWith(outside+path.sep));assert.equal(enclosingRepository(home),null);assert(isTestHome(home));
  assert(!isTestHome(outside),'an unmarked directory is not a test Home');
  process.env.DSH_CHARACTER_TEST_ROOT=path.join(process.cwd(),'test-data','homes');
  assert.throws(()=>fresh().newHome('inspector'),/outside any git work tree/,'a root inside this repository is refused');
 }finally{if(saved===undefined)delete process.env.DSH_CHARACTER_TEST_ROOT;else process.env.DSH_CHARACTER_TEST_ROOT=saved;fs.rmSync(outside,{recursive:true,force:true});}
});
test('no native-test staging builds a Host Home inside the project',()=>{
 for(const file of ['stage-inspector.cjs','stage-interaction.cjs','stage-lifecycle.cjs','run-schedule-migration.ps1']){
  const source=fs.readFileSync(new URL('../scripts/'+file,import.meta.url),'utf8');
  assert(source.includes('test-home.cjs'),file+' uses the isolated Home helper');
  assert(!/test-data['"\/,\s]+(?:inspector|interaction|lifecycle|migration)-(?!run\.json)/u.test(source),file+' builds no Home under test-data');
 }
 assert(fs.readFileSync(new URL('../scripts/stage-roles.cjs',import.meta.url),'utf8').includes("isTestHome(home)"));
 const runner=fs.readFileSync(new URL('../scripts/run-native-gates.ps1',import.meta.url),'utf8');
 assert(runner.includes('-RedirectStandardOutput')&&runner.includes('WaitForExit($gateTimeoutSeconds*1000)'),'the runner awaits the gate process, not its output pipe');
 assert(!runner.includes('| Out-String;$code'),'no pipe capture of gate output');
});
