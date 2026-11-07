// Required native Host gates and the only rule for calling them passed.
// Every required gate must have run and exited 0 after a verified Host; a
// missing Host, a refused pin, a crash or a gate that never ran is not a pass.
const GATES=Object.freeze([
 {id:'lifecycle',script:'run-lifecycle.ps1',args:[],covers:'two-process cold recovery, Long Tasks, Schedule deadlines, Spawn availability'},
 {id:'workers',script:'run-inspector.ps1',args:['--workers'],covers:'ten native Worker Presets, tool scope, parent/child, cold recovery, Host restart'},
 {id:'roles',script:'run-roles.ps1',args:[],covers:'Identity roles, Guest/Contact isolation, Session restore across restart'},
 {id:'schedule-restart',script:'run-schedule-restart.ps1',args:[],covers:'Schedule restart and tool guard'}
]);
function summarize({host,results=[]}){
 const byId=new Map(results.map(r=>[r.id,r]));
 const gates=GATES.map(g=>{const r=byId.get(g.id);
  const status=!host?.ok?'not-run':!r?'not-run':r.exitCode===0&&r.reported===true?'passed':'failed';
  return {id:g.id,covers:g.covers,status,...(r?{exitCode:r.exitCode,seconds:r.seconds}:{})};});
 const unknown=results.filter(r=>!GATES.some(g=>g.id===r.id)).map(r=>r.id);
 const ok=!!host?.ok&&!unknown.length&&gates.every(g=>g.status==='passed');
 return {ok,verdict:ok?'passed':host?.ok?'failed':'blocked',host:host??{ok:false,reason:'Host verification did not run'},gates,...(unknown.length?{unknownGates:unknown}:{})};
}
module.exports={GATES,summarize};
if(require.main===module){
 const fs=require('node:fs'),[cmd,file]=process.argv.slice(2);
 if(cmd==='list'){console.log(JSON.stringify(GATES));process.exit(0);}
 if(cmd==='summarize'){const s=summarize(JSON.parse(fs.readFileSync(file,'utf8')));console.log(JSON.stringify(s,null,2));process.exit(s.ok?0:1);}
 console.error('usage: native-gates.cjs list | summarize <raw.json>');process.exit(2);
}
