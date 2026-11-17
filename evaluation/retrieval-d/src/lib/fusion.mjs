// Rank fusion. RRF uses ranks only (Cormack, Clarke & Buettcher 2009): score(d) = sum_i w_i / (k + rank_i(d)).
export function rrf(lists,{k=60,weights}={}){
 const score=new Map();
 lists.forEach((list,i)=>{const w=weights?.[i]??1;list.forEach((item,rank)=>{const id=item.id??item;score.set(id,(score.get(id)??0)+w/(k+rank+1));});});
 return [...score].map(([id,s])=>({id,score:s})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}

// Informational control only: min-max normalised convex combination (never raw BM25 + raw cosine).
export function convex(a,b,alpha){
 const norm=list=>{
  const out=new Map();if(!list.length)return out;
  let lo=Infinity,hi=-Infinity;for(const x of list){lo=Math.min(lo,x.score);hi=Math.max(hi,x.score);}
  for(const x of list)out.set(x.id,hi>lo?(x.score-lo)/(hi-lo):1);
  return out;
 };
 const A=norm(a),B=norm(b),ids=new Set([...A.keys(),...B.keys()]);
 return [...ids].map(id=>({id,score:alpha*(A.get(id)??0)+(1-alpha)*(B.get(id)??0)})).sort((x,y)=>y.score-x.score||x.id.localeCompare(y.id));
}
