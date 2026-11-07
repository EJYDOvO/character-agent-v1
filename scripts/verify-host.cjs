// Verify that DSH_CHARACTER_HOST_ROOT is exactly the pinned official test Host
// before any native gate runs. Read-only: hashes files, never starts the Host.
// A missing, different or unsigned Host is a failure, never a skipped pass.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const PIN=path.join(__dirname,'..','docs','evidence','native-host-pin.json');

function fileHash(file){const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buf=Buffer.alloc(1<<20);
 try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)hash.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}return hash.digest('hex');}
// Ordered relative paths and contents: a renamed, added or changed file differs.
function treeHash(dir){const hash=crypto.createHash('sha256');
 (function walk(d){for(const name of fs.readdirSync(d).sort()){const f=path.join(d,name),st=fs.lstatSync(f);
  if(st.isSymbolicLink())throw Error('Unexpected link in Host tree: '+path.relative(dir,f));
  const rel=path.relative(dir,f).replaceAll('\\','/');
  if(st.isDirectory()){hash.update('D '+rel+'\n');walk(f);}else{hash.update('F '+rel+' '+fileHash(f)+'\n');}}})(dir);
 return hash.digest('hex');}
function readVersion(root){
 const prev=process.env.DSH_CHARACTER_HOST_ROOT;process.env.DSH_CHARACTER_HOST_ROOT=root;
 try{delete require.cache[require.resolve('./host-archive.cjs')];const a=require('./host-archive.cjs').openArchive();try{return JSON.parse(a.read('dsh/package.json')).version;}finally{a.close();}}
 finally{if(prev===undefined)delete process.env.DSH_CHARACTER_HOST_ROOT;else process.env.DSH_CHARACTER_HOST_ROOT=prev;delete require.cache[require.resolve('./host-archive.cjs')];}
}
function authenticode(exe){
 if(process.platform!=='win32')return {status:'unsupported-platform',signer:null};
 const script="$s=Get-AuthenticodeSignature -LiteralPath $env:VERIFY_HOST_EXE;[pscustomobject]@{status=[string]$s.Status;signer=[string]$s.SignerCertificate.Subject}|ConvertTo-Json -Compress";
 const out=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',env:{...process.env,VERIFY_HOST_EXE:exe},windowsHide:true});
 return JSON.parse(out);
}
function verifyHost(root,pin=JSON.parse(fs.readFileSync(PIN,'utf8')),{signature=authenticode}={}){
 const checks=[],fail=reason=>({ok:false,reason,checks,pin:{version:pin.version}});
 if(!root)return fail('DSH_CHARACTER_HOST_ROOT is not set');
 if(!path.isAbsolute(root))return fail('DSH_CHARACTER_HOST_ROOT must be absolute');
 const exe=path.join(root,pin.executable),asar=path.join(root,'resources','app.asar'),unpacked=asar+'.unpacked';
 for(const f of [exe,asar,unpacked])if(!fs.existsSync(f))return fail('Missing Host file: '+path.relative(root,f));
 let version;try{version=readVersion(root);}catch(e){return fail('Unreadable Host archive: '+e.message);}
 checks.push({check:'version',expected:pin.version,actual:version});if(version!==pin.version)return fail('Host version '+version+' is not the pinned '+pin.version);
 for(const [check,actual] of [['executableSha256',fileHash(exe)],['appAsarSha256',fileHash(asar)],['appAsarUnpackedTreeSha256',treeHash(unpacked)]]){
  checks.push({check,expected:pin[check],actual});if(actual!==pin[check])return fail(check+' differs from the pinned Host');}
 const sig=signature(exe);checks.push({check:'authenticode',expected:{status:'Valid',signerIncludes:pin.signerIncludes},actual:sig});
 if(sig.status!=='Valid'||!String(sig.signer).includes(pin.signerIncludes))return fail('Host executable signature is not the pinned publisher');
 return {ok:true,checks,pin:{version:pin.version}};
}
module.exports={verifyHost,fileHash,treeHash,PIN};
if(require.main===module){
 const root=process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT,write=process.argv.includes('--write-pin');
 if(write){// Maintainer step for a NEW reviewed Host; never run in CI.
  const pin=JSON.parse(fs.readFileSync(PIN,'utf8')),exe=path.join(root,pin.executable),asar=path.join(root,'resources','app.asar');
  Object.assign(pin,{version:readVersion(root),executableSha256:fileHash(exe),appAsarSha256:fileHash(asar),appAsarUnpackedTreeSha256:treeHash(asar+'.unpacked')});
  fs.writeFileSync(PIN,JSON.stringify(pin,null,2)+'\n');console.log(JSON.stringify(pin,null,2));process.exit(0);}
 const result=verifyHost(root);console.log(JSON.stringify(result,null,2));process.exit(result.ok?0:1);
}
