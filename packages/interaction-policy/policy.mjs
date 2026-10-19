// Process-local presentation only: never appends Session events or calls a model.
export const replyPolicy = `Interaction Policy V1：沿用既定 Persona 的语言、语气与边界，自然交流，不因处理任务切换成另一人格。闲聊简洁，可以用自然段分开完整语义；不要为分气泡生造内容。复杂任务保留完整 Assistant 能力、必要细节、代码和依据，不受闲聊字数目标限制。需要工具或等待时，可先给一句符合 Persona 的简短进度，再执行并给完整结果；已有进度不要重复说稍等。只描述实际执行状态，不把计划或工具返回等同于成功。用户明确更正时采用新要求；不要自行假设已取消或撤销工具副作用。`;

export function options(input={}) {
  const result={enabled:input.enabled!==false,hangOnMs:input.hangOnMs??12000,throttleMs:input.throttleMs??180,maxBubbles:input.maxBubbles??3,chatMaxChars:input.chatMaxChars??240,hangOnText:input.hangOnText??'还在处理中，稍等一下。'};
  for(const [key,min,max]of [['hangOnMs',10,300000],['throttleMs',0,5000],['maxBubbles',1,4],['chatMaxChars',20,1000]])if(!Number.isInteger(result[key])||result[key]<min||result[key]>max)throw Error('Invalid interaction option: '+key);
  if(typeof result.hangOnText!=='string'||!result.hangOnText.trim()||result.hangOnText.length>200)throw Error('Invalid hangOnText');
  return Object.freeze(result);
}

