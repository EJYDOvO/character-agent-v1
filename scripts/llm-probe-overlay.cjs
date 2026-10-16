// Opt-in isolated real provider test. Copies only the host LLM configuration; never QQ credentials.
const fs=require('fs'),path=require('path');const project=path.resolve(__dirname,'..'),root=require('./installation.cjs').install;
const yaml=require(require.resolve('js-yaml',{paths:[root+'/data/profiles/desktop']}));
const live=yaml.load(fs.readFileSync(root+'/data/profiles/desktop/cordis.patch.yml','utf8'));
const file=project+'/test-data/home/profiles/character-test/cordis.patch.yml';const rows=yaml.load(fs.readFileSync(file,'utf8'));
rows.find(x=>x.id==='character-memory-core').config.diagnosticFile=project+'/artifacts/extraction-error.private.log';
for(const id of ['agent-default-model','llm-pi-ai']){const row=live.find(x=>x.id===id);if(!row)throw Error('Missing host LLM route');rows.push(row);}
fs.writeFileSync(file,yaml.dump(rows));
const credentialLine=fs.readFileSync(root+'/data/.env','utf8').split(/\r?\n/).find(line=>/^NAVIGATOR_API_KEY=/.test(line));if(!credentialLine)throw Error('Configured provider credential unavailable');fs.writeFileSync(project+'/test-data/home/.env',credentialLine+'\n');
fs.writeFileSync(project+'/test-data/probe.patch.yml',JSON.stringify([{insert:[{id:'character-test-probe',name:project.replaceAll('\\','/')+'/tests/llm-host-probe.mjs',config:{cwd:project,result:project+'/artifacts/llm-host-probe.json'}}]}]));
console.log('Isolated LLM configuration staged privately; QQ remains disabled.');
