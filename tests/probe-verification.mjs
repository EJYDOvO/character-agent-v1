import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export function verifyRestart(file,row,required=false){
  const snapshot={version:1,id:row.id,revision:row.revision,status:row.status,fingerprint:row.fingerprint,sourceHash:createHash('sha256').update(row.source).digest('hex')};
  if(fs.existsSync(file)){assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),snapshot,'Restart changed persisted memory');return true;}
  assert(!required,'Restart baseline missing: run a fresh initial probe first');
  fs.writeFileSync(file,JSON.stringify(snapshot));return false;
}

export function verifyExtraction(store,trusted,{jobId,sessionId,messageId,query}){
  const job=store.jobs(trusted).find(j=>j.id===jobId);
  assert.equal(job?.status,'done','Current extraction did not finish');
  assert(JSON.parse(job.error).saved>0,'Current request saved no memory');
  const prefix=sessionId+':'+messageId+':',scope=store.scope(trusted,'read');
  const ids=new Set(store.db.prepare('SELECT memory_id FROM sources WHERE principal=? AND character=? AND project=? AND substr(source_key,1,?)=?').all(...scope,prefix.length,prefix).map(r=>r.memory_id));
  assert(ids.size>0,'No source association for the current request');
  const rows=store.recall(trusted,query,16000);
  assert(rows.some(r=>ids.has(r.id)),'Current request memory was not recalled');
  return rows;
}

export async function verifyCompaction(report,execute,verify){
  let result;
  try{result=await execute();}catch(error){report.compaction={status:'BLOCKED',reason:String(error.message).slice(0,300)};report.ok=false;throw error;}
  try{
    assert.equal(result?.result.kind,'success',result?.result.text);
    assert(result.result.sourceEventSeq!==undefined,'Missing compaction event');
    verify(result);
    report.compaction={status:'verified',native:true};
  }catch(error){
    report.compaction={status:'FAIL',reason:String(error.message).slice(0,300)};
    // A required feature that was not verified must never leave the probe successful.
    report.ok=false;throw error;
  }
}
