import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import sourceDigest from '../scripts/source-digest.cjs';
export const name='generic-qq-host-probe';export const inject=['agents','agentPresets','qqGateway'];
export function apply(ctx,config){const report={ok:false,at:new Date().toISOString(),sourceDigest:sourceDigest(),checks:[]};let done=false;
 const run=async()=>{if(done)return;done=true;try{
  assert.equal(ctx.get('qqRemoteOps'),undefined);assert.equal(ctx.get('characterIdentity'),undefined);assert.equal(ctx.get('dshMemory'),undefined);report.checks.push('Real QQ SDK ready without Character or Remote Ops');
  const {manager,sender}=ctx.qqGateway;assert(manager.questionChannel);assert(manager.approvalChannel);assert.equal(typeof sender.sendMarkdown,'function');report.checks.push('Single base Gateway owns Session, Sender, question and approval channels');
  assert.equal(globalThis[Symbol.for('dsh.qqGateway.leases.v1')].size,1);
  const profile=path.join(process.env.DSH_HOME,'profiles/generic-qq'),manifest=JSON.parse(fs.readFileSync(profile+'/package.json','utf8'));assert.deepEqual(Object.keys(manifest.dependencies),['@tencent-connect/dsh-qqbot']);
  report.qqPatchSha256=createHash('sha256').update(fs.readFileSync(profile+'/patches/dsh-qqbot@0.5.2.patch')).digest('hex');
  const ordinary=await manager.composePreset('cordis');assert.equal(ordinary.agentPreset,'cordis');await assert.rejects(()=>manager.composePreset('missing-preset-for-refactor-test'));report.checks.push('Native ordinary preset resolution; missing preset fails closed');
  const owner=manager.config.access.c2cAllow[0],target={scope:'c2c',targetId:owner};
  const initial=await manager.getOrCreate('c2c',owner,owner,target);assert.equal(initial.agentPreset,'cordis');const id=initial.sessionId;
  manager.sessions.delete(initial.sessionKey);await initial.handle.dispose();
  const restored=await manager.getOrCreate('c2c',owner,owner,target);assert.equal(restored.sessionId,id);assert.equal(restored.agentPreset,'cordis');report.checks.push('Native QQ Session create and resume without Remote Ops');
  report.ok=true;
 }catch(e){report.error=e.stack;}fs.writeFileSync(config.result,JSON.stringify(report,null,2));};
 ctx.qqGateway.bot.on('ready',()=>void run());
}
