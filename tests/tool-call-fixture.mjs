import {randomUUID} from 'node:crypto';
// DSH 0.2.2 ctx.tools.execute() runs one model step's batch through the native
// pipeline (pre-execute policy, approvals, guards, dispatch) and settles it.
// Arguments travel as the model's JSON text. Returns that call's tool result.
export async function callTool(ctx,agent,name,args={},{signal=AbortSignal.timeout(10000),id='call-'+randomUUID()}={}){
 const batch=await ctx.tools.execute({agent,calls:[{id,name,arguments:JSON.stringify(args)}],signal});
 const entry=batch.results.find(r=>r.callId===id);if(!entry)throw Error('Native batch settled without the call '+id);
 return entry.result;
}
export const denied=result=>result?.isError===true;
