// Synthetic SQLite benchmark; no real user content or production database.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';import {LayeredMemory} from '../../packages/character-memory-core/layered.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memory-scale-audit-')),c={sessionId:'fixture'},scope={principalId:'owner',namespaceId:'namespace',projectId:'project',agentId:'agent',memoryMode:'off'},store=new LayeredMemory(path.join(dir,'memory.sqlite'),h=>{if(h!==c)throw Error('Unauthorized');return scope;});
const report=[];
try{let inserted=0;for(const count of [100,1000,10000]){
 store.transaction(()=>{const insert=store.db.prepare('INSERT INTO memories(id,principal,character,project,kind,statement,fingerprint,status,revision,source,created_at,updated_at,confidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(let i=inserted;i<count;i++){const row={id:'fixture-'+i,statement:'合成工作流程记录第 '+i+' 条',status:'active'};insert.run(row.id,'owner','namespace','project','semantic',row.statement,'fingerprint-'+i,'active',1,JSON.stringify({sessionId:'fixture',eventSeq:i,origin:'direct_user'}),'2020-01-01','2020-01-01',1);store.index(row);}
 });inserted=count;
 const measure=fn=>{const times=[];for(let n=0;n<3;n++){const at=performance.now();fn();times.push(Math.round(performance.now()-at));}return times;};
 report.push({count,inspectMs:measure(()=>store.inspect(c,'fixture-0')),recallMs:measure(()=>store.recall(c,'工作')),contextMs:measure(()=>store.context(c))});
}console.log(JSON.stringify({synthetic:true,productionRead:false,report},null,2));}finally{store.close();}
