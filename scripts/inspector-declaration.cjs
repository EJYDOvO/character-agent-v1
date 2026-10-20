// Ordinary plugin installation and Bundle declaration are separate operations.
module.exports=function enableInspector(profile,bundle=[]){
 const entries=rows=>rows.flatMap(row=>Array.isArray(row.insert)?row.insert:[row]);
 const isInspector=row=>row.name==='dsh-memory-inspector'||row.id==='memory-inspector';
 const local=entries(profile).filter(isInspector),bundled=entries(bundle).filter(isInspector);
 if(local.length>1||bundled.length>1||local.some(r=>r.name)&&bundled.length)throw Error('Duplicate Inspector declarations; choose one assembly source');
 if(local.length){local[0].disabled=false;local[0].config={...local[0].config,enabled:true,writable:false};return;}
 if(bundled.length){profile.push({id:bundled[0].id,disabled:false,config:{enabled:true,writable:false}});return;}
 profile.push({insert:[{id:'memory-inspector',name:'dsh-memory-inspector',config:{enabled:true,writable:false}}]});
};
