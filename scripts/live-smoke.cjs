const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
const root=require('./installation.cjs').install,project=path.resolve(__dirname,'..');
async function main(){
 const {liveStatus}=require(root+'/maintenance/ops.cjs');const status=await liveStatus(true);
 if(!(status.agentGuardAvailable===true&&Array.isArray(status.runningAgents)&&!status.runningAgents.length&&!status.busy&&!status.active))throw Error('Host is not confirmed idle');
 const binding=JSON.parse(fs.readFileSync(root+'/data/character/binding.json','utf8')),prefs=JSON.parse(fs.readFileSync(root+'/data/qqbot/model-prefs.json','utf8'));
 const key=`qqbot:${binding.appId}:c2c:${binding.ownerId}`,sessionId=prefs.sessionIds[key];if(prefs.presets[key]!=='qq-character'||!sessionId)throw Error('Owner Character route missing');
 const {rpc}=await require(root+'/maintenance/local-client.cjs').connect();
 const requestId=randomUUID();const marker='CHARACTER_SMOKE_'+requestId.slice(0,8);
 await rpc('session/prompt',{request:{sessionId,requestId,mode:'queue',clientTimeZone:'Asia/Hong_Kong',content:[{type:'text',text:`[测试] 这是已授权的 Character V1 单次验收，只使用 character_remember、character_recall、character_forget。请用 semantic 类型保存测试记忆“${marker}：验收用临时记录”，读取确认后用返回的 id/revision 遗忘，再读取确认不再出现。不要调用 shell、浏览器、委派、提醒或其他工具。不要发送过程性文字。成功后仅回复“[测试] Character V1：记忆写入、读取、遗忘验证完成。”；失败则简短报告真实失败。`}]}});
 const report={submittedAt:new Date().toISOString(),requestId,marker,realModel:true,ownerOnly:true,qqDelivery:'not independently confirmed',completed:false,results:[]};
 const deadline=Date.now()+55000;
 while(Date.now()<deadline){await new Promise(r=>setTimeout(r,2500));const projections=await rpc('session/projections',{request:{sessionId}});const page=await rpc('session/page',{request:{address:{kind:'session',sessionId},throughSeq:projections.asOfSeq,maxMessages:150}});const events=(page.records||[]).filter(r=>r.event).map(r=>r.event);const calls=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data.callId,e.data.name]));
  report.results=events.filter(e=>e.type==='tool/result').map(e=>({tool:calls.get(e.data.message?.source?.callId??e.data.message?.toolCallId),error:!!(e.data.error||e.data.message?.isError),markerPresent:JSON.stringify(e.data).includes(marker),shape:Object.keys(e.data)}));
  report.completed=events.some(e=>e.type==='turn/end');report.finalMarker=events.some(e=>e.type==='assistant/message'&&JSON.stringify(e.data).includes('[测试] Character V1'));
  if(report.completed)break;
 }
 report.finishedAt=new Date().toISOString();fs.writeFileSync(project+'/reports/nightly-2026-10-16/live-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(!report.completed)console.log('Test remains active; inspect before cancelling.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
