// Native gate bookkeeping without a Host: verification fails closed and a gate
// that is missing, failed or never ran can never be summarized as passed.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyHost,fileHash,treeHash}=require('../scripts/verify-host.cjs');
const {GATES,summarize}=require('../scripts/native-gates.cjs');

function fakeHost(version='0.2.2-rc.1'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fake-host-')),res=path.join(root,'resources'),unpacked=path.join(res,'app.asar.unpacked','dsh');
 fs.mkdirSync(unpacked,{recursive:true});fs.writeFileSync(path.join(unpacked,'package.json'),JSON.stringify({version}));
 const header=Buffer.from(JSON.stringify({files:{dsh:{files:{'package.json':{unpacked:true,size:1}}}}})),prefix=Buffer.alloc(16);
 prefix.writeUInt32LE(8+header.length,4);prefix.writeUInt32LE(header.length,12);fs.writeFileSync(path.join(res,'app.asar'),Buffer.concat([prefix,header]));
 fs.writeFileSync(path.join(root,'Host.exe'),'synthetic executable');
 const pin={version:'0.2.2-rc.1',executable:'Host.exe',signerIncludes:'Publisher',executableSha256:fileHash(path.join(root,'Host.exe')),appAsarSha256:fileHash(path.join(res,'app.asar')),appAsarUnpackedTreeSha256:treeHash(path.join(res,'app.asar.unpacked'))};
 return {root,pin,res,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const signed=()=>({status:'Valid',signer:'CN=Publisher'});

test('the pinned Host verifies; absent, relative or other-version Hosts fail closed',()=>{
 const h=fakeHost();try{
  assert.equal(verifyHost(h.root,h.pin,{signature:signed}).ok,true);
  assert.match(verifyHost(undefined,h.pin,{signature:signed}).reason,/not set/);
  assert.match(verifyHost('relative/host',h.pin,{signature:signed}).reason,/absolute/);
  assert.match(verifyHost(path.join(h.root,'missing'),h.pin,{signature:signed}).reason,/Missing Host file/);
 }finally{h.cleanup();}
 const other=fakeHost('0.2.3');try{assert.match(verifyHost(other.root,other.pin,{signature:signed}).reason,/not the pinned 0\.2\.2-rc\.1/);}finally{other.cleanup();}
});

test('a modified executable, archive or unpacked file, or a bad signature, is refused',()=>{
 for(const tamper of [h=>fs.appendFileSync(path.join(h.root,'Host.exe'),'x'),h=>fs.appendFileSync(path.join(h.res,'app.asar'),'x'),h=>fs.writeFileSync(path.join(h.res,'app.asar.unpacked','extra.js'),'x')]){
  const h=fakeHost();try{tamper(h);const r=verifyHost(h.root,h.pin,{signature:signed});assert.equal(r.ok,false);assert.match(r.reason,/differs from the pinned Host/);}finally{h.cleanup();}
 }
 const h=fakeHost();try{
  assert.match(verifyHost(h.root,h.pin,{signature:()=>({status:'NotSigned',signer:''})}).reason,/signature/);
  assert.match(verifyHost(h.root,h.pin,{signature:()=>({status:'Valid',signer:'CN=Someone Else'})}).reason,/signature/);
  assert.equal(verifyHost(h.root,h.pin,{signature:()=>({status:'unsupported-platform',signer:null})}).ok,false,'no signature check is not a pass');
 }finally{h.cleanup();}
});

test('only every required gate passing on a verified Host is a pass',()=>{
 const all=GATES.map(g=>({id:g.id,exitCode:0,reported:true,seconds:1}));
 assert.equal(summarize({host:{ok:true},results:all}).verdict,'passed');
 const blocked=summarize({host:{ok:false,reason:'DSH_CHARACTER_HOST_ROOT is not set'},results:all});
 assert.equal(blocked.ok,false);assert.equal(blocked.verdict,'blocked');assert(blocked.gates.every(g=>g.status==='not-run'),'gates cannot pass without a verified Host');
 assert.equal(summarize({}).verdict,'blocked');
 const missing=summarize({host:{ok:true},results:all.slice(1)});assert.equal(missing.ok,false);assert.equal(missing.gates[0].status,'not-run');
 const failed=summarize({host:{ok:true},results:all.map((r,i)=>i===1?{...r,exitCode:1}:r)});assert.equal(failed.verdict,'failed');assert.equal(failed.gates[1].status,'failed');
 const silent=summarize({host:{ok:true},results:all.map((r,i)=>i===2?{...r,reported:false}:r)});assert.equal(silent.ok,false,'exit 0 without a reported result is not a pass');
 assert.equal(summarize({host:{ok:true},results:[...all,{id:'invented',exitCode:0,reported:true}]}).ok,false);
});

test('required gates cover Worker, Identity, Schedule and Long Tasks lifecycles with existing scripts',()=>{
 assert.deepEqual(GATES.map(g=>g.id),['lifecycle','workers','roles','schedule-restart']);
 for(const g of GATES)assert(fs.existsSync(new URL('../scripts/'+g.script,import.meta.url)),g.script);
 const pin=JSON.parse(fs.readFileSync(new URL('../docs/evidence/native-host-pin.json',import.meta.url),'utf8'));
 assert.equal(pin.version,'0.2.2-rc.1');for(const k of ['executableSha256','appAsarSha256','appAsarUnpackedTreeSha256'])assert.match(pin[k],/^[0-9a-f]{64}$/,k);
});
