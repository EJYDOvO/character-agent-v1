// Optional roles (I2), explicit and default off. One source of the role
// composition for build (Core) and portable preparation (Profile overrides).
const path=require('node:path');
const ROLES=Object.freeze({owner:'character',contact:'character-contact',guest:'character-guest'});
const ID=/^[a-z][a-z0-9-]{0,63}$/;
function roleSettings(value){
 if(value?.enabled!==true)return undefined;
 if(typeof value.publicPersonaFile!=='string'||!path.isAbsolute(value.publicPersonaFile))throw Error('roles.publicPersonaFile must name an explicit, reviewed public Persona file');
 const legacy=value.legacyOwnerPreset??undefined;
 if(legacy!==undefined&&(!ID.test(legacy)||Object.values(ROLES).includes(legacy)))throw Error('roles.legacyOwnerPreset must be the old Owner Preset id');
 return Object.freeze({enabled:true,publicPersonaFile:path.normalize(value.publicPersonaFile).replaceAll(path.sep,'/'),...(legacy?{legacyOwnerPreset:legacy}:{})});
}
// Host configuration fragments; data is the absolute Character data directory.
function roleConfig(roles,data){
 const legacy=roles.legacyOwnerPreset?[roles.legacyOwnerPreset]:[];
 return {
  identityAccess:{stateFile:data+'/identity-access.json',ownerFile:data+'/identity-owner.json',presets:{...ROLES},legacyOwnerPresets:legacy},
  // Memory stays in the namespace of the historical Owner Preset id after migration.
  characterIdentity:{legacyPresetIds:legacy,memoryAgentId:legacy[0]??ROLES.owner,roles:{enabled:true,presets:[ROLES.contact,ROLES.guest]}},
  qq:{identityAccess:{enabled:true}},
 };
}
module.exports={ROLES,roleSettings,roleConfig};
