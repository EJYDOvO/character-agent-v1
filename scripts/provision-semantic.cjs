// Prepares the embedding runtime and model at the paths a Character build declares
// (build config "semanticRecall", defaults under <DSH_INSTALL_ROOT>/data/semantic-recall).
//   DSH_INSTALL_ROOT=<install> [DSH_CHARACTER_BUILD_CONFIG=<config>] node scripts/provision-semantic.cjs [--from <downloaded model dir>] [--skip-runtime]
// Downloads about 900 MB unless --from points at already downloaded files. Never touches Memory data.
const path=require('node:path'),cp=require('node:child_process');
const local=require('./card-source.cjs').readConfig();
const s=require('./semantic-settings.cjs').semanticSettings(local.semanticRecall,{install:require('./installation.cjs').install,dataDirectory:'(not used)'});
if(s.mode==='off'){console.log(JSON.stringify({skipped:'semanticRecall.mode is off'}));process.exit(0);}
const passthrough=process.argv.slice(2).filter(a=>a==='--skip-runtime'||a==='--from'||process.argv[process.argv.indexOf(a)-1]==='--from');
const result=cp.spawnSync(process.execPath,[path.join(__dirname,'..','packages','memory-semantic','provision.mjs'),'--runtime-dir',s.runtimeDir,'--model-dir',s.modelDir,...passthrough],{stdio:'inherit',windowsHide:true});
process.exit(result.status??1);
