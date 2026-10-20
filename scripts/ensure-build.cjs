const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),install=require('./installation.cjs').install;
const a=require('./host-archive.cjs').openArchive();const creator=a.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml'),version=JSON.parse(a.read('dsh/package.json')).version;a.close();
const manifest=fs.existsSync(root+'/artifacts/build-manifest.json')?JSON.parse(fs.readFileSync(root+'/artifacts/build-manifest.json','utf8')):{};
const releaseChanged=JSON.parse(fs.readFileSync(root+'/packages/character-identity/package.json','utf8')).version!==JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
const definitionRevision=crypto.createHash('sha256').update(fs.readFileSync(require('./definition-source.cjs')())).digest('hex');
const changed=manifest.buildSourceDigest!==require('./build-inputs.cjs')()||JSON.stringify(manifest.settings)!==JSON.stringify(require('./build-settings.cjs')())||releaseChanged||manifest.definitionRevision!==definitionRevision||manifest.creatorSha256!==crypto.createHash('sha256').update(creator).digest('hex')||manifest.version!==version;
if(changed&&process.argv.includes('--check'))throw Error('Creator, release or character definition changed; rebuild and validate before deploy');
if(changed){execFileSync(process.execPath,[path.join(__dirname,'build.cjs')],{stdio:'inherit'});console.log('Official Creator change detected and rebuilt; host regression remains required.');}else console.log('Creator fingerprint unchanged');
