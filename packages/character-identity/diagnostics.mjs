// Observation only: never cache or bypass an authorization decision.
export function successSampler({now=Date.now,intervalMs=60000,capacity=256}={}){
 const seen=new Map();
 return {clear:()=>seen.clear(),take(id){
  const at=now(),previous=seen.get(id);
  if(previous!==undefined&&at>=previous&&at-previous<intervalMs)return false;
  seen.delete(id);seen.set(id,at);
  if(seen.size>capacity)seen.delete(seen.keys().next().value);
  return true;
 }};
}
