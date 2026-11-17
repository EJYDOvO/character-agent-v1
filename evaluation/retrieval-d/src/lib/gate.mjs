// The validity gate. Every retriever in this study only ever *proposes* memory ids; what may be
// returned, and with which text, is decided here by the unmodified Memory Core for a trusted handle:
// scope/ACL lanes, status, expiry, retired evidence and root forget barriers (LayeredMemory.browse
// applies the same SQL predicates as the private #rows used by recall).
import {createHash} from 'node:crypto';

export function visibleSet(store,ctx){
 const map=new Map();
 for(let offset=0;;offset+=100){
  const page=store.browse(ctx,{layer:'l2',limit:100,offset});
  for(const r of page.items)if(r.valid===true&&r.statement)map.set(r.id,r);
  if(offset+100>=page.total)break;
 }
 return map;
}

// Same rendering and budget rule as LayeredMemory.context(): <=20 rows, rendered JSON <= 5000 chars,
// over-budget rows are skipped (not truncated), identical statements are returned once.
export const render=r=>({id:r.id,revision:r.revision,purpose:r.purpose,statement:r.statement,status:r.status,conflictWith:r.conflict_with});
export const OUTPUT={chars:5000,rows:20};
export function applyBudget(rankedIds,visible,{chars=OUTPUT.chars,rows=OUTPUT.rows}={}){
 const out=[],seen=new Set();let used=0;
 for(const id of rankedIds){
  const row=visible.get(id);if(!row)continue; // not valid for this handle => never returned
  const key=createHash('sha256').update(row.statement.normalize('NFKC').trim()).digest('hex');if(seen.has(key))continue;
  const cost=JSON.stringify(render(row)).length;if(used+cost>chars)continue;
  out.push(id);used+=cost;seen.add(key);if(out.length===rows)break;
 }
 return out;
}
