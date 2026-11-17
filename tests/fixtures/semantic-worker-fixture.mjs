// Stand-in for packages/memory-semantic/worker.mjs in process-lifecycle tests: same IPC protocol, no
// model. The behaviour is selected by the configured repo name; `documentPrefix` may carry a marker
// file path for behaviours that change between starts. It produces fixed vectors and proves nothing
// about retrieval.
import fs from 'node:fs';
const options=JSON.parse(process.env.DSH_SEMANTIC_WORKER),behaviour=options.model.repo.split('/')[1],marker=options.model.documentPrefix;
process.on('disconnect',()=>process.exit(0));
const vector=()=>{const v=new Float32Array(8);v[0]=1;return v;};
if(behaviour==='fatal-load'){process.send({type:'fatal',error:'synthetic load failure'});setTimeout(()=>process.exit(1),20);}
else if(behaviour==='fatal-then-ok'&&!fs.existsSync(marker)){fs.writeFileSync(marker,'1');process.send({type:'fatal',error:'synthetic first-start failure'});setTimeout(()=>process.exit(1),20);}
else{
 process.send({type:'ready',loadMs:1,rssMB:10,cpuMs:1});
 process.on('message',m=>{
  if(m?.type!=='embed')return;
  if(behaviour==='hang')return;
  if(behaviour==='crash-on-embed')process.exit(3);
  if(behaviour==='crash-once'&&!fs.existsSync(marker)){fs.writeFileSync(marker,'1');process.exit(3);}
  process.send({type:'result',id:m.id,vectors:m.texts.map(vector),rssMB:10,cpuMs:2});
 });
}
