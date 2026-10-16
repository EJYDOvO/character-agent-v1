const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
const root=require('./installation.cjs').install,project=path.resolve(__dirname,'..');
async function main(){
 const {assessSmoke}=await import('./smoke-evidence.mjs');
 const status=await require(root+'/maintenance/ops.cjs').liveStatus(true);
 if(!(status.agentGuardAvailable===true&&Array.isArray(status.runningAgents)&&!status.runningAgents.length&&!status.busy&&!status.active))throw Error('Host is not confirmed idle');
 const binding=JSON.parse(fs.readFileSync(root+'/data/character/binding.json','utf8')),prefs=JSON.parse(fs.readFileSync(root+'/data/qqbot/model-prefs.json','utf8'));
 const key=`qqbot:${binding.appId}:c2c:${binding.ownerId}`,sessionId=prefs.sessionIds[key];if(prefs.presets[key]!=='qq-character'||!sessionId)throw Error('Owner Character route missing');
 const {rpc}=await require(root+'/maintenance/local-client.cjs').connect();
 const baseline=(await rpc('session/projections',{request:{sessionId}})).asOfSeq;
 if(!Number.isSafeInteger(baseline))throw Error('Missing sequence boundary');
 const requestId=randomUUID(),marker='CHARACTER_SMOKE_'+requestId;
 const report={requestId,marker,baseline,realModel:true,qqDelivery:'not independently confirmed',completed:false,passed:false};
 await rpc('session/prompt',{request:{sessionId,requestId,mode:'queue',clientTimeZone:'Asia/Hong_Kong',content:[{type:'text',text:`[测试] 单次验收，只调用 character_remember、character_recall、character_forget。用 semantic 保存“${marker} 临时验收记录”，用完整标识检索确认存在，再按 id/revision 遗忘，再以完整标识检索确认不再出现。不得使用其他工具。成功后只回复 ${marker}_DONE，失败如实报告。`}]}});
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){await new Promise(r=>setTimeout(r,2500));const p=await rpc('session/projections',{request:{sessionId}});const page=await rpc('session/page',{request:{address:{kind:'session',sessionId},throughSeq:p.asOfSeq,maxMessages:200}});Object.assign(report,assessSmoke((page.records??[]).filter(r=>r.event).map(r=>r.event),{requestId,marker,baseline}));if(report.completed)break;}
 report.finishedAt=new Date().toISOString();fs.mkdirSync(project+'/artifacts',{recursive:true});fs.writeFileSync(project+`/artifacts/live-smoke-${requestId}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
