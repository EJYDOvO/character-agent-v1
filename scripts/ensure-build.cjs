const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
const a=require(install+'/maintenance/read-asar.cjs').openArchive();const creator=a.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'),version=JSON.parse(a.read('dsh/package.json')).version;a.close();
const manifest=JSON.parse(fs.readFileSync(root+'/artifacts/build-manifest.json','utf8'));
const releaseChanged=JSON.parse(fs.readFileSync(root+'/packages/character-identity/package.json','utf8')).version!==JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
const changed=releaseChanged||manifest.creatorSha256!==crypto.createHash('sha256').update(creator).digest('hex')||manifest.version!==version;
if(changed&&process.argv.includes('--check'))throw Error('Official Creator changed; rebuild and validate before deploy');
if(changed){execFileSync(process.execPath,[path.join(__dirname,'build.cjs')],{stdio:'inherit'});console.log('Official Creator change detected and rebuilt; host regression remains required.');}else console.log('Creator fingerprint unchanged');
