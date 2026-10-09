// Real retrieved provider artifacts; isolated portal database and transport.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
const dir=await fs.mkdtemp(tmpdir()+'/pd-delivery-'),base='http://127.0.0.1:3246';
const token=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex');
const child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,PORT:'3246',APP_ORIGIN:base,DATA_DIR:dir,WORKER_TOKEN:token,ADMIN_TOKEN:admin},stdio:['ignore','pipe','pipe']});
let logs='';child.stderr.on('data',b=>logs+=b);const worker={Authorization:'Bearer '+token};
const call=(route,body,headers={})=>fetch(base+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
const artifacts=process.argv[2]||'work/paperdesk-integration-real';
try{
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base)).ok;}catch{}if(ready)break;if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}assert.ok(ready,logs);
 const r=await call('register',{email:'owner@paperdesk.test',password:randomBytes(16).toString('hex')});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];const customer={Cookie:cookie};
 const code=await (await call('admin/codes',{count:1,credits:3},{Authorization:'Bearer '+admin})).json();assert.equal((await call('redeem',{code:code.codes[0]},customer)).status,200);
 const result=JSON.parse(await fs.readFile(artifacts+'/paperdesk-result.json','utf8')).result;const ai=JSON.parse(await fs.readFile(artifacts+'/scores.json','utf8')).aiScore;
 const input=await fs.readFile(artifacts+'/pd-integration-20261007.pdf');
 async function submit(){await call('worker/claim',{},worker);const f=new FormData();f.append('file',new Blob([input]),'real-paper.pdf');f.append('requestId',randomUUID());const r=await fetch(base+'/api/jobs',{method:'POST',headers:{Origin:base,Cookie:cookie},body:f});assert.equal(r.status,200);const {job}=await (await call('worker/claim',{},worker)).json();return job;}
 async function deliver(job,kinds){const h={...worker,'X-Job-Lease':job.lease};for(const kind of kinds){const bytes=await fs.readFile(artifacts+'/'+(kind==='ai'?'ai-report':kind==='similarity'?'similarity-report':kind)+'.pdf');const r=await fetch(base+'/api/worker/artifact/'+job.id+'/'+kind,{method:'POST',headers:{...h,'Content-Type':'application/pdf'},body:bytes});assert.equal(r.status,200);}assert.equal((await call('worker/evidence/'+job.id,result,h)).status,200);return h;}
 const first=await submit(),h=await deliver(first,['similarity','similarity-restyled']);
 assert.equal((await call('worker/complete-paperdesk/'+first.id,{similarityScore:result.similarity,aiScore:ai},h)).status,409,'AI files are mandatory for a joint completion');
 assert.equal((await call('worker/complete-paperdesk/'+first.id,{similarityScore:-1,aiScore:ai},h)).status,400);
 await deliver(first,['ai','ai-restyled','restyled']);
 for(let i=0;i<2;i++)assert.equal((await call('worker/complete-paperdesk/'+first.id,{similarityScore:result.similarity,aiScore:ai},h)).status,200);
 let state=await (await call('state',undefined,customer)).json();assert.equal(state.balance,2);assert.equal(state.jobs[0].status,'completed');assert.equal(JSON.parse(state.jobs[0].report_sources).similarity,'PaperDesk');assert.equal(JSON.parse(state.jobs[0].report_sources).ai,'ACADEMI.CX');
 assert.equal((await call('evidence/'+first.id)).status,401);assert.equal((await call('evidence/'+first.id,undefined,customer)).status,200);
 const other=await call('register',{email:'other@paperdesk.test',password:randomBytes(16).toString('hex')});const otherCookie={Cookie:other.headers.get('set-cookie').split(';')[0]};assert.equal((await call('evidence/'+first.id,undefined,otherCookie)).status,404);assert.equal((await call('report/'+first.id+'/similarity-restyled',undefined,otherCookie)).status,404);
 const downloaded=Buffer.from(await (await call('report/'+first.id+'/similarity-restyled',undefined,customer)).arrayBuffer());assert.deepEqual(downloaded,await fs.readFile(artifacts+'/similarity-restyled.pdf'));
 const second=await submit(),h2=await deliver(second,['similarity','similarity-restyled']);assert.equal((await call('worker/partial-paperdesk/'+second.id,{similarityScore:result.similarity},h2)).status,200);for(let i=0;i<2;i++)assert.equal((await call('worker/fail/'+second.id,{reason:'upstream'},h2)).status,200);state=await (await call('state',undefined,customer)).json();assert.equal(state.balance,2,'AI failure refunds exactly once');assert.equal((await call('report/'+second.id+'/similarity',undefined,customer)).status,200,'Successful similarity remains downloadable after AI fails');
 const third=await submit(),h3=await deliver(third,['similarity','similarity-restyled']);assert.equal((await call('worker/complete-paperdesk/'+third.id,{similarityScore:result.similarity,aiScore:null,aiSkippedReason:'chinese'},h3)).status,200);state=await (await call('state',undefined,customer)).json();assert.equal(state.balance,1);assert.equal(state.jobs[0].ai_score,null);
 console.log('PASS: real-artifact delivery, provider attribution, incomplete-result refusal, private evidence, debit once, refund once, similarity-only and preserved successful reports');
}finally{if(child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}await fs.rm(dir,{recursive:true,force:true});}
