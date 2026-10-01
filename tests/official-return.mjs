import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {officialReturn,digest,assertNoRepository} from '../worker/official-return.mjs';
const dir=await mkdtemp(tmpdir()+'/official-binding-');
try{
 const input=dir+'/input.docx';await writeFile(input,'original');
 await writeFile(dir+'/ai-report.pdf','AI');await writeFile(dir+'/similarity-report.pdf','report');
 const manifest={jobId:'job-a',provider:'Turnitin',submissionId:'trn:oid:::1:123',similarityScore:62,inputSha256:digest('original'),aiSha256:digest('AI'),reportSha256:digest('report')};
 await writeFile(dir+'/official-return.json',JSON.stringify(manifest));
 assert.ok(await officialReturn(dir,input,'job-a'));
 await assert.rejects(officialReturn(dir,input,'job-b'),/match/);
 await writeFile(dir+'/similarity-report.pdf','wrong report');
 await assert.rejects(officialReturn(dir,input,'job-a'),/hash/);
 const evidence={assignmentId:'191343333',persisted:true,repository:'Do not store the submitted papers',checkedAt:100000};
 assert.doesNotThrow(()=>assertNoRepository(evidence,'191343333',100001));
 for(const bad of [null,{...evidence,persisted:false},{...evidence,repository:'Standard paper repository'},{...evidence,checkedAt:1},{...evidence,assignmentId:'other'}])assert.throws(()=>assertNoRepository(bad,'191343333',100001),/blocked/);
 console.log('PASS: wrong job, altered report, stale settings and standard repository rejected');
}finally{await rm(dir,{recursive:true,force:true})}
