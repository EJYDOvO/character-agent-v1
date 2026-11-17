// Identifier stress set, added after the first development run showed dense retrieval matching FTS5 on
// the `exact` category of the main set (which only contains a handful of distinct identifiers).
// The 300 background records each carry a near-identical log id (W1000..W1299); these queries ask for
// one specific id. This is the situation where embedding models are known to be weak and exact token
// matching is strong. Generated deterministically; half development, half held-out. It is reported
// separately and never enters the tuning objective.
import {distractors} from './corpus.mjs';

export function stressQueries(count=40,seed=4242){
 const rows=distractors(300);let s=seed>>>0;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/2**32;};
 const chosen=new Set();while(chosen.size<count)chosen.add(Math.floor(rnd()*rows.length));
 const forms=[id=>['kw',id],id=>['msg',`记录编号 ${id} 那条是什么情况`],id=>['kw',id.toLowerCase()],id=>['msg',`what was log entry ${id} about`]];
 return [...chosen].map((index,i)=>{
  const [label]=rows[index],id='W'+(1000+index),[style,query]=forms[i%forms.length](id);
  return {id:`${i%2?'h':'d'}-id-${String(i).padStart(2,'0')}`,split:i%2?'stress-heldout':'stress-dev',category:'id-stress',style,language:/[㐀-鿿]/.test(query)?'mixed':'en',query,scope:'S0',judgments:{[label]:2},negatives:[]};
 });
}
