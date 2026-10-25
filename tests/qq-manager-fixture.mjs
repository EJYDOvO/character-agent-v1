// Synthetic Host admission contract for probes which don't exercise QQTK itself.
// The lifecycle probe separately uses the actual patched SessionManager.
export function managerFixture(){
 return {sessions:new Map(),sessionKey:(scope,peer)=>scope+':'+peer,
  currentSessionId(){return this.record?.sessionId;},
  isCurrentSession(record){return record===this.record&&this.sessions.get(record.sessionKey)===record;},
  commit(record){record.sessionKey=this.sessionKey(record.scope,record.peerId);this.record=record;this.sessions.set(record.sessionKey,record);return record;},
  async getOrCreate(){return this.record;}};
}
