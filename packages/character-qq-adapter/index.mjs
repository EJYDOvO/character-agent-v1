import * as upstream from '@tencent-connect/dsh-qqbot';
import { activate } from './lifecycle.mjs';
export const name='character-qq-adapter';
export const Config=upstream.Config;
// agentIO: the reviewed QQ patch sends plain text through the Unified Agent I/O and refuses to start without it.
export const inject=['agents','agentPresets','conversationManager','agentIO','qqRemoteOps','characterIdentity','characterMemory'];
export const apply=(ctx,config)=>activate(ctx,config,upstream.apply);
