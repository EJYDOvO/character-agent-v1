const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=()=>{const h=createHash('sha256');for(const f of ['scripts/build.cjs','scripts/build-settings.cjs','packages/character-definition/workers.mjs'])h.update(fs.readFileSync(path.resolve(__dirname,'..',f)));return h.digest('hex');};
