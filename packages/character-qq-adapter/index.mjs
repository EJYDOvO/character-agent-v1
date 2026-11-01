import * as upstream from '@tencent-connect/dsh-qqbot';
import { activate } from './lifecycle.mjs';
export const name='character-qq-adapter';
export const Config=upstream.Config;
// agentIO: the reviewed QQ patch sends plain text through the Unified Agent I/O and refuses to start without it.
export const inject=['agents','agentPresets','conversationManager','agentIO','characterIdentity','characterMemory'];
export const apply=(ctx,config)=>{
 if(upstream.gatewayLifecycleContractVersion!==1)throw Error('Character requires the Iteration 08 QQ Gateway lifecycle patch');
 return activate(ctx,config,upstream.apply);
};
