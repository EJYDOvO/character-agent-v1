// Host-only ownership audit. Never infer trust from a prompt, title, cwd or Preset alone.
// readHeader must use native persistence stat/open(read), not activate an Agent.
// presetId: the Owner Preset; presetIds: every Owner Preset id (current plus reviewed legacy ids).

// DSH 0.2.2 Schedule catalog entries name their destination in `target`. Only a
// fixed `session` target can carry an Owner reminder; `new_once`/`new` create
// Sessions the QQ lineage never produced, so they are never presumed trusted.
export function scheduleTargetSession(entry){
 const target=entry?.target;
 return target?.kind==='session'&&typeof target.sessionId==='string'&&target.sessionId?target.sessionId:undefined;
}
export async function auditBindings({schedules,bindings,roots,readHeader,presetId,presetIds=[presetId],maxDepth=128}) {
 const owners=new Set(presetIds),known=new Set(bindings),verified=new Set(),issues=[],headers=new Map();
 const header=id=>{if(!headers.has(id))headers.set(id,Promise.resolve().then(()=>readHeader(id)));return headers.get(id);};
 for(const root of new Set([...known,...roots].filter(Boolean))){
  let id=root;const seen=new Set();
  for(let depth=0;id;depth++){
   if(seen.has(id)||depth>=maxDepth){issues.push({sessionId:id,code:'lineage_cycle_or_limit'});break;}
   seen.add(id);let h;
   try{h=await header(id);}catch{issues.push({sessionId:id,code:'header_unreadable'});break;}
   if(!h){issues.push({sessionId:id,code:'header_missing'});break;}
   if(h.id!==id||!owners.has(h.agentPreset)||h.origin?.kind==='subagent'||h.delegationDepth>0){issues.push({sessionId:id,code:'header_scope_mismatch'});break;}
   verified.add(id);id=h.parentSession;
  }
 }
 const rows=schedules.map(s=>{
  const sessionId=scheduleTargetSession(s),targetKind=s?.target?.kind??'missing';
  const binding=sessionId===undefined?'untrusted_target':verified.has(sessionId)?known.has(sessionId)?'bound':'verified_missing':known.has(sessionId)?'unverifiable_binding':'unproven';
  return {id:s.id,targetKind,sessionId,status:s.status,binding};
 });
 return {readOnly:true,rows,issues,verified:[...verified],missing:[...verified].filter(id=>!known.has(id)),
  anomalies:rows.filter(r=>r.binding!=='bound')};
}
