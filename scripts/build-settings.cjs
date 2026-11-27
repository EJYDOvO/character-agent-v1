const path=require('node:path');
// The card settings travel in two parts: characterId for deploy checks and
// card for loadCard().
function cardBuildSettings(){const {characterId,...card}=require('./card-source.cjs').cardSettings();return {characterId,card};}
// characterManager:{enabled:true} makes the character a runtime choice: its card,
// rules and data live under <install>/data and are read while the Host runs, so
// the build reads none of them. The data directory is the character-current link.
function managerSettings(value,install){
 if(value===undefined||value===null)return undefined;
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='enabled')||typeof value.enabled!=='boolean')throw Error('characterManager must be {enabled: boolean}');
 return value.enabled?{enabled:true,root:path.join(install,'data').replaceAll('\\','/')}:undefined;
}
module.exports=()=>{
 // One reader for the build config: it must exist and hold only known keys.
 const local=require('./card-source.cjs').readConfig();
 const install=require('./installation.cjs').install,characterManager=managerSettings(local.characterManager,install);
 const roles=require('./role-settings.cjs').roleSettings(local.roles,{characterManager:!!characterManager});
 const presetId=process.env.DSH_CHARACTER_PRESET_ID||local.presetId||(roles?'character':'qq-character');
 if(roles&&presetId!=='character')throw Error('Role builds use the character Owner Preset id; set roles.legacyOwnerPreset for historical Sessions');
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(presetId))throw Error('Invalid Character preset id');
 const dataDirectory=characterManager?characterManager.root+'/character-current':process.env.DSH_CHARACTER_DATA_DIR||local.dataDirectory||(process.env.DSH_HOME&&path.join(process.env.DSH_HOME,'character'))||path.join(install,'data','character');
 if(!path.isAbsolute(dataDirectory))throw Error('Character data directory must be absolute');
 const interactionFlag=process.env.DSH_CHARACTER_INTERACTION;
 if(interactionFlag!==undefined&&!['on','off'].includes(interactionFlag))throw Error('DSH_CHARACTER_INTERACTION must be on or off');
 const interaction=interactionFlag==='off'?undefined:interactionFlag==='on'?{...local.interaction,enabled:true}:local.interaction?.enabled?local.interaction:undefined;
 const specialistWorkers=local.specialistWorkers??[];
 if(!Array.isArray(specialistWorkers)||specialistWorkers.some(id=>id!=='worker-review')||new Set(specialistWorkers).size!==specialistWorkers.length)throw Error('Unsupported specialistWorkers');
 const communityWorkerPresets=require('../packages/character-memory-tools/worker-policy.mjs').communityWorkers(local.communityWorkerPresets??[],{characterPresetId:presetId});
 const normalizedDataDirectory=path.normalize(dataDirectory).replaceAll('\\','/');
 const semanticRecall=require('./semantic-settings.cjs').semanticSettings(local.semanticRecall,{install,dataDirectory:normalizedDataDirectory});
 return {presetId,dataDirectory:normalizedDataDirectory,semanticRecall,...(characterManager?{characterManager}:cardBuildSettings()),specialistWorkers,communityWorkerPresets,...(interaction?{interaction}: {}),...(roles?{roles}:{})};
};
