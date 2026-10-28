// Process-local presentation only: never appends Session events or calls a model.
export const replyPolicy = `Interaction Policy V1：沿用既定 Persona 的语言、语气与边界，自然交流，不因处理任务切换成另一人格。闲聊简洁，可以用自然段分开完整语义；不要为分气泡生造内容。复杂任务保留完整 Assistant 能力、必要细节、代码和依据，不受闲聊字数目标限制。需要工具或等待时，可先给一句符合 Persona 的简短进度，再执行并给完整结果；已有进度不要重复说稍等。只描述实际执行状态，不把计划或工具返回等同于成功。用户明确更正时采用新要求；不要自行假设已取消或撤销工具副作用。`;

export function options(input={}) {
  const result={enabled:input.enabled!==false,hangOnMs:input.hangOnMs??8000,throttleMs:input.throttleMs??180,maxBubbles:input.maxBubbles??3,chatMaxChars:input.chatMaxChars??240,bubbleTargetChars:input.bubbleTargetChars??300,hangOnText:input.hangOnText??'还在处理中，稍等一下。'};
  for(const [key,min,max]of [['hangOnMs',10,300000],['throttleMs',0,5000],['maxBubbles',1,4],['chatMaxChars',20,1000]])if(!Number.isInteger(result[key])||result[key]<min||result[key]>max)throw Error('Invalid interaction option: '+key);
  if(typeof result.hangOnText!=='string'||!result.hangOnText.trim()||result.hangOnText.length>200)throw Error('Invalid hangOnText');
  if(!Number.isInteger(result.bubbleTargetChars)||result.bubbleTargetChars<100||result.bubbleTargetChars>1000)throw Error('Invalid bubbleTargetChars');
  return Object.freeze(result);
}

// Only committed text is segmented. Markdown blocks and inline constructs are
// atomic; character counts are soft targets, never truncation limits.
export function semanticParts(text,config,limit) {
  if(limit<=1)return [text];
  if(text.length<=config.chatMaxChars&&/[`~\[\]<>|]|https?:\/\/|(?:^|\n)\s*(?:[-*+#]|\d+[.)])\s/u.test(text))return [text];
  const points=[],paragraphs=new Set();let offset=0,fence=null,list=false,quotes=[],inline=false,brackets=0,paren=0;
  const pairs={'「':'」','『':'』','“':'”','‘':'’','（':'）'};
  const lines=text.match(/[^\n]*\n|[^\n]+$/g)??[];
  for(let n=0;n<lines.length;n++){
    const line=lines[n],marker=line.match(/^\s{0,3}(`{3,}|~{3,})/),structured=/^\s*(?:[-*+]\s|\d+[.)]\s|\|)/u.test(line);
    if(marker){if(!fence)fence={char:marker[1][0],size:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.size)fence=null;offset+=line.length;continue;}
    if(!line.trim())list=false;else if(structured)list=true;
    if(fence||list){offset+=line.length;continue;}
    for(let i=0;i<line.length;i++){
      const c=line[i];if(c==='`'&&line[i-1]!=='\\')inline=!inline;if(inline)continue;
      if(c==='[')brackets++;if(c===']')brackets=Math.max(0,brackets-1);
      if(c==='(')paren++;if(c===')')paren=Math.max(0,paren-1);
      if(pairs[c])quotes.push(pairs[c]);else if(quotes.at(-1)===c)quotes.pop();
      if(!quotes.length&&!brackets&&!paren&&/[。！？；]/u.test(c)){
        let end=offset+i+1;while(end<text.length&&/[”’」』）)\s]/u.test(text[end]))end++;
        if(end<text.length&&end>=4)points.push(end);
      }
    }
    offset+=line.length;
    if(!line.trim()&&!quotes.length&&!inline&&!brackets&&!paren&&offset<text.length){points.push(offset);paragraphs.add(offset);}
  }
  const candidates=[...new Set(points)].sort((a,b)=>a-b),parts=[];let start=0;
  while(parts.length<limit-1){
    const remaining=candidates.filter(p=>p>start&&text.slice(start,p).trim()&&text.slice(p).trim());if(!remaining.length)break;
    let end;
    if(text.length<=config.chatMaxChars)end=remaining[0];
    else{
      const target=config.bubbleTargetChars,min=Math.floor(target/2),max=Math.ceil(target*4/3);
      const near=remaining.filter(p=>p-start>=min&&p-start<=max),preferred=near.filter(p=>paragraphs.has(p));
      const choices=preferred.length?preferred:near;
      end=choices.length?choices.reduce((a,b)=>Math.abs(a-start-target)<=Math.abs(b-start-target)?a:b):remaining.find(p=>p-start>=min);
    }
    if(end===undefined)break;parts.push(text.slice(start,end));start=end;
  }
  parts.push(text.slice(start));return parts;
}

