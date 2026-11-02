// Explicit opt-in builder. Does not mutate or rename existing deployed Session targets.
const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.assign(Object.create(Object.getPrototypeOf(value)),Object.fromEntries(Object.entries(value).map(([key,v])=>[key,clone(v)]))):value;
export function rolePresets({owner,publicPersona,legacyOwner=false}){
 if(!owner?.config?.plugins||typeof publicPersona!=='string'||!publicPersona.trim())throw Error('Reviewed Owner composition and explicit public Persona required');
 const root=clone(owner);root.id='preset-character';root.config.id='character';root.config.name='Character';
 const persona=root.config.plugins.find(p=>p.id==='persona');if(!persona)throw Error('Owner Persona missing');persona.config={...persona.config,prefix:publicPersona};
 for(const row of root.config.plugins)if(row.name==='dsh-character-memory-tools/character.mjs')row.config={...row.config,characterPresetId:'character'};
 const minimal=id=>({id:'preset-'+id,name:'@deepseek-ai/dsh-agent-preset',config:{id,name:id,plugins:[
  {id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix:publicPersona}},
  {id:'minimal-tool-scope',name:'dsh-character-memory-tools/minimal-scope.mjs',config:{allow:[]}}
 ]}});
 const rows=[root,minimal('character-contact'),minimal('character-guest')];
 if(legacyOwner){const alias=clone(owner);alias.id='preset-qq-character';alias.config.id='qq-character';rows.push(alias);}
 return rows;
}
