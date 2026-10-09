import fs from 'node:fs/promises';
import {pdfReady} from './pdf-ready.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './official-return.mjs';
const home=path.dirname(fileURLToPath(import.meta.url));
export async function paperdeskFlow({job,input,dir,api,run,credentials,sleep}){
 await run(process.execPath,[path.join(home,'paperdesk.mjs'),input],{RESULT_DIR:dir});
 const receipt=JSON.parse(await fs.readFile(path.join(dir,'paperdesk-receipt.json'),'utf8'));
 const {result}=JSON.parse(await fs.readFile(path.join(dir,'paperdesk-result.json'),'utf8'));
 const pdf=await fs.readFile(path.join(dir,'similarity-report.pdf'));
 if(receipt.jobId!==job.id||receipt.inputSha256!==digest(await fs.readFile(input))||receipt.reportSha256!==digest(pdf)||receipt.similarityScore!==result.similarity)throw Error('PaperDesk similarity receipt mismatch');
 for(const type of ['similarity','similarity-restyled'])await api('artifact/'+job.id+'/'+type,pdf,job);
 await api('evidence/'+job.id,result,job);
 await api('partial-paperdesk/'+job.id,{similarityScore:receipt.similarityScore},job);
 let aiScore=null,reason=receipt.reason;
 if(receipt.aiEligible){
  let ready=await pdfReady(path.join(dir,'ai-report.pdf'));
  if(!ready)for(let attempt=0;attempt<3;attempt++){
   try{await run(process.execPath,[path.join(home,'academi.cjs'),input],{RESULT_DIR:dir,ACADEMI_AI_ONLY:'true',...await credentials(dir)});if(!await pdfReady(path.join(dir,'ai-report.pdf')))throw Error('AI report download incomplete');ready=true;break;}
   catch(e){await fs.writeFile(path.join(dir,'academi-attempt-'+(attempt+1)+'.json'),JSON.stringify({time:new Date().toISOString(),error:e.message}),{mode:0o600});if(/AI detection unavailable: word limit exceeded/i.test(e.message)){reason='word-limit';break;}if(attempt===2)throw e;await sleep(10000);}
  }
  if(ready){
   // Keep the existing AI shell with ACADEMI attribution and source PDF pages.
   await run(process.env.PYTHON_BIN||'python3',[path.join(home,'restyle.py'),dir,'--ai-only'],{});
   aiScore=JSON.parse(await fs.readFile(path.join(dir,'scores.json'),'utf8')).aiScore;
   await run(process.env.PYTHON_BIN||'python3',[path.join(home,'paperdesk_bundle.py'),dir],{});
   for(const type of ['ai','ai-restyled','restyled'])await api('artifact/'+job.id+'/'+type,await fs.readFile(path.join(dir,type==='ai'?'ai-report.pdf':type+'.pdf')),job);
  }
 }
 await api('complete-paperdesk/'+job.id,{aiScore,similarityScore:receipt.similarityScore,aiSkippedReason:aiScore===null?reason:null},job);
 console.log('Completed PaperDesk + ACADEMI job',job.id);
}
