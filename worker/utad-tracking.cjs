const transient=e=>e?.name==='TimeoutError'||/net::ERR_|ECONNRESET|ETIMEDOUT|fetch failed/.test(e?.message||'');
async function scanPages({reset,read,next},limit=100){
 await reset();
 for(let i=0;i<limit;i++){
  const item=await read();if(item)return item;
  if(!await next())return null;
 }
 throw Error('UTAD pagination limit reached; cannot safely conclude submission is absent');
}
async function waitForReport(probe,{timeoutMs=1200000,intervalMs=15000,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}}={}){
 const deadline=now()+timeoutMs;let attempt=0;
 while(now()<deadline){
  let item;
  try{item=await probe()}catch(e){if(!transient(e))throw e;onProgress({state:'temporary-page-error',attempt:++attempt});}
  if(item&&Number.isFinite(item.score)){
   if(item.score<0||item.score>100)throw Error('Invalid official similarity score');
   return item;
  }
  onProgress({state:item?'report-processing':'awaiting-submission-list',attempt:++attempt});
  await sleep(Math.min(intervalMs,Math.max(0,deadline-now())));
 }
 throw Error('UTAD similarity report still pending after bounded waiting; existing submission preserved');
}
async function retryTransient(operation,{attempts=3,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let i=0;i<attempts;i++){
  try{return await operation()}catch(e){if(!transient(e)||i===attempts-1)throw e;await sleep(2000*(i+1));}
 }
}
module.exports={scanPages,waitForReport,transient,retryTransient};
