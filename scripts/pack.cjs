const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');const project=path.resolve(__dirname,'..'),root=require('./installation.cjs').install;
require('./ensure-build.cjs');const output=project+'/artifacts/packages';fs.mkdirSync(output,{recursive:true});
for(const folder of ['packages/character-identity','packages/character-memory-core','packages/character-memory-tools','packages/character-qq-adapter','packages/interaction-policy','bundles/character-core','bundles/character-extras'])execFileSync(process.execPath,[root+'/resources/runtime/pnpm/bin/pnpm.cjs','pack','--pack-destination',output],{cwd:project+'/'+folder,stdio:'inherit'});
// Independent reviewed QQTK dependency, never a second bundled QQ gateway.
const toolkit=process.env.DSH_QQTK_PROJECT?path.resolve(process.env.DSH_QQTK_PROJECT):root;
execFileSync(process.execPath,[root+'/resources/runtime/pnpm/bin/pnpm.cjs','pack','--pack-destination',output],{cwd:toolkit+'/plugin-sources/dsh-remote-ops',stdio:'inherit'});
fs.writeFileSync(project+'/artifacts/package-source.json',JSON.stringify({sourceDigest:require('./source-digest.cjs')(),at:new Date().toISOString()}));
