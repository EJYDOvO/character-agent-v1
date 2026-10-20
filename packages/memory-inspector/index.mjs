import {controller} from './controller.mjs';
import {handler} from './http.mjs';
export const name='memory-inspector';
export const inject=['webServer','connection','memoryIdentity','dshMemory'];
export function apply(ctx,config={}){
 if(config.enabled===false)return;
 if(!['127.0.0.1','::1'].includes(ctx.webServer.host))throw Error('Memory Inspector requires a loopback DSH Web listener');
 const assets=new Map(); // No standalone HTML: the native client plugin owns the settings section.
 let closed=false;
 const serve=handler({connection:ctx.connection,origin:()=>ctx.webServer.getOrigin(),assets,dispatch:controller(ctx.dshMemory,ctx.memoryIdentity,{writable:config.writable===true}),isClosed:()=>closed});
 ctx.effect(()=>{const release=ctx.webServer.register({kind:'prefix',path:'/memory-inspector',handler:serve});return()=>{closed=true;release();};});
}
