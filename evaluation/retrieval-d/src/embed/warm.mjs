// Download + smoke-test models: node src/embed/warm.mjs me5-small:fp32 bge-m3:fp32 ...
import {createEmbedder,createReranker,cacheDir} from './transformers-provider.mjs';
import {RERANKERS} from './models.mjs';
const cos=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};
console.log('cache',cacheDir);
for(const arg of process.argv.slice(2)){const [name,dtype]=arg.split(':');const t=performance.now();
 try{
  if(RERANKERS[name]){const r=await createReranker(name,{dtype});const s=await r.score('周末喜欢做什么运动',['周末通常选择徒步，工作日优先完成测试。','合成镜像部署端口为 7801。']);console.log(arg,'reranker ok',r.modelVersion,'load',Math.round(r.loadMs),'ms scores',s.map(x=>+x.toFixed(3)));continue;}
  const e=await createEmbedder(name,{dtype});const [q]=await e.embed(['远足'],'query');const d=await e.embed(['周末通常选择徒步，工作日优先完成测试。','合成镜像部署端口为 7801。','I usually go hiking on weekends.'],'doc');
  console.log(arg,'ok',e.modelVersion,'dim',q.length,'load',Math.round(e.loadMs),'ms total',Math.round(performance.now()-t),'ms cos',d.map(x=>+cos(q,x).toFixed(3)));
 }catch(error){console.log(arg,'FAILED',String(error?.message??error).slice(0,300));}
}
