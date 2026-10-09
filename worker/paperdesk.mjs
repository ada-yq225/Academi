import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {digest} from './official-return.mjs';
const home=path.dirname(fileURLToPath(import.meta.url));
export function aiEligibility(text){
 const han=(text.match(/\p{Script=Han}/gu)||[]).length,latin=(text.match(/[A-Za-z]/g)||[]).length;
 const words=(text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[]).length;
 const reason=han>0&&han/(han+latin)>.1?'chinese':words<350?'word-minimum':words>29500?'word-limit':null;
 return {aiEligible:reason===null,reason,words};
}
export async function localSimilarity(input,dir,title,jobId){
 const bundled=path.join(home,'../paperdesk-search-checker');
 const checker=path.resolve(process.env.PAPERDESK_CHECKER_DIR||(await fs.stat(path.join(bundled,'engine.mjs')).catch(()=>null)?bundled:path.join(home,'../../paperdesk-search-checker')));
 await import(pathToFileURL(path.join(checker,'scripts/local-runtime.mjs')).href);
 const [{extractDocument},{checkDocument},{generatePdf}]=await Promise.all(['document.mjs','engine.mjs','report-export.mjs'].map(p=>import(pathToFileURL(path.join(checker,p)).href)));
 await fs.mkdir(dir,{recursive:true,mode:0o700});const bytes=await fs.readFile(input),inputSha256=digest(bytes);
 const text=await extractDocument(bytes,input);const eligibility=aiEligibility(text);let result;
 try{const saved=JSON.parse(await fs.readFile(path.join(dir,'paperdesk-result.json'),'utf8'));if(saved.inputSha256===inputSha256)result=saved.result;}catch{}
 if(!result){result=await checkDocument({text,maxQueries:6},p=>console.log('PaperDesk:',p.message));await fs.writeFile(path.join(dir,'paperdesk-result.json'),JSON.stringify({inputSha256,result}),{mode:0o600});}
 if(!Number.isFinite(result.similarity)||!result.coverage.readableSources)throw Error('PaperDesk similarity unavailable: no readable source; not a zero score');
 const pdf=await generatePdf(result,{title:title+' - 自主查重报告'});await fs.writeFile(path.join(dir,'similarity-report.pdf'),pdf,{mode:0o600});await fs.writeFile(path.join(dir,'similarity-restyled.pdf'),pdf,{mode:0o600});
 const receipt={jobId,provider:'PaperDesk',inputSha256,reportSha256:digest(pdf),similarityScore:result.similarity,retrievalStatus:result.status,coverage:result.coverage,...eligibility};
 await fs.writeFile(path.join(dir,'paperdesk-receipt.json'),JSON.stringify(receipt),{mode:0o600});return {receipt,result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const input=process.argv[2],dir=process.env.RESULT_DIR;if(!input||!dir)throw Error('Set RESULT_DIR and pass a document');
 const job=JSON.parse(await fs.readFile(path.join(dir,'job.json'),'utf8'));await localSimilarity(input,dir,job.filename,job.id);
}
