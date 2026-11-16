// Role Preset builder (I2). The Owner Preset is the reviewed Character
// composition unchanged except its id; contact/guest are assembled from
// nothing but an explicitly supplied public Persona and the native role tool
// scope — never derived from the Owner Preset and restricted by Prompt alone.
// The public Persona is either static text or a ready Persona plugin row (the
// character manager's runtime persona); exactly one of the two is supplied.
const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.assign(Object.create(Object.getPrototypeOf(value)),Object.fromEntries(Object.entries(value).map(([key,v])=>[key,clone(v)]))):value;
export const ROLE_PRESETS=Object.freeze({owner:'character',contact:'character-contact',guest:'character-guest'});
export const TOOL_SCOPE='dsh-identity-access/tool-scope.mjs';
export function rolePresets({owner,publicPersona,publicPersonaRow,legacyOwner}){
 const staticPersona=typeof publicPersona==='string'&&publicPersona.trim()!=='';
 if(!owner?.config?.plugins||staticPersona===(publicPersonaRow!==undefined))throw Error('Reviewed Owner composition and exactly one explicit public Persona required');
 if(publicPersonaRow!==undefined&&publicPersonaRow?.id!=='persona')throw Error('The public Persona row must be a persona plugin row');
 // Defence in depth: Contact and Guest must never get a row that reads the Owner text.
 if(publicPersonaRow!==undefined&&publicPersonaRow.config?.audience!=='public')throw Error('The public Persona row must read audience public');
 if(publicPersona!==undefined&&!staticPersona)throw Error('Reviewed Owner composition and exactly one explicit public Persona required');
 if(!owner.config.plugins.some(p=>p.id==='persona'))throw Error('Owner Persona missing');
 if(legacyOwner!==undefined&&(typeof legacyOwner!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(legacyOwner)||Object.values(ROLE_PRESETS).includes(legacyOwner)))throw Error('Invalid legacy Owner Preset id');
 const root=clone(owner);root.id='preset-'+ROLE_PRESETS.owner;root.config.id=ROLE_PRESETS.owner;
 for(const row of root.config.plugins)if(row.name==='dsh-character-memory-tools/character.mjs')row.config={...row.config,characterPresetId:ROLE_PRESETS.owner};
 const minimal=id=>({id:'preset-'+id,name:'@deepseek-ai/dsh-agent-preset',config:{id,name:id,plugins:[
  publicPersonaRow?clone(publicPersonaRow):{id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix:publicPersona}},
  {id:'role-tool-scope',name:TOOL_SCOPE,config:{allow:[]}}
 ]}});
 const rows=[root,minimal(ROLE_PRESETS.contact),minimal(ROLE_PRESETS.guest)];
 // Compatibility for historical Owner Sessions only: the same Owner composition
 // under the old id. Identity & Access accepts it for the Owner and no one else.
 if(legacyOwner){const alias=clone(root);alias.id='preset-'+legacyOwner;alias.config.id=legacyOwner;rows.push(alias);}
 return rows;
}
