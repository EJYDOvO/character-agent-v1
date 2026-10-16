const fs=require('fs'),path=require('path'),z=require('zlib');
const install=require('./installation.cjs').install,root=path.resolve(__dirname,'..');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);}
const report={sessions:0,events:0,types:{},pendingTurns:0,legacyScheduleEvents:0,parseErrors:0,legacyMemoryFiles:0};
for(const file of walk(install+'/data/sessions')){if(!file.endsWith('.zstd'))continue;let pending=false;
 try{const raw=fs.readFileSync(file);let offset=0;while(offset<raw.length){const r=z.zstdDecompressSync(raw.subarray(offset),{info:true});if(!r.engine.bytesWritten)throw Error('No progress');offset+=r.engine.bytesWritten;
  for(const line of r.buffer.toString().trim().split('\n').filter(Boolean)){const e=JSON.parse(line);if(e.type==='session'){report.sessions++;continue;}report.events++;report.types[e.type]=(report.types[e.type]||0)+1;if(e.type==='turn/start')pending=true;if(e.type==='turn/end')pending=false;if(e.type==='schedule/change')report.legacyScheduleEvents++;}
 }}catch{report.parseErrors++;}if(pending)report.pendingTurns++;
}
const legacy=install+'/data/storages/task-memory';if(fs.existsSync(legacy))report.legacyMemoryFiles=walk(legacy).filter(x=>x.endsWith('.json')).length;
fs.mkdirSync(root+'/reports/nightly-2026-10-16',{recursive:true});fs.writeFileSync(root+'/reports/nightly-2026-10-16/offline-state.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
