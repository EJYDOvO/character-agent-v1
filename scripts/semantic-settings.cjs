// Semantic recall settings of a Character build (build config key "semanticRecall").
// Every normal Character build declares the plugin with mode "active". The model and its runtime are
// provisioned separately (scripts/provision-semantic.cjs); until they are, the plugin reports
// "unavailable" and Memory runs on FTS5.
const path=require('node:path');
const KEYS=['mode','runtimeDir','modelDir','threads'];
function semanticSettings(value,{install,dataDirectory}){
 const c=value??{};
 if(typeof c!=='object'||Array.isArray(c))throw Error('Invalid semanticRecall: expected an object');
 const unknown=Object.keys(c).filter(k=>!KEYS.includes(k));if(unknown.length)throw Error(`Unknown semanticRecall key ${unknown.join(', ')}: expected ${KEYS.join(', ')}`);
 const mode=c.mode??'active';if(!['active','shadow','off'].includes(mode))throw Error('semanticRecall.mode must be active, shadow or off');
 const dir=(v,fallback,name)=>{const p=v??fallback;if(typeof p!=='string'||!path.isAbsolute(p))throw Error(`semanticRecall.${name} must be an absolute path`);return path.normalize(p).replaceAll('\\','/');};
 const base=path.join(install,'data','semantic-recall');
 const threads=c.threads??2;if(!Number.isInteger(threads)||threads<0||threads>16)throw Error('semanticRecall.threads must be an integer from 0 to 16');
 return {mode,runtimeDir:dir(c.runtimeDir,path.join(base,'runtime'),'runtimeDir'),modelDir:dir(c.modelDir,path.join(base,'models'),'modelDir'),threads,indexFile:dataDirectory+'/memory-vectors.sqlite'};
}
// The Core row. Declared for every mode so a Profile override can switch it without adding packages.
function semanticRow(s){return {id:'memory-semantic',name:'dsh-memory-semantic',config:{mode:s.mode,indexFile:s.indexFile,provider:{kind:'subprocess',runtimeDir:s.runtimeDir,modelDir:s.modelDir,threads:s.threads}}};}
module.exports={semanticSettings,semanticRow,KEYS};
