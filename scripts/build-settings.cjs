const fs=require('node:fs'),path=require('node:path');
module.exports=()=>{
 const root=path.resolve(__dirname,'..'),file=path.join(root,'private','build-config.json');
 const local=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{};
 const presetId=process.env.DSH_CHARACTER_PRESET_ID||local.presetId||'qq-character';
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(presetId))throw Error('Invalid Character preset id');
 const install=require('./installation.cjs').install;
 const dataDirectory=process.env.DSH_CHARACTER_DATA_DIR||local.dataDirectory||path.join(install,'data','character');
 if(!path.isAbsolute(dataDirectory))throw Error('Character data directory must be absolute');
 return {presetId,dataDirectory:path.normalize(dataDirectory).replaceAll('\\','/'),definitionPath:require('./definition-source.cjs')()};
};
