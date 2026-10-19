// Native Host + real installed QQ SessionManager; synthetic identity, no SDK
// gateway, credentials, outbound transport or model request.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
export const name='qq-session-upgrade-probe';
export const inject=['agents','agentPresets','characterIdentity','tools'];
export function apply(ctx,config){ctx.effect(()=>{const timer=setTimeout(()=>void run(),1200);return()=>clearTimeout(timer);});
 async function run(){
  const report={ok:false,at:new Date().toISOString(),checks:[],network:false};let manager,release;
  try{
   assert(!ctx.get('qqGateway'),'Probe must not have a live QQ gateway');
   const module=config.moduleRoot+'/dist/session/session-manager.js';
   const {SessionManager}=await import(pathToFileURL(module).href);
   const options={appId:'mock-app',preset:'qq-character',cwd:config.cwd,sessionIdleTimeout:3600000,access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}};
   const logger={info(){},warn(){},debug(){},error(){}};
   const nativeAgents=ctx.agents;
   const agents=new Proxy(nativeAgents,{get(target,key){
    if(key==='resume')return async args=>{try{return await nativeAgents.resume(args);}catch(e){report.resumeErrors??=[];report.resumeErrors.push(String(e.stack));throw e;}};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});
   manager=new SessionManager(ctx,agents,options,logger);
   manager.modelResolver.setSessionId(manager.sessionKey('c2c','mock-owner'),randomUUID());
   release=ctx.characterIdentity.attach({manager,config:options,sender:{sendMarkdown(){throw Error('Outbound transport is forbidden in this probe');}}});
   const target={scope:'c2c',targetId:'mock-owner'};
   const first=await manager.getOrCreate('c2c','mock-owner','mock-owner',target);
   assert.equal(first.agentPreset,'qq-character');assert(ctx.tools.get('character_recall',first.agent));
   const {createUserMessage}=await import(pathToFileURL((process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT)+'/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js').href);
   const marker=randomUUID();const logged=first.agent.session.append('user/message',createUserMessage({content:[{type:'text',text:marker}],source:{kind:'qq-upgrade-fixture'}}),{surfaceOp:'append'});
   const seq=logged.seq;
   const id=first.sessionId;
   manager.sessions.delete(first.sessionKey);await first.handle.dispose();
   const restored=await manager.getOrCreate('c2c','mock-owner','mock-owner',target);
   assert.equal(restored.sessionId,id);assert.equal(restored.agentPreset,'qq-character');
   assert(JSON.stringify(restored.agent.session.eventAt(seq)).includes(marker),'Resume must retain history, not silently create an empty session');
   ctx.characterIdentity.authorize(ctx.characterIdentity.forSession(id),'read');
   report.checks.push('Real QQ SessionManager create/resume preserves ID, history marker, Character preset and Host binding');
   await assert.rejects(()=>manager.composePreset('missing-upgrade-preset'));
   await assert.rejects(()=>manager.getOrCreate('c2c','stranger','stranger',{scope:'c2c',targetId:'stranger'}));
   report.checks.push('Unknown preset fails closed; non-Owner route rejected');
   release();release=undefined;assert.throws(()=>ctx.characterIdentity.forSession(id));
   report.checks.push('Detach revokes restored identity');report.ok=true;
  }catch(e){report.error=e.stack;}finally{release?.();await manager?.disposeAll();fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
