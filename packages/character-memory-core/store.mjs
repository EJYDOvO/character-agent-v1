import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tokenizeText } from './tokenize.mjs';
const terms=text=>[...new Set(tokenizeText(text.normalize('NFKC').toLowerCase()))];
export const similarity=(a,b)=>{const x=new Set(terms(a)),y=new Set(terms(b));return [...x].filter(t=>y.has(t)).length/Math.max(1,new Set([...x,...y]).size);};
const hash = text => createHash('sha256').update(text.normalize('NFKC').trim()).digest('hex');
export function validateStatement(text, maxLength=2000) {
  if (typeof text !== 'string' || !text.trim() || text.length > maxLength) throw Error('Invalid memory size');
  if (/(?:appsecret|api[_ -]?key|access[_ -]?token|password|密码|私钥|密钥|令牌|身份证|银行卡|手机号)|-----BEGIN .*PRIVATE KEY|\bsk-[a-zA-Z0-9]{16,}|\b1[3-9]\d{9}\b/i.test(text)) throw Error('Secret-like or sensitive content rejected');
  if (/(?:忽略|覆盖|绕过).{0,12}(?:指令|审批|权限)|(?:ignore|override).{0,20}(?:instructions|permissions)/i.test(text)) throw Error('Instruction-like memory rejected');
  return text.trim();
}
export class MemoryStore {
  constructor(file, authorize) {
    mkdirSync(dirname(file), { recursive: true });
    this.authorize = authorize;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES(1);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, principal TEXT NOT NULL, character TEXT NOT NULL, project TEXT NOT NULL,
        kind TEXT NOT NULL, statement TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
        source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS scope ON memories(principal,character,project,status);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS blocked(principal TEXT, character TEXT, project TEXT, fingerprint TEXT, PRIMARY KEY(principal,character,project,fingerprint));
      CREATE TABLE IF NOT EXISTS sources(principal TEXT, character TEXT, project TEXT, source_key TEXT, memory_id TEXT, PRIMARY KEY(principal,character,project,source_key));
      CREATE TABLE IF NOT EXISTS capture_cursor(session TEXT PRIMARY KEY, seq INTEGER NOT NULL);`);
    this.migrate();
  }
  migrate(){
    const version=this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get().version;
    if(version>2)throw Error('Unsupported future memory schema');
    this.transaction(()=>{
      const columns=new Set(this.db.prepare('PRAGMA table_info(memories)').all().map(x=>x.name));
      for(const [name,decl] of Object.entries({confidence:'REAL NOT NULL DEFAULT 0.5',expires_at:'TEXT',claim_key:'TEXT',conflict_with:'TEXT'}))if(!columns.has(name))this.db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${decl}`);
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED,tokens);
        CREATE TABLE IF NOT EXISTS forgotten_sources(principal TEXT,character TEXT,project TEXT,source_key TEXT,PRIMARY KEY(principal,character,project,source_key));
        CREATE TABLE IF NOT EXISTS tombstones(principal TEXT,character TEXT,project TEXT,fingerprint TEXT,terms TEXT,PRIMARY KEY(principal,character,project,fingerprint));
        CREATE TABLE IF NOT EXISTS extraction_jobs(id TEXT PRIMARY KEY,session TEXT,scope TEXT,evidence TEXT,status TEXT,attempts INTEGER DEFAULT 0,error TEXT,at TEXT);
        UPDATE extraction_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,error='interrupted' WHERE status='running';`);
      if(version<2){this.db.exec('DELETE FROM memory_fts');for(const row of this.db.prepare("SELECT * FROM memories WHERE status!='forgotten'").all())this.index(row);this.db.exec('DELETE FROM schema_version; INSERT INTO schema_version VALUES(2)');}
    });
  }
  index(row){this.db.prepare('DELETE FROM memory_fts WHERE id=?').run(row.id);if(!['forgotten','merged'].includes(row.status))this.db.prepare('INSERT INTO memory_fts(id,tokens) VALUES(?,?)').run(row.id,terms(row.statement).join(' '));}
  evidence(ctx,source){this.scope(ctx,'write');if(!source||source.sessionId!==ctx.sessionId||!Number.isSafeInteger(source.eventSeq)||source.eventSeq<0||!['direct_user','verified_tool','inference'].includes(source.origin))throw Error('Evidence required from owning session');}
  sourceKey(source){return `${source.originalSessionId??source.sessionId}:${source.messageId??source.eventSeq}`;}
  blocked(scope,statement,source){
    if(this.db.prepare('SELECT 1 FROM blocked WHERE principal=? AND character=? AND project=? AND fingerprint=?').get(...scope,hash(statement)))return true;
    if(source&&this.db.prepare('SELECT 1 FROM forgotten_sources WHERE principal=? AND character=? AND project=? AND source_key=?').get(...scope,this.sourceKey(source)))return true;
    const q=new Set(terms(statement).map(hash));
    return this.db.prepare('SELECT terms FROM tombstones WHERE principal=? AND character=? AND project=?').all(...scope).some(r=>{const t=new Set(JSON.parse(r.terms));return [...q].filter(x=>t.has(x)).length/Math.max(1,new Set([...q,...t]).size)>=0.86;});
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const v=fn(); this.db.exec('COMMIT'); return v; } catch(e) {this.db.exec('ROLLBACK');throw e;} }
  scope(ctx, action) { const s=this.authorize(ctx, action); if(!s?.principalId||!s.characterId||!s.projectId) throw Error('Missing trusted scope'); return [s.principalId,s.characterId,s.projectId]; }
  remember(ctx, candidate, source) {
    const scope=this.scope(ctx,'write'), statement=validateStatement(candidate.statement);
    this.evidence(ctx,source);
    if(!['semantic','episodic','procedural'].includes(candidate.kind)) throw Error('Invalid memory kind');
    if(!source || typeof source.sessionId!=='string' || !Number.isSafeInteger(source.eventSeq) || source.eventSeq<0) throw Error('Evidence required');
    if(!['direct_user','verified_tool','inference'].includes(source.origin)) throw Error('Untrusted origin');
    const fingerprint=hash(statement), key=`${this.sourceKey(source)}:${fingerprint}`;
    return this.transaction(()=>{
      if(this.blocked(scope,statement,source)) throw Error('Forgotten or superseded content cannot be resurrected');
      const prior=this.db.prepare('SELECT memory_id FROM sources WHERE principal=? AND character=? AND project=? AND source_key=?').get(...scope,key);
      if(prior) return this.get(ctx,prior.memory_id);
      const duplicate=this.db.prepare("SELECT * FROM memories WHERE principal=? AND character=? AND project=? AND fingerprint=? AND status NOT IN ('forgotten','merged')").get(...scope,fingerprint);
      const id=duplicate?.id||randomUUID(), now=new Date().toISOString();
      if(!duplicate){
        const expiry=candidate.expiresAt?new Date(candidate.expiresAt).toISOString():null;
        this.db.prepare('INSERT INTO memories(id,principal,character,project,kind,statement,fingerprint,status,revision,source,created_at,updated_at,confidence,expires_at,claim_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...scope,candidate.kind,statement,fingerprint,source.origin==='inference'?'uncertain':'active',1,JSON.stringify(source),now,now,source.origin==='direct_user'?1:0.5,expiry,typeof candidate.claimKey==='string'?candidate.claimKey.slice(0,120):null);
        if(candidate.claimKey){const conflict=this.db.prepare("SELECT id FROM memories WHERE principal=? AND character=? AND project=? AND claim_key=? AND id!=? AND status IN ('active','uncertain')").get(...scope,candidate.claimKey,id);if(conflict)this.db.prepare("UPDATE memories SET status='uncertain',conflict_with=? WHERE id=?").run(conflict.id,id);}
        this.snapshot(id);
      }
      this.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?)').run(...scope,key,id);
      return this.get(ctx,id);
    });
  }
  get(ctx,id) { const scope=this.scope(ctx,'read'); const row=this.db.prepare('SELECT * FROM memories WHERE id=? AND principal=? AND character=? AND project=?').get(id,...scope); if(!row) throw Error('Memory unavailable'); return row; }
  snapshot(id) { const row=this.db.prepare('SELECT * FROM memories WHERE id=?').get(id); this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(id,row.revision,JSON.stringify(row));this.index(row); }
  correct(ctx,id,statement,revision,source) {
    this.scope(ctx,'write'); statement=validateStatement(statement);
    this.evidence(ctx,source);
    if(!source?.sessionId || !Number.isSafeInteger(source.eventSeq)) throw Error('Correction evidence required');
    return this.transaction(()=>{const old=this.get(ctx,id);if(old.status==='forgotten'||old.revision!==revision)throw Error('Revision conflict');
      const scope=[old.principal,old.character,old.project];
      if(this.blocked(scope,statement,source))throw Error('Blocked content');
      this.db.prepare('INSERT OR IGNORE INTO blocked VALUES(?,?,?,?)').run(...scope,old.fingerprint);
      this.db.prepare('UPDATE memories SET statement=?,fingerprint=?,revision=revision+1,source=?,updated_at=?,status=?,confidence=?,conflict_with=NULL WHERE id=?').run(statement,hash(statement),JSON.stringify(source),new Date().toISOString(),source.origin==='direct_user'?'active':'uncertain',source.origin==='direct_user'?1:0.5,id);this.snapshot(id);return this.get(ctx,id);});
  }
  forget(ctx,id,revision) {
    this.scope(ctx,'write');return this.transaction(()=>{const old=this.get(ctx,id);if(old.revision!==revision)throw Error('Revision conflict');
      this.db.prepare('INSERT OR IGNORE INTO blocked VALUES(?,?,?,?)').run(old.principal,old.character,old.project,old.fingerprint);
      this.db.prepare('INSERT OR IGNORE INTO tombstones VALUES(?,?,?,?,?)').run(old.principal,old.character,old.project,old.fingerprint,JSON.stringify(terms(old.statement).map(hash)));
      for(const r of this.db.prepare('SELECT source_key FROM sources WHERE memory_id=?').all(id))this.db.prepare('INSERT OR IGNORE INTO forgotten_sources VALUES(?,?,?,?)').run(old.principal,old.character,old.project,r.source_key.slice(0,r.source_key.lastIndexOf(':')));
      for(const r of this.db.prepare('SELECT snapshot FROM revisions WHERE id=?').all(id)){const prior=JSON.parse(r.snapshot);const source=JSON.parse(prior.source);this.db.prepare('INSERT OR IGNORE INTO forgotten_sources VALUES(?,?,?,?)').run(old.principal,old.character,old.project,this.sourceKey(source));this.db.prepare('INSERT OR IGNORE INTO blocked VALUES(?,?,?,?)').run(old.principal,old.character,old.project,prior.fingerprint);}
      this.db.prepare("UPDATE memories SET status='forgotten',statement='',revision=revision+1,updated_at=? WHERE id=?").run(new Date().toISOString(),id);this.snapshot(id);return {id,status:'forgotten',revision:revision+1};});
  }
  recall(ctx,query='',budget=2400) {
    const scope=this.scope(ctx,'read');if(typeof query!=='string'||query.length>200)throw Error('Invalid query');
    const tokens=terms(query).slice(0,64),now=new Date().toISOString();
    let rows=tokens.length?this.db.prepare("SELECT m.*,bm25(memory_fts) AS rank FROM memory_fts JOIN memories m ON m.id=memory_fts.id WHERE memory_fts MATCH ? AND principal=? AND character=? AND project=? AND status IN ('active','uncertain') AND (expires_at IS NULL OR expires_at>?) ORDER BY rank LIMIT 200").all(tokens.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR '),...scope,now):this.db.prepare("SELECT * FROM memories WHERE principal=? AND character=? AND project=? AND status IN ('active','uncertain') AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC LIMIT 100").all(...scope,now);
    rows.sort((a,b)=>{const score=r=>(r.statement.includes(query)&&query?2:0)+similarity(query,r.statement)+(r.confidence??0.5)*0.1-(r.rank??0);return score(b)-score(a);});
    const results=[];let used=0;for(const row of rows){const cost=JSON.stringify(row).length;if(used+cost>Math.min(16000,Math.max(0,budget)))continue;results.push(row);used+=cost;if(results.length===20)break;}return results;
  }
  inspect(ctx,id){const row=this.get(ctx,id);return {memory:row,revisions:this.db.prepare('SELECT revision FROM revisions WHERE id=? ORDER BY revision').all(id)};}
  confirm(ctx,id,revision){this.scope(ctx,'write');return this.transaction(()=>{const row=this.get(ctx,id);if(row.revision!==revision||['forgotten','merged'].includes(row.status))throw Error('Revision conflict');this.db.prepare("UPDATE memories SET status='active',confidence=1,conflict_with=NULL,revision=revision+1,updated_at=? WHERE id=?").run(new Date().toISOString(),id);this.snapshot(id);return this.get(ctx,id);});}
  merge(ctx,id,otherId,revision,otherRevision){this.scope(ctx,'write');return this.transaction(()=>{const a=this.get(ctx,id),b=this.get(ctx,otherId);if(id===otherId||a.revision!==revision||b.revision!==otherRevision||[a,b].some(r=>!['active','uncertain'].includes(r.status)))throw Error('Revision conflict');const shape=s=>s.match(/不|没|无|否|never|not|\d+/giu)?.join('|')??'';if(similarity(a.statement,b.statement)<0.92||shape(a.statement)!==shape(b.statement))throw Error('Merge requires near-identical statements; correct explicitly instead');this.db.prepare('UPDATE sources SET memory_id=? WHERE memory_id=?').run(id,otherId);this.db.prepare('INSERT OR IGNORE INTO blocked VALUES(?,?,?,?)').run(b.principal,b.character,b.project,b.fingerprint);this.db.prepare("UPDATE memories SET status='merged',revision=revision+1,updated_at=? WHERE id=?").run(new Date().toISOString(),otherId);this.snapshot(otherId);this.db.prepare('UPDATE memories SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);this.snapshot(id);return this.get(ctx,id);});}
  jobs(ctx){const scope=JSON.stringify(this.scope(ctx,'read'));return this.db.prepare('SELECT id,status,attempts,error,at FROM extraction_jobs WHERE scope=? ORDER BY at DESC LIMIT 30').all(scope);}
  retry(ctx,id){const scope=JSON.stringify(this.scope(ctx,'write'));return {updated:this.db.prepare("UPDATE extraction_jobs SET status='pending',attempts=0,error=NULL WHERE id=? AND scope=? AND status='failed'").run(id,scope).changes===1};}
  enqueue(ctx,evidence){const scope=this.scope(ctx,'write');this.evidence(ctx,evidence);validateStatement(evidence.text,8000);const id=hash(scope.join(':')+this.sourceKey(evidence));this.db.prepare("INSERT OR IGNORE INTO extraction_jobs(id,session,scope,evidence,status,at) VALUES(?,?,?,?,'pending',?)").run(id,ctx.sessionId,JSON.stringify(scope),JSON.stringify(evidence),new Date().toISOString());return id;}
  capture(ctx,sessionId,seq,text) {
    this.scope(ctx,'write'); const cursor=this.db.prepare('SELECT seq FROM capture_cursor WHERE session=?').get(sessionId)?.seq??-1;
    if(seq<=cursor)return {skipped:true};
    // Conservative local extractor: direct stable preference/working convention only. Never consume assistant or recalled text.
    const match=/^(?:我(?:长期|一直)?(?:喜欢|偏好|习惯)|请记住[：:]?|以后请)([^\n]{2,400})[。！!]?$/u.exec(text.trim());
    let result={skipped:true};
    if(match&&!/(?:可能|也许|开玩笑|假如|不喜欢)/u.test(text)) {try{result=this.remember(ctx,{kind:'semantic',statement:text.trim()},{sessionId,eventSeq:seq,origin:'direct_user'});}catch(e){result={rejected:true,reason:e.message};}}
    this.db.prepare('INSERT INTO capture_cursor VALUES(?,?) ON CONFLICT(session) DO UPDATE SET seq=MAX(seq,excluded.seq)').run(sessionId,seq);return result;
  }
  close(){this.db.close();}
}
