import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const hash = text => createHash('sha256').update(text.normalize('NFKC').trim()).digest('hex');
export function validateStatement(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw Error('Invalid memory size');
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
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const v=fn(); this.db.exec('COMMIT'); return v; } catch(e) {this.db.exec('ROLLBACK');throw e;} }
  scope(ctx, action) { const s=this.authorize(ctx, action); if(!s?.principalId||!s.characterId||!s.projectId) throw Error('Missing trusted scope'); return [s.principalId,s.characterId,s.projectId]; }
  remember(ctx, candidate, source) {
    const scope=this.scope(ctx,'write'), statement=validateStatement(candidate.statement);
    if(!['semantic','episodic','procedural'].includes(candidate.kind)) throw Error('Invalid memory kind');
    if(!source || typeof source.sessionId!=='string' || !Number.isSafeInteger(source.eventSeq) || source.eventSeq<0) throw Error('Evidence required');
    if(!['direct_user','verified_tool','inference'].includes(source.origin)) throw Error('Untrusted origin');
    const fingerprint=hash(statement), key=`${source.sessionId}:${source.eventSeq}:${fingerprint}`;
    return this.transaction(()=>{
      if(this.db.prepare('SELECT 1 FROM blocked WHERE principal=? AND character=? AND project=? AND fingerprint=?').get(...scope,fingerprint)) throw Error('Forgotten or superseded content cannot be resurrected');
      const prior=this.db.prepare('SELECT memory_id FROM sources WHERE principal=? AND character=? AND project=? AND source_key=?').get(...scope,key);
      if(prior) return this.get(ctx,prior.memory_id);
      const duplicate=this.db.prepare("SELECT * FROM memories WHERE principal=? AND character=? AND project=? AND fingerprint=? AND status != 'forgotten'").get(...scope,fingerprint);
      const id=duplicate?.id||randomUUID(), now=new Date().toISOString();
      if(!duplicate){
        this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...scope,candidate.kind,statement,fingerprint,source.origin==='inference'?'uncertain':'active',1,JSON.stringify(source),now,now);
        this.snapshot(id);
      }
      this.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?)').run(...scope,key,id);
      return this.get(ctx,id);
    });
  }
  get(ctx,id) { const scope=this.scope(ctx,'read'); const row=this.db.prepare('SELECT * FROM memories WHERE id=? AND principal=? AND character=? AND project=?').get(id,...scope); if(!row) throw Error('Memory unavailable'); return row; }
  snapshot(id) { const row=this.db.prepare('SELECT * FROM memories WHERE id=?').get(id); this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(id,row.revision,JSON.stringify(row)); }
  correct(ctx,id,statement,revision,source) {
    this.scope(ctx,'write'); statement=validateStatement(statement);
    if(!source?.sessionId || !Number.isSafeInteger(source.eventSeq)) throw Error('Correction evidence required');
    return this.transaction(()=>{const old=this.get(ctx,id);if(old.status==='forgotten'||old.revision!==revision)throw Error('Revision conflict');
      const scope=[old.principal,old.character,old.project];
      if(this.db.prepare('SELECT 1 FROM blocked WHERE principal=? AND character=? AND project=? AND fingerprint=?').get(...scope,hash(statement)))throw Error('Blocked content');
      this.db.prepare('INSERT OR IGNORE INTO blocked VALUES(?,?,?,?)').run(...scope,old.fingerprint);
      this.db.prepare('UPDATE memories SET statement=?,fingerprint=?,revision=revision+1,source=?,updated_at=?,status=? WHERE id=?').run(statement,hash(statement),JSON.stringify(source),new Date().toISOString(),source.origin==='direct_user'?'active':'uncertain',id);this.snapshot(id);return this.get(ctx,id);});
  }
  forget(ctx,id,revision) {
    this.scope(ctx,'write');return this.transaction(()=>{const old=this.get(ctx,id);if(old.revision!==revision)throw Error('Revision conflict');
      this.db.prepare('INSERT OR IGNORE INTO blocked VALUES(?,?,?,?)').run(old.principal,old.character,old.project,old.fingerprint);
      this.db.prepare("UPDATE memories SET status='forgotten',statement='',revision=revision+1,updated_at=? WHERE id=?").run(new Date().toISOString(),id);this.snapshot(id);return {id,status:'forgotten',revision:revision+1};});
  }
  recall(ctx,query='',budget=2400) {
    const scope=this.scope(ctx,'read');if(typeof query!=='string'||query.length>200)throw Error('Invalid query');
    const rows=this.db.prepare("SELECT * FROM memories WHERE principal=? AND character=? AND project=? AND status IN ('active','uncertain') ORDER BY updated_at DESC LIMIT 500").all(...scope);
    const terms=query.toLocaleLowerCase().split(/\s+/u).filter(Boolean), results=[];let used=0;
    for(const row of rows){if(terms.length&&!terms.every(t=>row.statement.toLocaleLowerCase().includes(t)))continue;const cost=row.statement.length+200;if(used+cost>Math.min(8000,Math.max(0,budget)))continue;results.push(row);used+=cost;if(results.length===20)break;}return results;
  }
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
