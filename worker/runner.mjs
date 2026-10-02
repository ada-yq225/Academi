import fs from 'node:fs/promises';
import {configuredAccounts,accountForJob} from './academi-accounts.mjs';
import {officialReturn, digest} from './official-return.mjs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const home=path.dirname(fileURLToPath(import.meta.url));
const base=process.env.PORTAL_URL,token=process.env.WORKER_TOKEN,root=path.resolve(process.env.WORKER_DATA||'worker-data');
if(!base||!token||!process.env.ACADEMI_EMAIL||!process.env.ACADEMI_PASSWORD)throw Error('Set PORTAL_URL, WORKER_TOKEN, ACADEMI_EMAIL, ACADEMI_PASSWORD');
const academiAccounts=configuredAccounts();
await fs.mkdir(root,{recursive:true,mode:0o700});
const state=path.join(root,'active.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body={},job){let last;for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(base+'/api/worker/'+route,{method:body===null?'GET':'POST',headers:{Authorization:'Bearer '+token,...(job?{'X-Job-Lease':job.lease}:{}),...(body instanceof Uint8Array?{'Content-Type':'application/pdf'}:{'Content-Type':'application/json'})},body:body===null?undefined:body instanceof Uint8Array?body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!r.ok){const error=Error('Portal '+r.status+' '+await r.text());error.retryable=r.status>=500;throw error}return r}catch(e){last=e;if(route==='claim'||e.retryable===false||attempt===2)throw e;await sleep(2000*(attempt+1))}}throw last}

function run(command,args,env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','inherit','pipe']});let detail='';child.stderr.on('data',data=>{process.stderr.write(data);detail=(detail+data.toString()).slice(-4000)});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(detail.trim()||'Process exited '+code)))})}
async function academiCredentials(dir){const a=await accountForJob(root,dir,academiAccounts);return {ACADEMI_EMAIL:a.email,ACADEMI_PASSWORD:a.password}}
let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
while(!stopping){let job;try{try{job=JSON.parse(await fs.readFile(state,'utf8'))}catch{job=(await(await api('claim')).json()).job}if(!job){await sleep(15000);continue}if(job.started){const current=await(await api('status/'+job.id,null,job)).json();if(['completed','failed'].includes(current.status)){await fs.unlink(state);if(current.status==='completed'&&!await fs.stat(path.join(root,job.id,'official-return.json')).catch(()=>null)&&!await fs.stat(path.join(root,job.id,'utad-submission.json')).catch(()=>null))await fs.rm(path.join(root,job.id),{recursive:true,force:true});continue}}const dir=path.join(root,job.id);await fs.mkdir(dir,{recursive:true,mode:0o700});const filename=job.id+path.extname(job.input_key),input=path.join(dir,filename);if(!job.started){await fs.writeFile(input,Buffer.from(await(await api('input/'+job.id,null,job)).arrayBuffer()));await fs.writeFile(state,JSON.stringify({...job,started:true}),{mode:0o600})}
 await fs.rm(path.join(dir,'failure.json'),{force:true});
 await fs.writeFile(path.join(dir,'job.json.tmp'),JSON.stringify({id:job.id,filename:job.filename}),{mode:0o600});
 await fs.rename(path.join(dir,'job.json.tmp'),path.join(dir,'job.json'));
 const heartbeat=setInterval(()=>api('heartbeat/'+job.id,{},job).catch(e=>console.error(e.message)),20000);
 try{let imported=await officialReturn(dir,input,job.id),similarityOnly=false,similarityReason='word-limit';if(!imported&&process.env.SIMILARITY_PROVIDER==='utad'){
   await run(process.env.PYTHON_BIN||'python3',[path.join(home,'check_ai_word_limit.py'),input,path.join(dir,'ai-preflight.json')],{});
   const preflight=JSON.parse(await fs.readFile(path.join(dir,'ai-preflight.json'),'utf8'));
   similarityOnly=!preflight.aiEligible;similarityReason=preflight.reason;
   for(let attempt=0;attempt<3;attempt++){
    try{await run(process.execPath,[path.join(home,'utad.cjs'),input],{RESULT_DIR:dir,UTAD_JOB_ID:job.id});break}
    catch(e){
     await fs.writeFile(path.join(dir,'utad-attempt-'+(attempt+1)+'.json'),JSON.stringify({time:new Date().toISOString(),error:e.message}),{mode:0o600});
     if(attempt===2||!/Timeout \d+ms exceeded|net::ERR_|ECONNRESET|ETIMEDOUT|fetch failed/i.test(e.message))throw e;
     console.log('Retrying Turnitin browser session',job.id,'attempt',attempt+2);
     await sleep(10000*(attempt+1));
    }
   }
   if(!similarityOnly)for(let attempt=0;attempt<3;attempt++){
    try{await run(process.execPath,[path.join(home,'academi.cjs'),input],{RESULT_DIR:dir,ACADEMI_AI_ONLY:'true',...await academiCredentials(dir)});break}
    catch(e){await fs.writeFile(path.join(dir,'academi-attempt-'+(attempt+1)+'.json'),JSON.stringify({time:new Date().toISOString(),error:e.message}));if(/AI detection unavailable: word limit exceeded/i.test(e.message)){similarityOnly=true;break}if(attempt===2)throw e;console.log('Retrying AI report retrieval',job.id);await sleep(10000)}
   }
   if(!similarityOnly){
    const receipt=JSON.parse(await fs.readFile(path.join(dir,'utad-submission.json'),'utf8'));
    const manifest={jobId:job.id,provider:'Turnitin',submissionId:receipt.submissionId,similarityScore:receipt.similarityScore,inputSha256:digest(await fs.readFile(input)),reportSha256:digest(await fs.readFile(path.join(dir,'similarity-report.pdf'))),aiSha256:digest(await fs.readFile(path.join(dir,'ai-report.pdf')))};
    if(receipt.state!=='validated'||receipt.inputSha256!==manifest.inputSha256||receipt.reportSha256!==manifest.reportSha256)throw Error('UTAD receipt hash mismatch');
    await fs.writeFile(path.join(dir,'official-return.json.tmp'),JSON.stringify(manifest),{mode:0o600});
    await fs.rename(path.join(dir,'official-return.json.tmp'),path.join(dir,'official-return.json'));
    imported=await officialReturn(dir,input,job.id);
   }
  }
  if(similarityOnly){
   const receipt=JSON.parse(await fs.readFile(path.join(dir,'utad-submission.json'),'utf8'));
   const pdf=await fs.readFile(path.join(dir,'similarity-report.pdf'));
   if(receipt.state!=='validated'||receipt.inputSha256!==digest(await fs.readFile(input))||receipt.reportSha256!==digest(pdf))throw Error('Validated similarity receipt missing for similarity-only return');
   await api('artifact/'+job.id+'/similarity',pdf,job);
   await api('complete-similarity/'+job.id,{score:receipt.similarityScore,submissionId:receipt.submissionId,reason:similarityReason},job);
   console.log('Completed similarity-only',job.id);
  }else{
  if(!imported){for(let attempt=0;attempt<3;attempt++){try{await run(process.execPath,[path.join(home,'academi.cjs'),input],{RESULT_DIR:dir,...await academiCredentials(dir)});break}catch(e){await fs.writeFile(path.join(dir,'attempt-'+(attempt+1)+'.json'),JSON.stringify({time:new Date().toISOString(),error:e.message}));if(attempt===2||/daily similarity report limit reached|Similarity upstream failed|Similarity report still unavailable/i.test(e.message))throw e;console.log('Retrying existing submission',job.id);await sleep(10000)}}}
  await run(process.env.PYTHON_BIN||'python3',imported?[path.join(home,'official_bundle.py'),dir,input]:[path.join(home,'restyle.py'),dir,'--input',input],{});
  const info=JSON.parse(await fs.readFile(path.join(dir,'scores.json'),'utf8'));
  for(const type of ['ai','similarity','restyled','ai-restyled','similarity-restyled'])await api('artifact/'+job.id+'/'+type,await fs.readFile(path.join(dir,type.includes('restyled')?type+'.pdf':type+'-report.pdf')),job);
  await api('complete/'+job.id,info,job);console.log('Completed',job.id);
  }
 }catch(e){console.error('Job failed:',e.message);await fs.writeFile(path.join(dir,'failure.json'),JSON.stringify({time:new Date().toISOString(),error:e.message}));await api('fail/'+job.id,{reason:/existing submission preserved|manual reconciliation required/i.test(e.message)?'pending':/AI preflight word limit exceeded/i.test(e.message)?'aiPreflight':/AI detection unavailable: word limit exceeded/i.test(e.message)?'aiLimit':/manual review required|official report validation failed|report body differs/i.test(e.message)?'validation':/similarity/i.test(e.message)?'similarity':/font|align|LibreOffice/i.test(e.message)?'layout':'upstream'},job)}finally{clearInterval(heartbeat)}
 await fs.unlink(state);if(!await fs.stat(path.join(dir,'failure.json')).catch(()=>null)&&!await fs.stat(path.join(dir,'official-return.json')).catch(()=>null)&&!await fs.stat(path.join(dir,'utad-submission.json')).catch(()=>null))await fs.rm(dir,{recursive:true,force:true});
 if(process.env.WORKER_ONCE==='true')break;
 }catch(e){console.error(e.message);await sleep(15000)}}
