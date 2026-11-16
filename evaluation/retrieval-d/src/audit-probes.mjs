// Empirical probes behind TECH_AUDIT.md §1. Synthetic data only; real LayeredMemory code.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';
import {LayeredMemory} from '../../../packages/character-memory-core/layered.mjs';
import {recallTerms,relevance} from '../../../packages/character-memory-core/store.mjs';
import {tokenizeText} from '../../../packages/character-memory-core/tokenize.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retrieval-d-probe-')),issued=new WeakMap();
const scope={principalId:'p',namespaceId:'n',projectId:'j',agentId:'a',memoryMode:'off'};
const bind=id=>{const h={sessionId:id};issued.set(h,scope);return h;};
const store=new LayeredMemory(path.join(dir,'m.sqlite'),h=>{assert(issued.has(h));return issued.get(h);});
const ctx=bind('s1');let seq=0;const ids={};
const add=(label,statement)=>{ids[label]=store.remember(ctx,{kind:'semantic',statement},{sessionId:'s1',eventSeq:++seq,messageId:'m'+seq,origin:'direct_user',text:statement}).id;};
add('deploy','部署前保留回滚点，先在隔离环境验证，再检查健康状态。');
add('hike','周末通常选择徒步，工作日优先完成测试。');
add('bike','The office commute is by bicycle on weekdays.');
add('repeat','回滚 回滚 回滚 回滚 回滚 是一个被重复很多次的词。');
add('coffee','用户早上习惯喝一杯不加糖的美式咖啡。');
add('filler1','我觉得这个的确是可以的，我们之后再说吧。');
add('filler2','你说的那个东西我是知道的，但是现在还不行。');
add('rollback-en','Keep a rollback snapshot before every production deploy.');
const out={};
// P1: stored FTS tokens are de-duplicated => term frequency is always 1.
out.p1_tokensOfRepeat=store.db.prepare('SELECT tokens FROM memory_fts WHERE id=?').get(ids.repeat).tokens.split(' ').filter(t=>t==='回滚').length;
// P2: 64-term cap on a long single-run CJK query keeps unigrams, drops bigrams.
const long='我想知道上次我们讨论过的那个关于生产环境部署之前需要做的准备工作里面有没有提到回滚点还有隔离环境验证这些步骤';
const t=recallTerms(long),all=[...new Set(tokenizeText(long.normalize('NFKC').toLowerCase()))];
out.p2={chars:[...long].length,uniqueTokens:all.length,kept:t.length,keptUnigrams:t.filter(x=>[...x].length===1).length,keptBigrams:t.filter(x=>[...x].length===2).length,hasBigram_回滚:t.includes('回滚'),hasBigram_隔离:t.includes('隔离')};
// P3: conversational query candidates: every memory sharing any single character matches.
const rank=q=>store.recall(ctx,q,16000).map(r=>Object.keys(ids).find(k=>ids[k]===r.id));
out.p3_conversational={query:'我之前说过部署之前要做什么来着',ranking:rank('我之前说过部署之前要做什么来着')};
out.p3_keyword={query:'部署 回滚点',ranking:rank('部署 回滚点')};
// P4: no stemming / no synonymy / no cross-lingual bridge.
out.p4={bicycles:rank('bicycles'),cycling:rank('cycling'),'远足':rank('远足'),'回滚快照(zh->en)':rank('回滚快照'),'rollback snapshot(en->zh)':rank('rollback snapshot'),'黑咖啡':rank('黑咖啡')};
// P5: score scale. substring bonus (+2) vs -bm25 in a tiny corpus.
const rows=store.db.prepare("SELECT m.statement,m.confidence,bm25(memory_fts) rank FROM memory_fts JOIN memories m ON m.id=memory_fts.id WHERE memory_fts MATCH ? ORDER BY rank").all(recallTerms('回滚点').map(x=>'"'+x+'"').join(' OR '));
out.p5=rows.map(r=>({s:r.statement.slice(0,18),bm25:+r.rank.toFixed(4),relevance:+relevance(r,'回滚点').toFixed(4)}));
// P6: single shared character is enough to become a candidate.
out.p6_singleCharOverlap={query:'足球',ranking:rank('足球')};
console.log(JSON.stringify(out,null,1));
store.close();fs.rmSync(dir,{recursive:true,force:true});
