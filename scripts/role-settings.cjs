// Optional roles (I2), explicit and default off. One source of the role
// composition for build (Core) and portable preparation (Profile overrides).
const path=require('node:path');
const ROLES=Object.freeze({owner:'character',contact:'character-contact',guest:'character-guest'});
const ID=/^[a-z][a-z0-9-]{0,63}$/;
// With the character manager the public Persona is the character's Owner-approved
// public version, so no file names it.
function roleSettings(value,{characterManager=false}={}){
 if(value?.enabled!==true)return undefined;
 if(characterManager&&value.publicPersonaFile!==undefined)throw Error("roles.publicPersonaFile is replaced by the character's public version");
 if(!characterManager&&(typeof value.publicPersonaFile!=='string'||!path.isAbsolute(value.publicPersonaFile)))throw Error('roles.publicPersonaFile must name an explicit, reviewed public Persona file');
 const legacy=value.legacyOwnerPreset??undefined;
 if(legacy!==undefined&&(!ID.test(legacy)||Object.values(ROLES).includes(legacy)))throw Error('roles.legacyOwnerPreset must be the old Owner Preset id');
 return Object.freeze({enabled:true,...(characterManager?{}:{publicPersonaFile:path.normalize(value.publicPersonaFile).replaceAll(path.sep,'/')}),...(legacy?{legacyOwnerPreset:legacy}:{})});
}
// Host configuration fragments; data is the absolute Character data directory.
// The account state (Owner binding, role grants) belongs to the installation, not
// to one character, so the character manager moves it to accountDirectory.
function roleConfig(roles,data,{accountDirectory=data}={}){
 const legacy=roles.legacyOwnerPreset?[roles.legacyOwnerPreset]:[];
 return {
  identityAccess:{stateFile:accountDirectory+'/identity-access.json',ownerFile:accountDirectory+'/identity-owner.json',presets:{...ROLES},legacyOwnerPresets:legacy},
  // Memory stays in the namespace of the historical Owner Preset id after migration.
  characterIdentity:{legacyPresetIds:legacy,memoryAgentId:legacy[0]??ROLES.owner,roles:{enabled:true,presets:[ROLES.contact,ROLES.guest]}},
  qq:{identityAccess:{enabled:true}},
 };
}
module.exports={ROLES,roleSettings,roleConfig};
