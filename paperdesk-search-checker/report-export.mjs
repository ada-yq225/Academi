import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
export async function generatePdf(result,{title='PaperDesk 自主查重报告',type='check'}={}){
 const directory=await mkdtemp(path.join(tmpdir(),'paperdesk-pdf-'));
 try{const input=path.join(directory,'result.json'),output=path.join(directory,'report.pdf'),evidence=path.join(directory,'evidence.pdf');await writeFile(input,JSON.stringify(result));const python=process.env.PYTHON_BIN||'python3';await exec(python,[path.join(root,'scripts/pdf-report.py'),'--input',input,'--output',type==='check'?evidence:output,'--title',title,'--type',type,...(type==='check'?['--shell-evidence']:[])],{timeout:60000,maxBuffer:1024*1024});if(type==='check')await exec(python,[path.join(root,'scripts/report-shell/restyle.py'),'--paperdesk','--input',input,'--evidence',evidence,'--output',output,'--title',title],{timeout:60000,maxBuffer:1024*1024});const bytes=await readFile(output);if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF');return bytes;}
 catch(e){throw Error('PDF 报告生成失败，请保留 JSON 结果稍后重试');}
 finally{await rm(directory,{recursive:true,force:true});}
}
