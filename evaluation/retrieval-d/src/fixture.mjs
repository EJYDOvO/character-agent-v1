// Builds the synthetic SQLite memory database through the real, unmodified LayeredMemory API.
// Nothing here reads a production database or starts a Host.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';
import {LayeredMemory} from '../../../packages/character-memory-core/layered.mjs';
import {scopes,memories,distractors} from '../dataset/corpus.mjs';

export const CURRENT_SESSION='session-current';
export async function buildFixture({noise=300,dir}={}){
 const own=!dir;dir??=fs.mkdtempSync(path.join(os.tmpdir(),'retrieval-d-'));
 const file=path.join(dir,'memory.sqlite'),issued=new WeakMap(),handles=new Map();
 const store=new LayeredMemory(file,(h,action)=>{assert(issued.has(h),'Unauthorized');return issued.get(h);});
 const bind=(scopeKey,sessionId=CURRENT_SESSION)=>{const key=scopeKey+'|'+sessionId;if(!handles.has(key)){const h=Object.freeze({sessionId});issued.set(h,{...scopes[scopeKey],agentId:'agent-'+scopeKey,memoryMode:'off'});handles.set(key,h);}return handles.get(key);};
 const ids=new Map(),labels=new Map(),meta=new Map();let seq=0;
 const rows=[...memories,...distractors(noise)];
 for(const [label,scopeKey,kind,statement,options={}]of rows){
  assert(!meta.has(label),'Duplicate label '+label);
  const session=options.session??'session-2026-a',h=bind(scopeKey,session),origin=options.origin??'direct_user',initial=options.was??statement;
  const row=store.remember(h,{kind,statement:initial,...(options.expiresAt?{expiresAt:options.expiresAt}:{}),...(options.claimKey?{claimKey:options.claimKey}:{})},{sessionId:session,eventSeq:++seq,messageId:'fx-'+seq,origin,...(origin==='direct_user'?{text:initial}:{})});
  ids.set(label,row.id);labels.set(row.id,label);
  meta.set(label,{label,scope:scopeKey,kind,statement,was:options.was??null,forgotten:!!options.forget,expired:!!options.expiresAt&&Date.parse(options.expiresAt)<=Date.now(),claimKey:options.claimKey??null,session,origin,noise:label.startsWith('noise-')});
 }
 // Lifecycle operations run from the current Session, after all records exist.
 for(const m of meta.values()){
  const h=bind(m.scope),id=ids.get(m.label);
  if(m.was){const row=store.get(h,id);store.correct(h,id,m.statement,row.revision,{sessionId:h.sessionId,eventSeq:++seq,messageId:'fx-'+seq,origin:'direct_user',text:m.statement});}
  if(m.forgotten){const row=store.get(h,id);store.forget(h,id,row.revision);}
 }
 return {store,file,dir,ids,labels,meta,bind,issued,ctx:scopeKey=>bind(scopeKey),nextSeq:()=>++seq,
  close(){try{store.close();}catch{}if(own)fs.rmSync(dir,{recursive:true,force:true});}};
}
