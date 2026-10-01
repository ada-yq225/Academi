import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir=await mkdtemp(tmpdir()+'/utad-resume-');
const hash=s=>createHash('sha256').update(s).digest('hex');
try{
 const input=dir+'/test.txt',report=dir+'/similarity-report.pdf';
 await writeFile(input,'synthetic test input');await writeFile(report,'%PDF-synthetic test');
 const receipt={inputSha256:hash('synthetic test input'),title:'PaperDesk-test',state:'validated',reportSha256:hash('%PDF-synthetic test')};
 await writeFile(dir+'/utad-submission.json',JSON.stringify(receipt));
 const run=()=>spawnSync(process.execPath,['worker/utad.cjs',input],{encoding:'utf8',env:{...process.env,SIMILARITY_PROVIDER:'utad',UTAD_DEFAULT_POLICY_ACCEPTED:'true',FALLBACK_TURNITIN_USERNAME:'test',FALLBACK_TURNITIN_PASSWORD:'test',RESULT_DIR:dir}});
 let r=run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/without another submission/);
 await writeFile(report,'%PDF-changed');r=run();assert.notEqual(r.status,0);assert.match(r.stderr,/Cached UTAD report changed/);
 await writeFile(input,'different original');r=run();assert.notEqual(r.status,0);assert.match(r.stderr,/receipt\/input mismatch/);
 console.log('PASS: cached result reused; changed report and changed input rejected before browser launch');
}finally{await rm(dir,{recursive:true,force:true})}
