const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');const project=path.resolve(__dirname,'..'),root=require('./installation.cjs').install;
require('./ensure-build.cjs');const output=project+'/artifacts/packages';fs.mkdirSync(output,{recursive:true});
const plan=require('./package-plan.cjs'),selected=process.argv.includes('--core-only')?plan.requiredFolders:plan.folders;
for(const folder of selected)execFileSync(process.execPath,[root+'/resources/runtime/pnpm/bin/pnpm.cjs','pack','--pack-destination',output],{cwd:project+'/'+folder,stdio:'inherit'});
// QQTK releases are independent. Candidate preparation retains its verified
// installed version and hash instead of rebuilding or downgrading it implicitly.
fs.writeFileSync(project+'/artifacts/package-source.json',JSON.stringify({sourceDigest:require('./source-digest.cjs')(),artifacts:plan.inventory(project,selected),at:new Date().toISOString()}));
