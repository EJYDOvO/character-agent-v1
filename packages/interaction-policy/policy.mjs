// Process-local presentation only: never appends Session events. The optional
// hang-on drafter is an injected callback; this module never calls a model.
export const replyPolicy = `Interaction Policy V1：沿用既定 Persona 的语言、语气与边界，自然交流，不因处理任务切换成另一人格。闲聊简洁，可以用自然段分开完整语义；不要为分气泡生造内容。简短问候、语气词或表情（如“早”“-.-”“XD”）按轻松语气自然接话，可以调侃，但不据此推断对方不满、着急或催促，也不分析对方情绪。不要向用户复述内部工具名、ID、参数错误或重试过程，除非它影响结果。复杂任务保留完整 Assistant 能力、必要细节、代码和依据，不受闲聊字数目标限制。需要工具或等待时，可先给一句符合 Persona 的简短进度，再执行并给完整结果；已有进度不要重复说稍等。只描述实际执行状态，不把计划或工具返回等同于成功。用户明确更正时采用新要求；不要自行假设已取消或撤销工具副作用。`;

export function options(input={}) {
  const hangOnMs=input.hangOnMs??8000;
  const result={enabled:input.enabled!==false,hangOnMs,hangOnDraftMs:input.hangOnDraftMs??(Number.isInteger(hangOnMs)?Math.round(hangOnMs/2):0),throttleMs:input.throttleMs??180,maxBubbles:input.maxBubbles??3,chatMaxChars:input.chatMaxChars??240,bubbleTargetChars:input.bubbleTargetChars??300,hangOnText:input.hangOnText??'还在处理中，稍等一下。'};
  for(const [key,min,max]of [['hangOnMs',10,300000],['throttleMs',0,5000],['maxBubbles',1,4],['chatMaxChars',20,1000]])if(!Number.isInteger(result[key])||result[key]<min||result[key]>max)throw Error('Invalid interaction option: '+key);
  if(!Number.isInteger(result.hangOnDraftMs)||result.hangOnDraftMs<0||result.hangOnDraftMs>=result.hangOnMs)throw Error('Invalid interaction option: hangOnDraftMs');
  if(typeof result.hangOnText!=='string'||!result.hangOnText.trim()||result.hangOnText.length>200)throw Error('Invalid hangOnText');
  if(!Number.isInteger(result.bubbleTargetChars)||result.bubbleTargetChars<100||result.bubbleTargetChars>1000)throw Error('Invalid bubbleTargetChars');
  // Location of the optional hangon-model.json route; not a feature switch.
  if(input.hangOnModelFile!==undefined){
    if(typeof input.hangOnModelFile!=='string'||!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/u.test(input.hangOnModelFile))throw Error('Invalid interaction option: hangOnModelFile');
    result.hangOnModelFile=input.hangOnModelFile;
  }
  return Object.freeze(result);
}

