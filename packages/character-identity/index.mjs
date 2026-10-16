import { Identity } from './identity.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
export const name='character-identity';
export function apply(ctx,config) {
  const binding=JSON.parse(readFileSync(config.bindingFile,'utf8').replace(/^\uFEFF/,''));
  const identity=new Identity(binding);mkdirSync(dirname(config.stateFile),{recursive:true});
  const db=new DatabaseSync(config.stateFile);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS routes(conversation TEXT PRIMARY KEY,session TEXT NOT NULL,generation INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,conversation TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL);`);
  db.prepare("UPDATE outbox SET status='unknown' WHERE status='sending'").run();
  let runtime;
  const service={identity,authorize:(c,a)=>identity.authorize(c,a),forSession:id=>identity.forSession(id),
    attach(value){
      if(runtime)throw Error('Duplicate Character QQ gateway');
      if(value.config.appId!==binding.appId || value.config.access?.c2cMode!=='allowlist'||value.config.access.c2cAllow.length!==1||value.config.access.c2cAllow[0]!==binding.ownerId||value.config.access.groupMode!=='disabled')throw Error('Owner gateway policy mismatch');
      runtime=value;const original=value.manager.getOrCreate.bind(value.manager);
      value.manager.getOrCreate=async(scope,peerId,senderId,target)=>{
        if(scope!=='c2c'||peerId!==binding.ownerId||senderId!==binding.ownerId)throw Error('Owner-only gateway');
        const record=await original(scope,peerId,senderId,target);
        const trusted=identity.bind({appId:binding.appId,scope,peerId,senderId,sessionId:record.sessionId});
        db.prepare('INSERT INTO routes VALUES(?,?,1) ON CONFLICT(conversation) DO UPDATE SET generation=generation+CASE WHEN session!=excluded.session THEN 1 ELSE 0 END,session=excluded.session').run(trusted.conversationId,record.sessionId);
        return record;
      };
    },
    async notify(trusted,{eventId,kind,text}){
      identity.authorize(trusted,'send');
      if(!['scheduled_reminder','task_completed','task_failed','task_timeout','maintenance_result','configured_alert'].includes(kind)||!eventId||typeof text!=='string'||text.length>3000)throw Error('Invalid explicit event');
      if(!runtime)throw Error('Gateway unavailable');
      const prior=db.prepare('SELECT status FROM outbox WHERE id=?').get(eventId);if(prior)return prior;
      db.prepare('INSERT INTO outbox VALUES(?,?,?,?,?,?)').run(eventId,kind,trusted.conversationId,text,'pending',new Date().toISOString());
      db.prepare("UPDATE outbox SET status='sending' WHERE id=?").run(eventId);
      try{await runtime.sender.sendMarkdown({scope:'c2c',targetId:binding.ownerId},text);db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(eventId);}catch{db.prepare("UPDATE outbox SET status='unknown' WHERE id=?").run(eventId);}
      return db.prepare('SELECT status FROM outbox WHERE id=?').get(eventId);
    },
    cancel(eventId){return db.prepare("UPDATE outbox SET status='cancelled' WHERE id=? AND status='pending'").run(eventId).changes===1;}
  };
  ctx.provide('characterIdentity',service);ctx.effect(()=>()=>{runtime=undefined;db.close();});
}