// Hold the tail until native settlement. The preview never extends beyond the
// earliest possible boundary, so final segmentation cannot retract visible text.
function preview(text){
  const stop=text.search(/[。！？；\n]/u);return stop<0?text:text.slice(0,stop+1);
}

// Conservative plain-text boundaries; code, lists, links and tables stay intact.
export function boundary(text) {
  if(/[`~\[\]<>|]|https?:\/\/|(?:^|\n)\s*(?:[-*+#]|\d+[.)])\s/u.test(text))return 0;
  const pairs={'「':'」','『':'』','“':'”','‘':'’','（':'）'},stack=[];
  for(let i=0;i<text.length;i++){
    if(pairs[text[i]])stack.push(pairs[text[i]]);
    else if(stack.at(-1)===text[i])stack.pop();
    if(!stack.length&&i>=3&&/[。！？；]/u.test(text[i])){
      let end=i+1;while(/[”’」』）)\s]/u.test(text[end]??'')&&end<text.length)end++;
      if(end<text.length)return end;
    }
  }
  return 0;
}

export class Interaction {
  constructor(agent,config={},clock={now:Date.now,set:setTimeout,clear:clearTimeout}) {
    this.agent=agent;this.config=options(config);this.clock=clock;this.chain=Promise.resolve();this.token={cancelled:false};this.active=false;this.closed=false;this.transport=null;this.tools=new Set();this.streams=new Map();this.seen=new WeakSet();this.revision=-1;this.errors=[];this.message=null;
  }
  bind(transport) {
    if(this.closed||!this.config.enabled)return false;
    if(!transport||typeof transport.sendText!=='function')throw Error('Interaction transport requires sendText');
    if(this.transport&&this.transport.key!==transport.key)throw Error('Only one output owner per Agent');
    if(transport.requireIngress&&!this.transport?.requireIngress)this.background=true;
    this.transport=transport;if(this.message&&!this.message.transport)this.message.transport=transport;return true;
  }
  admitInput(message){
    if(!message||typeof message!=='object')throw Error('Native input required');
    this.inputs??=new Map();
    for(const [key,input]of this.inputs)if(this.clock.now()-input.at>300000)this.inputs.delete(key);
    if(this.inputs.size>=100)throw Error('Too many pending interaction inputs');
    this.inputs.set(message.id??message,{message,at:this.clock.now()});
  }
  queue(fn,token=this.token) {
    this.chain=this.chain.then(()=>{if(!this.closed&&!token.cancelled)return fn();}).catch(()=>{this.errors.push('transport-failed');if(this.errors.length>10)this.errors.shift();});return this.chain;
  }
  clearTimers(){for(const key of ['hangTimer','flushTimer']){if(this[key]!==undefined)this.clock.clear(this[key]);this[key]=undefined;}}
  start(turn){
    if(this.active)this.invalidate();else this.clearTimers();
    this.token={cancelled:false};this.turn=turn;this.message=null;this.active=true;this.natural=false;this.delivered=false;this.prompted=false;this.toolSeen=false;this.tools.clear();this.bubbles=0;this.started=this.clock.now();this.reply=(this.reply??0)+1;this.segment=0;
    if(this.transport?.requireIngress)this.background=true;
    this.suppressSettlement=false;
    this.hangTimer=this.clock.set(()=>{this.hangTimer=undefined;this.hangOn();},this.config.hangOnMs);
  }
  hangOn(){
    if(!this.active||this.closed||this.background||this.agent.status!=='running'||this.delivered||this.prompted||!this.transport||this.transport.waitingForUser?.())return;
    const token=this.token;this.prompted=true;
    this.queue(async()=>{if(this.token===token&&this.active&&!this.delivered&&this.agent.status==='running'&&!this.transport.waitingForUser?.()){this.bubbles++;await this.transport.sendText(this.config.hangOnText,{...this.metadata(token),kind:'status',transient:true,state:this.tools.size?'tool':'agent'});}},token);
  }
  trace(event,fields={}){try{this.transport?.trace?.(event,{turn:this.turn,reply:this.reply,...fields});}catch{}}
  metadata(token=this.token,context={turn:this.turn,reply:this.reply}){return {...context,bubble:++this.segment,onDelivered:()=>{if(this.token===token&&!token.cancelled){this.delivered=true;this.trace('delivery-confirmed');}}};}
  newMessage(){return {full:'',pending:'',transport:this.transport,token:this.token,context:{turn:this.turn,reply:this.reply},stream:null,updated:'',failed:false,finished:false};}
  text(delta){
    if(!this.active||this.closed||this.background||typeof delta!=='string'||!delta)return;
    if(delta.trim())this.natural=true;
    const m=this.message??=this.newMessage();m.full+=delta;m.pending+=delta;
    if(this.flushTimer===undefined)this.flushTimer=this.clock.set(()=>{this.flushTimer=undefined;this.update(m);},this.config.throttleMs);
  }
  split(m,final){
    if(!this.transport)return;
    if(final){
      const parts=semanticParts(m.pending,this.config,Math.max(1,this.config.maxBubbles-this.bubbles));
      // A legacy transport may have exposed a longer prefix before an upgrade.
      while(parts.length>1&&m.updated.length>parts[0].length)parts.splice(0,2,parts[0]+parts[1]);
      for(const part of parts){this.finishBubble(m,part);if(part.trim())this.bubbles++;}
      m.pending='';m.finished=true;
    }
  }
  update(m){
    if(!this.transport||m.finished||!m.pending.trim())return;
    if(m.queued)return;
    m.queued=true;
    // Read the latest cumulative snapshot when execution begins, not at enqueue.
    this.queue(async()=>{m.queued=false;if(!m.finished)await this.push(m,preview(m.pending));});
  }
  async push(m,text){
    if(m.token?.cancelled||m.failed&&!m.retrySafe||!text.trim()||!m.transport?.openStream)return;
    if(!m.stream){try{m.metadata??=this.metadata(m.token,m.context);m.stream=m.transport.openStream(m.metadata);this.streams.set(m.stream,m.token??this.token);}catch{m.failed=true;return;}}
    if(m.updated===text)return;
    try{await m.stream.update(text);if(!m.transport.deliveryReceipts)m.metadata?.onDelivered();m.updated=text;m.failed=false;}catch(error){m.failed=true;m.retrySafe=error?.delivery==='rejected'||(error?.httpStatus>=400&&error.httpStatus<500&&error.httpStatus!==408);this.errors.push(m.retrySafe?'stream-delivery-rejected':'stream-delivery-unknown');}
  }
  finishBubble(m,text){
    if(!text.trim()&&!m.stream)return;
    // Detach the segment immediately; subsequent tokens get a separate stream.
    const token=this.token,segment={transport:m.transport,token,context:m.context,stream:null,updated:'',failed:false};
    this.queue(async()=>{
      segment.stream=m.stream;segment.updated=m.updated;segment.failed=m.failed;segment.retrySafe=m.retrySafe;segment.metadata=m.metadata??this.metadata(token,m.context);
      m.stream=null;m.updated='';m.failed=false;m.metadata=null;
      if(!segment.transport)return;
      if(!segment.stream&&!segment.transport.openStream){await segment.transport.sendText(text,{...segment.metadata,kind:'assistant',cancelled:()=>token.cancelled});segment.metadata.onDelivered();return;}
      await this.push(segment,text);
      if(token.cancelled){if(this.streams.delete(segment.stream))segment.stream?.cancel?.();return;}
      if(segment.stream&&!segment.failed){try{await segment.stream.complete();}catch{this.errors.push('stream-close-failed');}}
      else if(!segment.stream){await segment.transport.sendText(text,{...segment.metadata,kind:'assistant',cancelled:()=>token.cancelled});segment.metadata.onDelivered();}
      if(segment.stream)this.streams.delete(segment.stream);
    });
  }
  finish(text){
    if(this.background||this.suppressSettlement)return;
    if(this.flushTimer!==undefined)this.clock.clear(this.flushTimer);this.flushTimer=undefined;
    let m=this.message;
    if(!m){m=this.newMessage();m.full=text;m.pending=text;this.message=m;if(text.trim())this.natural=true;}
    // Native compact settlement should match its stream. Never resend a differing
    // full message after partial delivery, which could duplicate or mix attempts.
    if(text.startsWith(m.full)){m.pending+=text.slice(m.full.length);m.full=text;}
    else if(m.full!==text){this.errors.push('stream-settlement-mismatch');m.full=text;m.pending=text;}
    this.split(m,true);this.message=null;
  }
  invalidate(){
    this.clearTimers();this.token.cancelled=true;this.suppressSettlement=true;this.message=null;this.attempt=null;
    // complete() may flush unsent SDK buffers. Cancellation must never do that.
    for(const [pending,token]of this.streams)if(token.cancelled){try{pending.cancel?.();}catch{this.errors.push('stream-cancel-failed');}this.streams.delete(pending);}
  }
  frame(frame){
    if(this.closed||!this.config.enabled)return;
    if(!this.active&&this.turn===undefined&&frame?.type==='start'&&this.agent.status==='running')this.start(frame.turn);
    if(!this.active)return;
    if(frame.turn!==undefined&&this.turn!==undefined&&frame.turn!==this.turn)return;
    if(!Number.isInteger(frame?.revision)||frame.revision<=this.revision)return;this.revision=frame.revision;
    if(frame.type==='start'){
      this.trace('attempt-start',{attempt:String(frame.attemptId)});
      if(this.message){this.invalidate();this.token={cancelled:false};this.errors.push('retried-attempt');}
      this.attempt=frame.attemptId;this.message=this.newMessage();
      this.suppressSettlement=false;
    }else if(frame.attemptId===this.attempt&&frame.type==='chunk'){
      if(frame.chunk?.type==='tool-call-delta')this.toolSeen=true;
      if(frame.chunk?.type==='text-delta')this.text(frame.chunk.text);
    }else if(frame.attemptId===this.attempt&&frame.type==='end'){
      if(frame.outcome?.eventType!=='assistant/message'&&this.message){this.invalidate();this.token={cancelled:false};}
      this.attempt=null;
    }
  }
  event(event){
    if(this.closed||!this.config.enabled||this.seen.has(event))return;this.seen.add(event);
    const d=event.data??{};
    if(event.type==='user/message'){
      const incoming=d.message??d;
      // Host projections do not change admission, consume an input ticket, or
      // revive canceled/background output. Keep QQ's context classification in sync.
      if(['runtime-context','skill-catalog','time-context','agent-instructions'].includes(incoming.source?.kind))return;
      if(this.transport?.requireIngress){
        const message=incoming,key=message?.id??message,admitted=this.inputs?.get(key);
        this.inputs?.delete(key);
        this.background=!admitted||this.clock.now()-admitted.at>300000;
      }else this.background=incoming.source?.kind!==undefined&&incoming.source.kind!=='user';
      if(this.background)this.invalidate();else if(this.token.cancelled){this.token={cancelled:false};this.suppressSettlement=false;}
    }
    if(event.type!=='turn/start'&&d.turn!==undefined&&this.turn!==undefined&&d.turn!==this.turn)return;
    if(event.type==='turn/start')this.start(d.turn);
    else if(event.type==='tool/call'){this.toolSeen=true;this.tools.add(d.callId);}
    else if(event.type==='tool/result')this.tools.delete(d.message?.source?.callId);
    else if(event.type==='assistant/message'&&this.active){
      if(d.message?.content?.some(b=>b.type==='tool-call'))this.toolSeen=true;
      const text=(d.message?.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('');
      this.trace('assistant-settlement',{seq:event.seq,length:text.length});
      if(d.interrupted){this.invalidate();return;}
      this.finish(text);
    }else if(event.type==='turn/end'){
      this.active=false;this.clearTimers();
      if(d.reason?.kind!=='completed'&&d.reason?.kind!=='max-tokens')this.invalidate();
      else if(this.message)this.invalidate();
      this.tools.clear();
    }
  }
  revise(message){
    if(this.closed||!this.config.enabled)throw Error('Interaction disabled');
    // Called only by trusted ingress with a native UserMessage, never by model tools.
    if(this.agent.status!=='running'){this.agent.followup(message);return 'queued';}
    if(!this.active||this.toolSeen||this.tools.size){this.invalidate();this.token={cancelled:false};this.agent.steer(message);return 'steered';}
    this.invalidate();this.active=false;this.agent.cancel({kind:'user'},{keepInbox:true});this.agent.followup(message);return 'restarted';
  }
  stopOutput(){this.active=false;this.invalidate();}
  external(text,meta={}){if(this.background||this.suppressSettlement)return Promise.resolve();const transport=this.transport;const token=this.token;return this.queue(()=>transport?.sendText(text,{...meta,cancelled:()=>token.cancelled}));}
  async idle(){await this.chain;}
  async dispose(){this.active=false;this.invalidate();this.closed=true;this.transport=null;}
}