// A drafted hang-on is one short plain line. Digits, links and Markdown are
// rejected so a model cannot invent progress, ETAs or formatted content.
export function hangOnLine(text) {
  if(typeof text!=='string')return null;
  const line=text.replace(/\s+/gu,' ').trim().replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/gu,'').trim();
  if(!line||[...line].length>60||/[`#*_~\[\]<>|{}]|https?:\/\/|[0-9０-９%％]/u.test(line))return null;
  return line;
}

// Only committed text is segmented. Markdown blocks and inline constructs are
// atomic; character counts are soft targets, never truncation limits.
function splitPoints(text){
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
  return {points:[...new Set(points)].sort((a,b)=>a-b),paragraphs};
}
// A bubble must not end on a lead-in ("如下：") or leave a heading, with at most
// a short intro, cut off from the body it introduces.
const HEADING=/^\s{0,3}(?:#{1,6}\s+\S|\d+[.)、]\s*\S.{0,40}$|\*\*[^*\n]+\*\*[：:]?\s*$)/u;
function goodCut(text,start,end){
  const head=text.slice(start,end).trimEnd();
  if(/(?:[：:]|如下|例如|以下)$/u.test(head))return false;
  const lines=head.split('\n');let tail=0;
  for(let i=lines.length-1;i>=0&&tail<=80;i--){if(HEADING.test(lines[i]))return false;tail+=lines[i].length+1;}
  return true;
}
export function semanticParts(text,config,limit) {
  if(limit<=1)return [text];
  if(text.length<=config.chatMaxChars&&/[`~\[\]<>|]|https?:\/\/|(?:^|\n)\s*(?:[-*+#]|\d+[.)])\s/u.test(text))return [text];
  const {points:candidates,paragraphs}=splitPoints(text),parts=[];let start=0;
  while(parts.length<limit-1){
    const remaining=candidates.filter(p=>p>start&&text.slice(start,p).trim()&&text.slice(p).trim());if(!remaining.length)break;
    let end;
    // A chat reply stays whole; only a paragraph break between two substantial
    // parts separates it, never a lone interjection or short sentence.
    if(text.length<=config.chatMaxChars)end=remaining.find(p=>paragraphs.has(p)&&text.slice(start,p).trim().length>=CHAT_MIN&&text.slice(p).trim().length>=CHAT_MIN);
    else{
      const target=config.bubbleTargetChars,min=Math.floor(target/2),max=Math.ceil(target*4/3),good=remaining.filter(p=>goodCut(text,start,p));
      const near=good.filter(p=>p-start>=min&&p-start<=max),preferred=near.filter(p=>paragraphs.has(p));
      const choices=preferred.length?preferred:near;
      end=choices.length?choices.reduce((a,b)=>Math.abs(a-start-target)<=Math.abs(b-start-target)?a:b):good.find(p=>p-start>=min);
    }
    if(end===undefined)break;parts.push(text.slice(start,end));start=end;
  }
  parts.push(text.slice(start));return parts;
}

// Streaming commit point for a long reply. It commits only once the whole soft
// window has arrived, so it picks exactly the first part the final split would,
// and only when the following line is complete and does not continue a list,
// table or code block. 0 means keep streaming.
export function progressiveCut(text,config){
  const max=Math.ceil(config.bubbleTargetChars*4/3);
  if(text.length<=Math.max(max,config.chatMaxChars))return 0;
  const parts=semanticParts(text,config,2);if(parts.length<2)return 0;
  const p=parts[0].length,next=/^\s*(\S[^\n]*)\n/u.exec(text.slice(p));if(!next)return 0;
  if(/^\s{0,3}(?:`{3,}|~{3,})/u.test(next[1]))return 0;
  const prev=text.slice(0,p).trimEnd().split('\n').at(-1)??'',item=/^\s*(?:[-*+]\s|\d+[.)]\s)/u,row=/^\s*\|/u;
  return (item.test(prev)&&item.test(next[1]))||(row.test(prev)&&row.test(next[1]))?0:p;
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

const JUDGE_MS=2500,DECISIONS=['revise','priority','supplement','append'],CHAT_MIN=12;
const textOf=message=>(message?.content??[]).filter(b=>b?.type==='text').map(b=>b.text??'').join('\n');
// One cancellation ticket per reply generation; its signal lets the platform
// side stop parts it has not sent yet.
const ticket=()=>{const control=new AbortController();return {cancelled:false,signal:control.signal,cancel(){this.cancelled=true;control.abort();}};};

export class Interaction {
  // drafter({agent,state,signal}) resolves one candidate hang-on line. It must
  // not append Session events, create Agents or touch Memory.
  // judge({agent,current,incoming,phase,signal}) classifies an input that arrives
  // mid-run as revise/priority/supplement/append. It routes only; it never answers.
  constructor(agent,config={},clock={now:Date.now,set:setTimeout,clear:clearTimeout},drafter,judge) {
    this.agent=agent;this.config=options(config);this.clock=clock;this.drafter=typeof drafter==='function'?drafter:null;this.judge=typeof judge==='function'?judge:null;this.intervention=null;this.hold=null;this.draftControl=null;this.candidate=null;this.chain=Promise.resolve();this.token=ticket();this.active=false;this.closed=false;this.transport=null;this.tools=new Set();this.seen=new WeakSet();this.revision=-1;this.errors=[];this.message=null;this.children=new Map();this.replyCtx=null;
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
    const run=()=>{if(!this.closed&&!token.cancelled)return fn();};
    this.chain=this.chain.then(()=>this.hold?this.hold.promise.then(run):run()).catch(()=>{this.errors.push('transport-failed');if(this.errors.length>10)this.errors.shift();});return this.chain;
  }
  note(error){this.errors.push(error);if(this.errors.length>10)this.errors.shift();}
  clearTimers(){for(const key of ['hangTimer','draftTimer','flushTimer']){if(this[key]!==undefined)this.clock.clear(this[key]);this[key]=undefined;}this.stopDraft();}
  stopDraft(){const control=this.draftControl;this.draftControl=null;control?.abort();}
  start(turn){
    if(this.active)this.invalidate();else this.clearTimers();
    this.token=ticket();this.turn=turn;this.message=null;this.active=true;this.natural=false;this.delivered=false;this.prompted=false;this.drafted=false;this.draftState=undefined;this.candidate=null;this.toolSeen=false;this.tools.clear();this.started=this.clock.now();this.beginReply();
    if(this.transport?.requireIngress)this.background=true;
    this.suppressSettlement=false;
    if(this.drafter)this.draftTimer=this.clock.set(()=>{this.draftTimer=undefined;this.draft();},this.config.hangOnDraftMs);
    this.hangTimer=this.clock.set(()=>{this.hangTimer=undefined;this.hangOn();},this.config.hangOnMs);
  }
  // Only a natural-reply receipt suppresses hang-on; SDK buffering does not.
  // Hang-on is a status line outside the content bubble budget; it is skipped
  // once settled text already claims the whole budget.
  waiting(){return this.active&&!this.closed&&!this.background&&this.agent.status==='running'&&!this.delivered&&!this.prompted&&this.bubbles<this.config.maxBubbles&&!!this.transport&&!this.transport.waitingForUser?.();}
  draft(){
    if(this.drafted||!this.drafter||!this.waiting())return;
    const token=this.token,control=new AbortController(),began=this.clock.now();this.drafted=true;this.draftControl=control;this.draftState='pending';
    // The request excerpt and recent lines keep the line situational and varied;
    // nothing is persisted.
    let pending;try{pending=Promise.resolve(this.drafter({agent:this.agent,state:this.tools.size?'tool':'agent',request:(this.replyCtx?.text??'').slice(-200),recent:[...(this.recentHangOns??[])],signal:control.signal}));}catch(error){pending=Promise.reject(error);}
    const settle=draft=>{const elapsedMs=this.clock.now()-began;this.trace('hang-on-draft',{draft,elapsedMs});};
    pending.then(text=>{
      if(this.draftControl!==control||control.signal.aborted||this.token!==token||token.cancelled){if(this.token===token&&this.prompted)settle('late');return;}
      this.draftControl=null;const line=hangOnLine(text);
      if(line){this.candidate=line;this.draftState='ready';settle('ready');}else{this.draftState='rejected';this.note('hang-on-draft-rejected');settle('rejected');}
    },()=>{if(this.draftControl===control){this.draftControl=null;this.draftState='failed';this.note('hang-on-draft-failed');settle('failed');}else if(this.token===token&&this.prompted)settle('late');});
  }
  hangOn(){
    if(!this.waiting()){this.stopDraft();return;}
    const token=this.token,text=this.candidate??this.config.hangOnText,state=this.tools.size?'tool':'agent',dynamic=text!==this.config.hangOnText;
    // ready: drafted line used; late/failed/rejected/none: static fallback and why.
    const draft=this.candidate?'ready':this.draftState==='pending'?'late':this.draftState??'none';
    this.prompted=true;this.stopDraft();this.candidate=null;
    if(dynamic){this.recentHangOns=[...(this.recentHangOns??[]),text].slice(-3);}
    this.trace('hang-on',{state:state==='tool'?1:0,dynamic,draft});
    this.queue(async()=>{
      if(this.token===token&&this.active&&!this.delivered&&this.agent.status==='running'&&!this.transport.waitingForUser?.())await this.transport.sendText(text,{...this.metadata(token,undefined,'status'),transient:true,state,dynamic,cancelled:()=>token.cancelled});
    },token);
  }
  trace(event,fields={}){try{this.transport?.trace?.(event,{turn:this.turn,reply:this.reply,...fields});}catch{}}
  // One reply context per admitted input: its own bubble budget and numbering,
  // so a late tail never borrows the next input's counters. `input` is the
  // native UserMessage id; platforms map it to their own reply target.
  beginReply(input){this.reply=(this.reply??0)+1;this.bubbles=0;this.replyCtx={turn:this.turn,reply:this.reply,input,seq:0};if(this.message&&!this.message.full)this.message.context=this.replyCtx;}
  // Only assistant output confirms the natural reply; a status receipt never does.
  metadata(token=this.token,context=this.replyCtx,kind='assistant'){const c=context??{turn:this.turn,reply:this.reply};c.seq=(c.seq??0)+1;return {turn:c.turn,reply:c.reply,...(c.input===undefined?{}:{input:c.input}),kind,bubble:c.seq,signal:token.signal,onDelivered:()=>{if(kind!=='status'&&this.token===token&&!token.cancelled){this.delivered=true;this.stopDraft();this.trace('delivery-confirmed',{turn:c.turn,reply:c.reply});}}};}
  newMessage(){return {full:'',pending:'',transport:this.transport,token:this.token,context:this.replyCtx,finished:false};}
  text(delta){
    if(!this.active||this.closed||this.background||typeof delta!=='string'||!delta)return;
    if(delta.trim())this.natural=true;
    const m=this.message??=this.newMessage();m.full+=delta;
    // A retried attempt that repeats already committed bubbles skips them.
    if(m.skip===undefined)m.pending+=delta;
    else if(m.full.length<m.skip.length&&m.skip.startsWith(m.full))return;
    else{const same=m.full.startsWith(m.skip);m.pending=same?m.full.slice(m.skip.length):m.full;m.committed=same?m.skip.length:0;if(!same)this.trace('retry-diverged',{});m.skip=undefined;}
    if(this.flushTimer===undefined)this.flushTimer=this.clock.set(()=>{this.flushTimer=undefined;this.update(m);},this.config.throttleMs);
  }
  split(m,final){
    if(!this.transport)return;
    if(final){
      const parts=semanticParts(m.pending,this.config,Math.max(1,this.config.maxBubbles-this.bubbles));
      for(const part of parts){this.finishBubble(m,part);if(part.trim())this.bubbles++;}
      m.pending='';m.finished=true;
    }
  }
  // Bubbles are committed whole: nothing is shown before it is final. While the
  // reply streams, each bubble the final split would cut is committed as soon
  // as it is complete, keeping one bubble of the reply budget for the open tail;
  // the rest is committed at settlement.
  update(m){
    if(!this.transport||m.finished||!m.pending.trim()||m.queued)return;
    m.queued=true;
    // Read the latest cumulative snapshot when execution begins, not at enqueue.
    this.queue(async()=>{
      m.queued=false;
      while(!m.finished&&this.config.maxBubbles-this.bubbles>1){
        const cut=progressiveCut(m.pending,this.config);if(!cut)break;
        const head=m.pending.slice(0,cut);m.pending=m.pending.slice(cut);m.committed=(m.committed??0)+cut;this.bubbles++;
        await this.deliver(m,head,m.token??this.token);
      }
    });
  }
  finishBubble(m,text){
    if(!text.trim())return;
    const token=this.token;this.queue(()=>this.deliver(m,text,token));
  }
  // One complete bubble is handed to the transport once; the platform side owns
  // reliable delivery. A bubble that was not confirmed is never resent, and the
  // later bubbles of its reply are withheld so the user never sees a gap. A
  // partial or unknown result may be visible, so it counts as the natural reply.
  async deliver(m,text,token){
    const transport=m.transport,context=m.context;
    if(!transport||token.cancelled||!text.trim())return;
    const metadata=this.metadata(token,context),where={turn:metadata.turn,reply:metadata.reply,bubble:metadata.bubble};
    if(context?.failed){this.trace('bubble-withheld',where);return;}
    try{await transport.sendText(text,{...metadata,cancelled:()=>token.cancelled});metadata.onDelivered();}
    catch(error){
      if(token.cancelled)return;
      if(error?.delivery==='partial'||error?.delivery==='unknown')metadata.onDelivered();
      if(context)context.failed=true;
      this.note(error?.delivery==='unknown'?'bubble-delivery-unknown':'bubble-delivery-failed');this.trace('bubble-failed',where);
    }
  }
  finish(text){
    if(this.background||this.suppressSettlement)return;
    if(this.flushTimer!==undefined)this.clock.clear(this.flushTimer);this.flushTimer=undefined;
    let m=this.message;
    if(!m){m=this.newMessage();m.full=text;m.pending=text;this.message=m;if(text.trim())this.natural=true;}
    // Native compact settlement should match its stream. Never resend a differing
    // full message after partial delivery, which could duplicate or mix attempts.
    if(m.skip!==undefined){const same=text.startsWith(m.skip);m.pending=same?text.slice(m.skip.length):text;m.committed=same?m.skip.length:0;m.full=text;m.skip=undefined;}
    else if(text.startsWith(m.full)){m.pending+=text.slice(m.full.length);m.full=text;}
    else if(m.full!==text){
      // Committed bubbles are never resent; a settlement that rewrites them is withheld.
      const shown=m.full.slice(0,m.committed??0);this.errors.push('stream-settlement-mismatch');m.full=text;
      if(text.startsWith(shown))m.pending=text.slice(shown.length);else{m.pending='';this.trace('settlement-diverged',{});}
    }
    this.split(m,true);this.message=null;
  }
  invalidate(){
    this.clearTimers();this.token.cancel();this.suppressSettlement=true;this.message=null;this.attempt=null;
  }
  frame(frame){
    if(this.closed||!this.config.enabled)return;
    if(!this.active&&this.turn===undefined&&frame?.type==='start'&&this.agent.status==='running')this.start(frame.turn);
    if(!this.active)return;
    if(frame.turn!==undefined&&this.turn!==undefined&&frame.turn!==this.turn)return;
    if(!Number.isInteger(frame?.revision)||frame.revision<=this.revision)return;this.revision=frame.revision;
    if(frame.type==='start'){
      this.trace('attempt-start',{attempt:String(frame.attemptId)});
      const shown=this.message?.committed?this.message.full.slice(0,this.message.committed):undefined;
      if(this.message){this.invalidate();this.token=ticket();this.errors.push('retried-attempt');}
      this.attempt=frame.attemptId;this.message=this.newMessage();if(shown)this.message.skip=shown;
      this.suppressSettlement=false;
    }else if(frame.attemptId===this.attempt&&frame.type==='chunk'){
      if(frame.chunk?.type==='tool-call-delta')this.toolSeen=true;
      if(frame.chunk?.type==='text-delta')this.text(frame.chunk.text);
    }else if(frame.attemptId===this.attempt&&frame.type==='end'){
      if(frame.outcome?.eventType!=='assistant/message'&&this.message){this.invalidate();this.token=ticket();}
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
      // A Worker started from an admitted reply continues that reply when it
      // settles, however long it ran. Unknown children stay background.
      const child=this.settledChild(incoming),key=incoming?.id??incoming;
      if(this.transport?.requireIngress){
        const admitted=this.inputs?.get(key);
        this.inputs?.delete(key);
        this.background=!child&&(!admitted||this.clock.now()-admitted.at>300000);
      }else this.background=!child&&incoming.source?.kind!==undefined&&incoming.source.kind!=='user';
      if(this.background)this.invalidate();else if(this.token.cancelled){this.token=ticket();this.suppressSettlement=false;}
      if(!this.background&&this.active){const input=child?child.input:key;if(this.replyCtx&&(this.replyCtx.input!==undefined||this.replyCtx.seq>0))this.beginReply(input);else if(this.replyCtx)this.replyCtx.input=input;if(!child&&this.replyCtx)this.replyCtx.text=textOf(incoming).slice(-1500);}
    }
    if(event.type!=='turn/start'&&d.turn!==undefined&&this.turn!==undefined&&d.turn!==this.turn)return;
    if(event.type==='turn/start')this.start(d.turn);
    else if(event.type==='subagent/catalog'&&this.active&&!this.background&&typeof d.childId==='string'){this.children.delete(d.childId);this.children.set(d.childId,{input:this.replyCtx?.input});if(this.children.size>50)this.children.delete(this.children.keys().next().value);}
    else if(event.type==='tool/call'){this.toolSeen=true;this.tools.add(d.callId);}
    else if(event.type==='tool/result'){
      const finished=this.tools.delete(d.message?.source?.callId);
      if(finished&&!this.tools.size)this.toolSeen=false;
    }
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
  settledChild(message){const source=message?.source;return source?.kind==='subagent-settled'&&typeof source.senderSessionId==='string'?this.children.get(source.senderSessionId):undefined;}
  // Platform bridges ask before suppressing a non-user source.
  admitsSource(message){const kind=message?.source?.kind;return kind===undefined||kind==='user'||!!this.settledChild(message);}
  revise(message){return this.intervene(message,{explicit:'revise'});}
  // Trusted ingress hands every input that arrives while the Agent runs to
  // intervene(), never a model tool. Only native cancel/steer/followup are used.
  // A text-only reply is cancelled only for an explicit correction or a judged
  // revise/priority; tools and approvals are never interrupted (steer instead).
  // Anything unclear, slow or failing is queued as an independent follow-up.
  intervene(message,{explicit}={}){
    if(this.closed||!this.config.enabled)throw Error('Interaction disabled');
    if(this.intervention&&(explicit==='revise'||this.agent.status!=='running')){
      this.intervention.messages.push(message);
      return this.resolveIntervention(this.intervention,this.agent.status==='running'?'revise':'append','superseded');
    }
    if(this.agent.status!=='running'){this.agent.followup(message);return 'queued';}
    if(explicit==='revise')return this.act('revise',[message],'explicit');
    if(!this.judge)return this.act('append',[message],'none');
    // Unsent output waits while the judge runs, so a correction cannot be
    // overtaken by stale text. The wait is bounded by JUDGE_MS from the first input.
    const pending=this.intervention??=this.openIntervention();
    pending.messages.push(message);pending.control?.abort();
    const control=pending.control=new AbortController();
    const incoming=pending.messages.map(textOf).join('\n').slice(-1500);
    let result;try{result=Promise.resolve(this.judge({agent:this.agent,current:this.replyCtx?.text??'',incoming,phase:this.phase(),signal:control.signal}));}catch(error){result=Promise.reject(error);}
    result.then(decision=>{if(pending.control===control)this.resolveIntervention(pending,DECISIONS.includes(decision)?decision:'append',DECISIONS.includes(decision)?'judge':'invalid');},()=>{if(pending.control===control)this.resolveIntervention(pending,'append','error');});
    return 'judging';
  }
  openIntervention(){
    const pending={messages:[],hold:{},began:this.clock.now()};pending.hold.promise=new Promise(resolve=>pending.hold.release=resolve);this.hold=pending.hold;
    pending.timer=this.clock.set(()=>this.resolveIntervention(pending,'append','timeout'),JUDGE_MS);return pending;
  }
  resolveIntervention(pending,decision,why){
    if(this.intervention!==pending)return;
    this.intervention=null;this.clock.clear(pending.timer);pending.control?.abort();
    try{return this.act(decision,pending.messages,why,this.clock.now()-pending.began);}finally{if(this.hold===pending.hold)this.hold=null;pending.hold.release();}
  }
  phase(){return this.transport?.waitingForUser?.()?'waiting-user':this.tools.size||this.toolSeen?'tool':'text';}
  act(decision,messages,why,elapsedMs){
    const phase=this.phase();this.trace('intervene',{decision,phase,why,...(elapsedMs===undefined?{}:{elapsedMs})});
    if(this.agent.status!=='running'||decision==='append'){for(const m of messages)this.agent.followup(m);return 'queued';}
    if(decision==='supplement'){for(const m of messages)this.agent.steer(m);return 'steered';}
    if(!this.active||phase!=='text'){
      // Only a correction withdraws the old reply's unsent output.
      if(decision==='revise'){this.invalidate();this.token=ticket();}
      for(const m of messages)this.agent.steer(m);return 'steered';
    }
    this.invalidate();this.active=false;this.agent.cancel({kind:'user'},{keepInbox:true});for(const m of messages)this.agent.followup(m);return 'restarted';
  }
  // /stop also discards inputs still being judged; native cancel clears the Inbox.
  dropIntervention(){
    const pending=this.intervention;if(!pending)return;
    this.intervention=null;this.clock.clear(pending.timer);pending.control?.abort();
    if(this.hold===pending.hold)this.hold=null;pending.hold.release();this.trace('intervene',{decision:'dropped'});
  }
  stopOutput(){this.dropIntervention();this.active=false;this.invalidate();}
  external(text,meta={}){if(this.background||this.suppressSettlement)return Promise.resolve();const transport=this.transport;const token=this.token;return this.queue(()=>transport?.sendText(text,{...meta,signal:token.signal,cancelled:()=>token.cancelled}));}
  async idle(){await this.chain;}
  async dispose(){this.dropIntervention();this.active=false;this.invalidate();this.closed=true;this.transport=null;}
}
