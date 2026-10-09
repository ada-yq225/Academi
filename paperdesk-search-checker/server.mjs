import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {checkDocument} from './engine.mjs';
import {pdfText} from './retrieval.mjs';
import {readFile,readdir} from 'node:fs/promises';
import {generatePdf} from './report-export.mjs';
import {customerSession,originMatches} from './customer-session.mjs';
const app=express(),root=path.dirname(fileURLToPath(import.meta.url));const jobs=new Map();let running=0,pdfRunning=0;
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");if(req.method==='POST'&&!originMatches(req.headers.origin,req.headers.host))return res.status(403).json({error:'请求来源不匹配，请从当前网站页面提交'});next();});
app.use(customerSession);
app.use(express.json({limit:'2mb'}));
// Keep the customer UI in memory while testing: macOS may offload small files
// in Documents between requests. Only the public folder is preloaded.
const publicCache=new Map();
for(const folder of ['', 'samples'])for(const entry of await readdir(path.join(root,'public',folder),{withFileTypes:true})){
 if(!entry.isFile()||!/^.+\.(?:html|js|css|json|txt)$/.test(entry.name)||entry.name.startsWith('pdf-download'))continue;
 const bytes=await readFile(path.join(root,'public',folder,entry.name));if(bytes.length<2*1024*1024)publicCache.set('/'+[folder,entry.name].filter(Boolean).join('/'),{bytes,extension:path.extname(entry.name)});
}
app.use((req,res,next)=>{const hit=publicCache.get(req.path==='/'?'/index.html':req.path);if(!hit||!['GET','HEAD'].includes(req.method))return next();res.type(hit.extension).set('Cache-Control','no-cache').send(hit.bytes);});
app.use(express.static(path.join(root,'public')));
app.get('/api/health',(req,res)=>res.set('Cache-Control','no-store').json({status:'ok',running,pdfRunning}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
app.post('/api/extract',upload.single('file'),async(req,res,next)=>{try{
 const f=req.file;if(!f)throw Error('请选择文件');const ext=path.extname(f.originalname).toLowerCase();let text;
 if(ext==='.txt')text=f.buffer.toString('utf8');else if(ext==='.docx')text=(await mammoth.extractRawText({buffer:f.buffer})).value;else if(ext==='.pdf'&&f.buffer.subarray(0,5).toString()==='%PDF-')text=await pdfText(f.buffer);else throw Error('支持TXT、DOCX和文字型PDF');
 if(text.trim().length<30)throw Error('文件未提取到足够文字；扫描版PDF需要先做OCR');if(text.length>150000)throw Error('第一版最多支持150,000字符');res.json({text,filename:f.originalname});
 }catch(e){next(e);}});
app.post('/api/check',(req,res)=>{
 if(jobs.size>=100)return res.status(429).json({error:'测试任务较多，请稍后再试'});
 if(running>=2)return res.status(429).json({error:'目前有两个任务在运行，请稍后再试'});
 const {text,urls=[],referenceText='',maxQueries=6,title='提交文稿'}=req.body;
 if(typeof title!=='string'||title.length>160)return res.status(400).json({error:'文稿名称最多160字符'});
 if(typeof text!=='string'||text.trim().length<30||text.length>150000)return res.status(400).json({error:'请输入30至150,000字符的文稿'});
 if(!Array.isArray(urls)||urls.length>10||urls.some(u=>typeof u!=='string'||u.length>2000)||typeof referenceText!=='string'||referenceText.length>500000||!Number.isInteger(maxQueries)||maxQueries<0||maxQueries>12)return res.status(400).json({error:'来源或检索范围格式不正确'});
 const id=randomUUID(),job={id,title,customerId:req.customerId,status:'running',progress:{message:'准备检测'},created:Date.now()};jobs.set(id,job);running++;res.status(202).json({id});
 checkDocument({text,urls,maxQueries,corpus:referenceText.trim()?[{title:'自有参考文稿',text:referenceText}]:[]},progress=>job.progress=progress).then(result=>{job.status='done';job.result=result;}).catch(e=>{job.status='failed';job.error=e.message;}).finally(()=>{running--;});
});
app.get('/api/jobs/:id',(req,res)=>{const job=jobs.get(req.params.id);res.set('Cache-Control','no-store');if(!job||job.customerId!==req.customerId)return res.status(404).json({error:'任务不存在、已清理或不属于当前浏览器'});const {customerId,...visible}=job;res.json(visible);});
const sampleNames=new Set(['academic','academic-regression','conference-body','agriculture-engineering','chinese-journal','physics-journals','original-control','benchmark']);
app.post('/api/report',async(req,res)=>{
 if(pdfRunning>=2)return res.status(429).json({error:'报告生成繁忙，请稍后重试'});
 const {jobId,sampleId}=req.body;if(Boolean(jobId)===Boolean(sampleId))return res.status(400).json({error:'请选择一份已完成的检测记录'});
 let result,title,type='check';
 if(jobId){const job=typeof jobId==='string'?jobs.get(jobId):undefined;if(!job||job.customerId!==req.customerId)return res.status(404).json({error:'检测记录不存在、已清理或不属于当前浏览器'});if(job.status!=='done')return res.status(409).json({error:'检测尚未完成'});result=job.result;title=(job.title||'提交文稿')+' - 自主查重报告';}
 else{if(!sampleNames.has(sampleId))return res.status(404).json({error:'没有这份测试记录'});try{if(sampleId==='benchmark'){result=JSON.parse(await readFile(path.join(root,'public/samples/expanded-summary.json'),'utf8'));type='benchmark';title='跨领域扩大测试 - 结果与修复记录';}else{result=JSON.parse(await readFile(path.join(root,'public/samples/'+sampleId+'-result.json'),'utf8'));title='PaperDesk 测试文稿 - 自主查重报告';}}catch(e){return res.status(404).json({error:'测试记录尚未发布'});}}
 pdfRunning++;
 try{const bytes=await generatePdf(result,{title,type});res.set('Content-Type','application/pdf');res.set('Content-Disposition','attachment; filename="paperdesk-'+(type==='benchmark'?'benchmark':'similarity')+'-report.pdf"');res.set('Cache-Control','no-store');res.send(bytes);}catch(e){res.status(500).json({error:e.message});}finally{pdfRunning--;}
});
app.use((error,req,res,next)=>res.status(400).json({error:error.code==='LIMIT_FILE_SIZE'?'单个文件不能超过10 MB':error.message}));
setInterval(()=>{for(const [id,j] of jobs)if(j.status!=='running'&&Date.now()-j.created>30*60*1000)jobs.delete(id);},60000).unref();
const port=Number(process.env.PORT||5020);app.listen(port,'127.0.0.1',()=>console.log(`PaperDesk 自主查重：http://127.0.0.1:${port}`));
