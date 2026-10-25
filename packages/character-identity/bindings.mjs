// Host-only ownership audit. Never infer trust from a prompt, title, cwd or Preset alone.
// readHeader must use native persistence stat/open(read), not activate an Agent.
export async function auditBindings({schedules,bindings,roots,readHeader,presetId,maxDepth=128}) {
 const known=new Set(bindings),verified=new Set(),issues=[],headers=new Map();
 const header=id=>{if(!headers.has(id))headers.set(id,Promise.resolve().then(()=>readHeader(id)));return headers.get(id);};
 for(const root of new Set([...known,...roots].filter(Boolean))){
  let id=root;const seen=new Set();
  for(let depth=0;id;depth++){
   if(seen.has(id)||depth>=maxDepth){issues.push({sessionId:id,code:'lineage_cycle_or_limit'});break;}
   seen.add(id);let h;
   try{h=await header(id);}catch{issues.push({sessionId:id,code:'header_unreadable'});break;}
   if(!h){issues.push({sessionId:id,code:'header_missing'});break;}
   if(h.id!==id||h.agentPreset!==presetId||h.origin?.kind==='subagent'||h.delegationDepth>0){issues.push({sessionId:id,code:'header_scope_mismatch'});break;}
   verified.add(id);id=h.parentSession;
  }
 }
 const rows=schedules.map(s=>({id:s.id,sessionId:s.sessionId,status:s.status,
  binding:verified.has(s.sessionId)?known.has(s.sessionId)?'bound':'verified_missing':known.has(s.sessionId)?'unverifiable_binding':'unproven',
 }));
 return {readOnly:true,rows,issues,verified:[...verified],missing:[...verified].filter(id=>!known.has(id)),
  anomalies:rows.filter(r=>r.binding!=='bound')};
}
