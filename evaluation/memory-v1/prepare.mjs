import {corpus,digest} from './score.mjs';
import {EXTRACTION_PROMPT} from '../../packages/character-memory-core/extraction.mjs';
import {CONSOLIDATION_PROMPT} from '../../packages/character-memory-core/personality.mjs';
import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
// Whitelist: rubric answers and scenario labels (distribution such as
// negation/correction/withdraw) name the expected outcome and are withheld.
export function prepare(split){assert(['dev','held'].includes(split));return {datasetDigest:digest,targetHost:'0.2.2-rc.1',split,prompts:{extraction:EXTRACTION_PROMPT,consolidation:CONSOLIDATION_PROMPT},promptDigest:createHash('sha256').update(EXTRACTION_PROMPT+CONSOLIDATION_PROMPT).digest('hex'),cases:corpus.cases.filter(c=>c.split===split).map(({id,language,mode,lifecycle,events})=>({id,language,mode,lifecycle,events})),networkCalls:0,qualityEvaluated:false};}
if(process.argv[1]?.endsWith('prepare.mjs'))console.log(JSON.stringify(prepare(process.argv[2]??'dev'),null,2));
