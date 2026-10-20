const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {DatabaseSync,backup}=require('node:sqlite');

// Run only while the Host is stopped. Validate the old own-plugin runtime on
// a consistent COPY; never open the live database with downgraded code.
module.exports=async function verifyMemoryRollback({database,previousCore,output}){
 if(!fs.existsSync(database))throw Error('Current memory database missing');
 if(fs.existsSync(output))throw Error('Rollback validation output already exists');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 const protectedTables=['memories','revisions','blocked','tombstones','forgotten_sources','experiences','memory_evidence','memory_lanes'];
 const digest=db=>require('node:crypto').createHash('sha256').update(JSON.stringify(protectedTables.map(table=>[table,db.prepare('SELECT * FROM '+table).all().map(row=>JSON.stringify(row)).sort()]))).digest('hex');
 const live=new DatabaseSync(database,{readOnly:true});let schema,count,content;
 try{schema=live.prepare('SELECT max(version) version FROM schema_version').get().version;count=live.prepare('SELECT count(*) n FROM memories').get().n;content=digest(live);await backup(live,output);}finally{live.close();}
 const {LayeredMemory}=await import(pathToFileURL(path.resolve(previousCore,'layered.mjs')).href);
 let probe;try{probe=new LayeredMemory(output,()=>{throw Error('No authority in rollback probe');});
  if(probe.db.prepare('SELECT max(version) version FROM schema_version').get().version!==schema||digest(probe.db)!==content)throw Error('Old runtime changed memory schema, records or governance barriers; automatic rollback refused');
 }finally{probe?.close();}
 return {schema,records:count,verifiedCopy:output,memoryAction:'preserve-current'};
};
