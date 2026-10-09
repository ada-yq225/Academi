import {spawn} from 'node:child_process';
export function runProcess(command,args,env,{timeoutMs=20*60*1000,killAfterMs=5000,stdio=['ignore','inherit','pipe']}={}) {
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('Invalid process timeout');
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{env:{...process.env,...env},stdio});let detail='',timedOut=false,killTimer;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),killAfterMs);},timeoutMs);
  child.stderr?.on('data',data=>{process.stderr.write(data);detail=(detail+data.toString()).slice(-4000)});
  function finish(error){clearTimeout(timer);clearTimeout(killTimer);error?reject(error):resolve();}
  child.once('error',finish);
  child.once('exit',(code,signal)=>finish(timedOut?Error('Process timeout: report retrieval exceeded allowed wait'):code===0?null:Error(detail.trim()||'Process exited '+(signal||code))));
 });
}
