// Copy-first migration. Source is opened read-only; destination must not exist.
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/migrate-memory.mjs <source.sqlite> <new-destination.sqlite>');
const source=resolve(input),destination=resolve(output);
if(source.toLowerCase()===destination.toLowerCase()||existsSync(destination))throw Error('Destination must be a new file');
mkdirSync(dirname(destination),{recursive:true});
const original=new DatabaseSync(source,{readOnly:true});
let version,counts;
try{
 version=original.prepare('SELECT MAX(version) n FROM schema_version').get().n;
 if(![1,2,3].includes(version))throw Error('Unsupported source schema');
 counts=original.prepare('SELECT count(*) n FROM memories').get().n;
 await backup(original,destination);
}finally{original.close();}
const migrated=new LayeredMemory(destination,()=>{throw Error('Migration cannot issue Agent privileges');});
try{
 if(migrated.db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Migration integrity failure');
 if(migrated.db.prepare('SELECT count(*) n FROM memories').get().n!==counts)throw Error('Memory count changed');
 migrated.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}finally{migrated.close();}
const result={ok:true,from:version,to:3,memories:counts,sourceUnmodified:true,productionActivated:false};
writeFileSync(destination+'.migration.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
