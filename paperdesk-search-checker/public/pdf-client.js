export async function downloadPdf(record){
 const response=await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record),signal:AbortSignal.timeout(90000)});
 if(!response.ok){let message=`报告下载失败（HTTP ${response.status}），请稍后重试`;try{message=(await response.json()).error||message;}catch{}throw Error(message);}
 const blob=await response.blob();if(!blob.type.includes('pdf'))throw Error('服务器未返回PDF报告，请稍后重试');
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=record.sampleId==='benchmark'?'paperdesk-benchmark-report.pdf':'paperdesk-similarity-report.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
