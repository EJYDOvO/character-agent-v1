// Read the selected official host without modifying it. Runtime selection is
// separate from the production data/configuration root for isolated upgrades.
const fs=require('node:fs'),path=require('node:path');
const runtimeRoot=process.env.DSH_CHARACTER_HOST_ROOT||require('./installation.cjs').install;
if(!path.isAbsolute(runtimeRoot))throw Error('DSH_CHARACTER_HOST_ROOT must be absolute');
function openArchive(){
 const archive=path.join(runtimeRoot,'resources/app.asar'),fd=fs.openSync(archive,'r');
 try{
  const prefix=Buffer.alloc(16);fs.readSync(fd,prefix,0,16,0);
  const bytes=Buffer.alloc(prefix.readUInt32LE(12));fs.readSync(fd,bytes,0,bytes.length,16);
  const tree=JSON.parse(bytes),base=8+prefix.readUInt32LE(4);
  return {tree,read(name){
   let entry=tree;for(const part of name.split('/'))entry=entry.files?.[part];
   if(!entry||entry.files)throw Error('Missing official host file: '+name);
   if(entry.unpacked)return fs.readFileSync(archive+'.unpacked/'+name,'utf8');
   const content=Buffer.alloc(entry.size);fs.readSync(fd,content,0,content.length,base+Number(entry.offset));return content.toString('utf8');
  },close:()=>fs.closeSync(fd)};
 }catch(e){fs.closeSync(fd);throw e;}
}
module.exports={openArchive,runtimeRoot};
