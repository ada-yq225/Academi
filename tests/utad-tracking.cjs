const assert=require('node:assert/strict');
const {scanPages,waitForReport,retryTransient}=require('../worker/utad-tracking.cjs');
(async()=>{
 let page=0;const found=await scanPages({reset:async()=>{page=0},read:async()=>page===2?{score:5}:null,next:async()=>++page<4});assert.equal(found.score,5);
 await assert.rejects(()=>scanPages({reset:async()=>{},read:async()=>null,next:async()=>true},3),/pagination limit/);
 let time=0,i=0;const observations=[null,{score:null},Object.assign(Error('slow page'),{name:'TimeoutError'}),null,{score:0}];
 const options={timeoutMs:100,intervalMs:10,now:()=>time,sleep:async ms=>{time+=ms}};
 const ready=await waitForReport(async()=>{const x=observations[i++];if(x instanceof Error)throw x;return x},options);assert.equal(ready.score,0);assert.equal(i,5);
 time=0;await assert.rejects(()=>waitForReport(async()=>null,options),/existing submission preserved/);
 time=0;await assert.rejects(()=>waitForReport(async()=>{throw Error('403 Forbidden')},options),/403/);
 time=0;await assert.rejects(()=>waitForReport(async()=>({score:101}),options),/Invalid/);
 let calls=0;assert.equal(await retryTransient(async()=>{if(++calls<3)throw Object.assign(Error('slow'),{name:'TimeoutError'});return 'ready'},{sleep:async()=>{}}),'ready');assert.equal(calls,3);
 calls=0;await assert.rejects(()=>retryTransient(async()=>{calls++;throw Error('403 Forbidden')},{sleep:async()=>{}}),/403/);assert.equal(calls,1);
 console.log('PASS: pagination, temporarily missing rows, pending scores, transient timeout, zero score, bounded wait, auth refusal and invalid score');
})().catch(e=>{console.error(e);process.exitCode=1});
