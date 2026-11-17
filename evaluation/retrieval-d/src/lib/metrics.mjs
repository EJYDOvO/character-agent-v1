// Retrieval metrics. Grade 2 = target, 1 = topically related. Recall/Precision/MRR use grade 2;
// nDCG uses graded gain 2^g-1 (same convention as tests/recall-evaluation.mjs).
const dcg=g=>g.reduce((s,x,i)=>s+(2**x-1)/Math.log2(i+2),0);

export function scoreQuery(resultLabels,judgments,negatives=[]){
 const targets=Object.entries(judgments).filter(([,g])=>g===2).map(([l])=>l),grade=l=>judgments[l]??0;
 const at=k=>resultLabels.slice(0,k);
 const recall=k=>targets.length?targets.filter(l=>at(k).includes(l)).length/targets.length:null;
 const ndcg=k=>{const ideal=dcg(Object.values(judgments).sort((a,b)=>b-a).slice(0,k));return ideal?dcg(at(k).map(grade))/ideal:null;};
 const first=resultLabels.findIndex(l=>targets.includes(l));
 const firstNeg=resultLabels.findIndex(l=>negatives.includes(l));
 return {
  answerable:targets.length>0,
  recall1:recall(1),recall5:recall(5),recall10:recall(10),recallFinal:recall(Infinity),
  precision5:targets.length?at(5).filter(l=>targets.includes(l)).length/5:null,
  mrr:targets.length?(first<0?0:1/(first+1)):null,ndcg5:ndcg(5),ndcg10:ndcg(10),
  // share of the first five context slots filled with records that are not even topically related
  noise5:at(5).filter(l=>grade(l)===0).length/5,
  returned:resultLabels.length,
  // a known-wrong record outranks every target (or appears while no target does)
  inversion:negatives.length?(firstNeg>=0&&(first<0||firstNeg<first)?1:0):null,
 };
}

export function mean(values){const v=values.filter(x=>x!==null&&x!==undefined&&!Number.isNaN(x));return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}

export function aggregate(rows){
 const keys=['recall1','recall5','recall10','recallFinal','precision5','mrr','ndcg5','ndcg10','noise5','inversion','candidateRecall'];
 const out={n:rows.length,answerable:rows.filter(r=>r.answerable).length};
 for(const k of keys)out[k]=mean(rows.map(r=>r[k]));
 const none=rows.filter(r=>!r.answerable);
 out.unanswerable=none.length;
 out.falseRecall5=mean(none.map(r=>Math.min(5,r.returned)/5)); // how full the top-5 is when nothing should be found
 out.falseReturned=mean(none.map(r=>r.returned));
 return out;
}

// Paired bootstrap CI for the difference of a per-query metric between two arms on the same queries.
export function pairedBootstrap(a,b,{iterations=5000,seed=7}={}){
 const d=[];for(let i=0;i<a.length;i++)if(a[i]!==null&&b[i]!==null&&a[i]!==undefined&&b[i]!==undefined)d.push(a[i]-b[i]);
 if(!d.length)return null;
 let s=seed>>>0;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/2**32;},means=[];
 for(let it=0;it<iterations;it++){let t=0;for(let i=0;i<d.length;i++)t+=d[Math.floor(rnd()*d.length)];means.push(t/d.length);}
 means.sort((x,y)=>x-y);
 return {n:d.length,delta:d.reduce((x,y)=>x+y,0)/d.length,lo:means[Math.floor(iterations*.025)],hi:means[Math.floor(iterations*.975)]};
}

export function auc(pos,neg){
 if(!pos.length||!neg.length)return null;
 let wins=0;for(const p of pos)for(const n of neg)wins+=p>n?1:p===n?0.5:0;
 return wins/(pos.length*neg.length);
}
