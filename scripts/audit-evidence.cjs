const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
module.exports=function evidence(){const root=path.resolve(__dirname,'..'),hash=crypto.createHash('sha256');
 function walk(dir){for(const name of fs.readdirSync(dir).sort()){if(name==='node_modules'||name==='.git')continue;const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else if(/\.(mjs|cjs|js|ps1|json)$/.test(name)){hash.update(path.relative(root,file).replaceAll('\\','/'));hash.update(fs.readFileSync(file));}}}
 for(const folder of ['packages','scripts','tests'])walk(path.join(root,folder));
 return {baseSha:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),workingTreeDirty:!!cp.execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),codeSha256:hash.digest('hex'),node:process.version};
};
if(require.main===module)console.log(JSON.stringify(module.exports()));
