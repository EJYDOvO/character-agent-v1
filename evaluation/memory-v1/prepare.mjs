import {corpus,digest} from './score.mjs';
import {EXTRACTION_PROMPT} from '../../packages/character-memory-core/extraction.mjs';
import {CONSOLIDATION_PROMPT} from '../../packages/character-memory-core/personality.mjs';
import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
export function prepare(split){assert(['dev','held'].includes(split));return {datasetDigest:digest,targetHost:'0.2.2-rc.1',split,prompts:{extraction:EXTRACTION_PROMPT,consolidation:CONSOLIDATION_PROMPT},promptDigest:createHash('sha256').update(EXTRACTION_PROMPT+CONSOLIDATION_PROMPT).digest('hex'),cases:corpus.cases.filter(c=>c.split===split).map(({rubric,...input})=>input),networkCalls:0,qualityEvaluated:false};}
if(process.argv[1]?.endsWith('prepare.mjs'))console.log(JSON.stringify(prepare(process.argv[2]??'dev'),null,2));
