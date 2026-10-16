const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto'),{DatabaseSync}=require('node:sqlite');
const root=require('./installation.cjs').install,project=path.resolve(__dirname,'..');
async function main(){
 const status=await require(root+'/maintenance/ops.cjs').liveStatus(true);if(!status.agentGuardAvailable||status.runningAgents?.length||status.busy||status.active)throw Error('Host not confirmed idle');
 const b=JSON.parse(fs.readFileSync(root+'/data/character/binding.json','utf8')),p=JSON.parse(fs.readFileSync(root+'/data/qqbot/model-prefs.json','utf8'));const sessionId=p.sessionIds[`qqbot:${b.appId}:c2c:${b.ownerId}`];
 const marker='CHARACTER_NOTIFY_'+randomUUID(),requestId=randomUUID();const {rpc}=await require(root+'/maintenance/local-client.cjs').connect();
 await rpc('session/prompt',{request:{sessionId,requestId,mode:'queue',content:[{type:'text',text:`[通知验收] 只调用一次 schedule_create，title=通知验收，prompt=${marker}，after_seconds=3。不要调用其他工具，不要创建重复提醒。`}]}});
 const db=new DatabaseSync(root+'/data/character/coordination.sqlite',{readOnly:true});let rows=[];const deadline=Date.now()+90000;
 try{while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));rows=db.prepare('SELECT id,kind,status FROM outbox WHERE text LIKE ?').all('%'+marker+'%');if(rows.some(r=>['sent','unknown'].includes(r.status)))break;}}finally{db.close();}
 const report={at:new Date().toISOString(),requestId,passed:rows.length===1&&rows[0].status==='sent',rows,phoneReceipt:'not independently verified'};fs.writeFileSync(project+'/artifacts/live-notification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
