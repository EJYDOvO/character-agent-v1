import * as upstream from '@tencent-connect/dsh-qqbot';
import { activate } from './lifecycle.mjs';
export const name='character-qq-adapter';
export const Config=upstream.Config;
export const inject=['agents','agentPresets','conversationManager','qqRemoteOps','characterIdentity','characterMemory'];
export const apply=(ctx,config)=>activate(ctx,config,upstream.apply);
