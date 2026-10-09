export async function api(url,options={}){
 let response;try{response=await fetch(url,{...options,signal:options.signal||AbortSignal.timeout(60000)});}catch{throw Error('网络连接暂时中断，请稍后重试；已提交的任务仍会继续。');}
 const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{throw Error(`服务暂时无法返回结果（HTTP ${response.status}），请稍后重试。`);}
 if(!response.ok)throw Error(body.error||`请求失败（HTTP ${response.status}）`);return body;
}