// Conservative plain-text boundaries; code, lists, links and tables stay intact.
export function boundary(text) {
  if(/[`~\[\]<>|]|https?:\/\/|(?:^|\n)\s*(?:[-*+#]|\d+[.)])\s/u.test(text))return 0;
  const m=/[。！？；](?:[”’」』）)]*)\s*(?=[^\s”’」』）)])|\n\s*\n(?=\S)/u.exec(text);
  return m&&m.index>=3?m.index+m[0].length:0;
}

export class Interaction {
  constructor(agent,config={},clock={now:Date.now,set:setTimeout,clear:clearTimeout}) {
    this.agent=agent;this.config=options(config);this.clock=clock;this.chain=Promise.resolve();this.token={cancelled:false};this.active=false;this.closed=false;this.transport=null;this.tools=new Set();this.seen=new WeakSet();this.revision=-1;this.errors=[];this.message=null;
  }
  bind(transport) {
    if(this.closed||!this.config.enabled)return false;
    if(!transport||typeof transport.sendText!=='function')throw Error('Interaction transport requires sendText');
    if(this.transport&&this.transport.key!==transport.key)throw Error('Only one output owner per Agent');
    this.transport=transport;return true;
  }
  queue(fn,token=this.token) {
    this.chain=this.chain.then(()=>{if(!this.closed&&!token.cancelled)return fn();}).catch(()=>{this.errors.push('transport-failed');if(this.errors.length>10)this.errors.shift();});return this.chain;
  }
  clearTimers(){for(const key of ['hangTimer','flushTimer']){if(this[key]!==undefined)this.clock.clear(this[key]);this[key]=undefined;}}
  start(){
    if(this.active)this.invalidate();else this.clearTimers();
    this.token={cancelled:false};this.message=null;this.active=true;this.natural=false;this.prompted=false;this.toolSeen=false;this.tools.clear();this.bubbles=0;this.started=this.clock.now();
    this.hangTimer=this.clock.set(()=>{this.hangTimer=undefined;this.hangOn();},this.config.hangOnMs);
  }
  hangOn(){
    if(!this.active||this.closed||this.agent.status!=='running'||this.natural||this.prompted||!this.transport||this.transport.waitingForUser?.())return;
    const token=this.token;this.prompted=true;
    this.queue(()=>{if(this.token===token&&this.active&&!this.natural&&this.agent.status==='running'&&!this.transport.waitingForUser?.())return this.transport.sendText(this.config.hangOnText,{kind:'status',transient:true,state:this.tools.size?'tool':'agent'});},token);
  }
  newMessage(){return {full:'',pending:'',transport:this.transport,stream:null,updated:'',failed:false,finished:false};}
  text(delta){
    if(!this.active||this.closed||typeof delta!=='string'||!delta)return;
    if(delta.trim())this.natural=true;
    const m=this.message??=this.newMessage();m.full+=delta;m.pending+=delta;
    this.split(m,false);
    if(this.flushTimer===undefined)this.flushTimer=this.clock.set(()=>{this.flushTimer=undefined;this.update(m);},this.config.throttleMs);
  }
  split(m,final){
    if(!this.transport)return;
    while(!this.toolSeen&&m.full.length<=this.config.chatMaxChars&&this.bubbles<this.config.maxBubbles-1){
      const cut=boundary(m.pending);if(!cut)break;
      const part=m.pending.slice(0,cut);m.pending=m.pending.slice(cut);this.finishBubble(m,part);this.bubbles++;
    }
    if(final){this.finishBubble(m,m.pending);m.pending='';m.finished=true;}
  }
  update(m){
    if(!this.transport||m.finished||!m.pending.trim())return;
    const text=m.pending;
    // One serialized queue owns all updates, close operations and static bubbles.
    this.queue(()=>this.push(m,text));
  }
  async push(m,text){
    if(m.failed||!text.trim()||!m.transport?.openStream)return;
    if(!m.stream){try{m.stream=m.transport.openStream();}catch{m.failed=true;return;}}
    if(m.updated===text)return;
    try{await m.stream.update(text);m.updated=text;}catch{m.failed=true;this.errors.push('stream-delivery-unknown');}
  }
  finishBubble(m,text){
    if(!text.trim()&&!m.stream)return;
    // Detach the segment immediately; subsequent tokens get a separate stream.
    const segment={transport:m.transport,stream:null,updated:'',failed:false};
    this.queue(async()=>{
      segment.stream=m.stream;segment.updated=m.updated;segment.failed=m.failed;
      m.stream=null;m.updated='';m.failed=false;
      if(!segment.transport)return;
      if(!segment.stream&&!segment.transport.openStream){await segment.transport.sendText(text,{kind:'assistant'});return;}
      await this.push(segment,text);
      if(segment.stream){try{await segment.stream.complete();}catch{this.errors.push('stream-close-failed');}}
      else await segment.transport.sendText(text,{kind:'assistant'});
    });
  }
  finish(text){
    if(this.flushTimer!==undefined)this.clock.clear(this.flushTimer);this.flushTimer=undefined;
    let m=this.message;
    if(!m){m=this.newMessage();m.full=text;m.pending=text;this.message=m;if(text.trim())this.natural=true;}
    // Native compact settlement should match its stream. Never resend a differing
    // full message after partial delivery, which could duplicate or mix attempts.
    if(text.startsWith(m.full)){m.pending+=text.slice(m.full.length);m.full=text;}
    else if(m.full!==text){this.errors.push('stream-settlement-mismatch');}
    this.split(m,true);this.message=null;
  }
  invalidate(){
    this.clearTimers();this.token.cancelled=true;this.token={cancelled:false};const stream=this.message?.stream;this.message=null;this.attempt=null;
    if(stream)this.chain=this.chain.then(()=>stream.complete()).catch(()=>{this.errors.push('stream-close-failed');});
  }
  frame(frame){
    if(this.closed||!this.config.enabled||!this.active)return;
    if(!Number.isInteger(frame?.revision)||frame.revision<=this.revision)return;this.revision=frame.revision;
    if(frame.type==='start'){
      if(this.message){this.finish(this.message.full);this.errors.push('retried-attempt');}
      this.attempt=frame.attemptId;this.message=this.newMessage();
    }else if(frame.attemptId===this.attempt&&frame.type==='chunk'){
      if(frame.chunk?.type==='tool-call-delta')this.toolSeen=true;
      if(frame.chunk?.type==='text-delta')this.text(frame.chunk.text);
    }else if(frame.attemptId===this.attempt&&frame.type==='end'){
      if(frame.outcome?.eventType!=='assistant/message'&&this.message)this.finish(this.message.full);
      this.attempt=null;
    }
  }
  event(event){
    if(this.closed||!this.config.enabled||this.seen.has(event))return;this.seen.add(event);
    const d=event.data??{};
    if(event.type==='turn/start')this.start();
    else if(event.type==='tool/call'){this.toolSeen=true;this.tools.add(d.callId);}
    else if(event.type==='tool/result')this.tools.delete(d.message?.source?.callId);
    else if(event.type==='assistant/message'&&this.active){
      if(d.message?.content?.some(b=>b.type==='tool-call'))this.toolSeen=true;
      const text=(d.message?.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('');
      if(d.interrupted){this.invalidate();return;}
      this.finish(text);
    }else if(event.type==='turn/end'){
      this.active=false;this.clearTimers();
      if(d.reason?.kind!=='completed'&&d.reason?.kind!=='max-tokens')this.invalidate();
      else if(this.message)this.finish(this.message.full);
      this.tools.clear();
    }
  }
  revise(message){
    if(this.closed||!this.config.enabled)throw Error('Interaction disabled');
    // Called only by trusted ingress with a native UserMessage, never by model tools.
    if(this.agent.status!=='running'){this.agent.followup(message);return 'queued';}
    if(!this.active||this.toolSeen||this.tools.size){this.agent.steer(message);return 'steered';}
    this.invalidate();this.active=false;this.agent.cancel({kind:'user'},{keepInbox:true});this.agent.followup(message);return 'restarted';
  }
  stopOutput(){this.active=false;this.invalidate();}
  external(text,meta={}){const transport=this.transport;return this.queue(()=>transport?.sendText(text,meta));}
  async idle(){await this.chain;}
  async dispose(){this.active=false;this.invalidate();this.closed=true;await this.chain;this.transport=null;}
}
