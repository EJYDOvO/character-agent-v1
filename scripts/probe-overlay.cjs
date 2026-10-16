const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..').replaceAll('\\','/');
fs.writeFileSync(root+'/test-data/probe.patch.yml',JSON.stringify([{insert:[{id:'character-test-probe',name:root+'/tests/host-probe.mjs',config:{cwd:root,result:root+'/artifacts/host-probe.json'}}]}],null,2));
