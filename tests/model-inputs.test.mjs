import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {apply,fromArgs}=createRequire(import.meta.url)('../scripts/model-inputs.cjs');
const fixture=()=>[{id:'llm-pi-ai',config:{providers:{synthetic:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'SYNTHETIC_UNUSED',models:[{id:'vision',maxTokens:1024},{id:'text-only',input:['text']}]}}}},{id:'other',config:{untouched:true}}];
const declaration={provider:'synthetic',model:'vision',input:['text','image']};
test('candidate uses native per-model input metadata without touching credentials, other models or original Profile',()=>{
 const rows=fixture(),copy=structuredClone(rows),next=apply(rows,[declaration]);assert.deepEqual(rows,copy);
 assert.deepEqual(next[0].config.providers.synthetic.models[0],{id:'vision',maxTokens:1024,input:['text','image']});
 assert.deepEqual(next[0].config.providers.synthetic.models[1],rows[0].config.providers.synthetic.models[1]);
 assert.equal(next[0].config.providers.synthetic.apiKeyEnv,'SYNTHETIC_UNUSED');assert.deepEqual(next[1],rows[1]);
 assert.equal(next[0].config.providers.synthetic.modelOverrides,undefined);
});
test('unknown routes, duplicate declarations, malformed capabilities and conflicting native config fail closed',()=>{
 for(const entries of [[],[declaration,declaration],[{...declaration,model:'missing'}],[{...declaration,provider:'missing'}],[{...declaration,input:['image']}],[{...declaration,input:['text','audio']}],[{...declaration,apiKey:'forbidden'}]])assert.throws(()=>apply(fixture(),entries));
 const rows=fixture();rows[0].config.providers.synthetic.modelOverrides={vision:{input:['image']}};assert.throws(()=>apply(rows,[declaration]),/modelOverrides/);
 assert.throws(()=>fromArgs(fixture(),['--model-inputs=x','--model-inputs=y']));assert.throws(()=>fromArgs(fixture(),['--model-inputs=x'],()=>'{bad-json'));
 assert.throws(()=>fromArgs(fixture(),['--model-inputs','reviewed.json']),/model-inputs=/);
});
test('staging remains opt-in and an unreadable reviewed declaration cannot silently succeed',()=>{
 const rows=fixture();assert.equal(fromArgs(rows,[]),rows);
 assert.deepEqual(fromArgs(rows,['--model-inputs=reviewed.json'],()=>JSON.stringify([declaration])),apply(rows,[declaration]));
 assert.throws(()=>fromArgs(rows,['--model-inputs=missing'],()=>{throw Error('unreadable');}),/unreadable/);
});
