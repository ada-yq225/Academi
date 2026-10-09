import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePaperdesk} from '../server/paperdesk-completion.mjs';
import {aiEligibility} from '../worker/paperdesk.mjs';
const result={similarity:41,status:'partial',coverage:{readableSources:3}};
test('Independent completion preserves scores, attributes both sources and reports limited coverage',()=>{
 const x=validatePaperdesk({similarityScore:41,aiScore:17},result);
 assert.equal(x.sources.ai,'ACADEMI.CX');assert.equal(x.sources.similarity,'PaperDesk');assert.match(x.message,/部分公开来源/);
 assert.throws(()=>validatePaperdesk({similarityScore:0,aiScore:17},result));
 assert.throws(()=>validatePaperdesk({similarityScore:41,aiScore:null},result));
});
test('No accessible corpus cannot be passed off as zero similarity',()=>{
 assert.throws(()=>validatePaperdesk({similarityScore:0,aiScore:0},{similarity:0,status:'unavailable',coverage:{readableSources:0}}));
 assert.throws(()=>validatePaperdesk({similarityScore:null,aiScore:0},{similarity:null,status:'unavailable',coverage:{readableSources:0}}));
});
test('Chinese and out-of-range documents skip only AI and retain independent completion',()=>{
 for(const [text,reason] of [['中文测试文稿。'.repeat(100),'chinese'],['English short text.','word-minimum'],['word '.repeat(29501),'word-limit']]){
  assert.equal(aiEligibility(text).reason,reason);const x=validatePaperdesk({similarityScore:41,aiScore:null,aiSkippedReason:reason},result);assert.equal(x.sources.ai,null);
 }
 assert.equal(aiEligibility('word '.repeat(350)).aiEligible,true);assert.equal(aiEligibility('word '.repeat(29500)).aiEligible,true);
});
