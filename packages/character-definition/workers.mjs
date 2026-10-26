import {workerRoles,professionalWorkerIds,selectedWorkerIds,workerPersona} from '../character-memory-tools/worker-policy.mjs';
export {professionalWorkerIds,selectedWorkerIds};
export function workerPreset(id='worker-general'){
 if(!Object.hasOwn(workerRoles,id))throw Error('Unknown Worker preset');
 return {id:'preset-'+id,name:'@deepseek-ai/dsh-agent-preset',config:{id,name:id,description:workerRoles[id].purpose,plugins:[
  {id:'worker-boundary',name:'dsh-character-memory-tools/worker.mjs'},
  {id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix:workerPersona(id)}}
 ]}};
}
export function configureWorkers(character,specialists=[],community=[]){
 const ids=selectedWorkerIds(specialists,community);
 const delegation=character.config.plugins.find(p=>p.id==='delegation');
 const spawn=delegation?.config.find(p=>p.id==='tool-subagent'&&p.config?.provider==='spawn');
 if(!spawn)throw Error('Official Creator Spawn composition changed; review required');
 spawn.config={...spawn.config,agentPreset:'worker-general',allowedAgentPresets:ids,maxDepth:1};
 return character;
}
