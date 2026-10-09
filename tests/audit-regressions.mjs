import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import {requestJSON} from '../lib/client-api.mjs';
import {pdfReady} from '../worker/pdf-ready.mjs';
test('gateway HTML, network errors and JSON failures produce readable feedback without replay',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return new Response('<html>gateway unavailable</html>',{status:502});};
  await assert.rejects(requestJSON('/api/login',{email:'test'}),/公网连接暂不可用/);assert.equal(calls,1);
  globalThis.fetch=async()=>{throw Error('socket closed')};await assert.rejects(requestJSON('/api/jobs',{}),/避免重复提交/);
  globalThis.fetch=async()=>Response.json({error:'检测额度不足'},{status:402});await assert.rejects(requestJSON('/api/jobs',{}),/检测额度不足/);
  globalThis.fetch=async()=>Response.json({ok:true});assert.deepEqual(await requestJSON('/api/state'),{ok:true});
 }finally{globalThis.fetch=original;}
});
test('interrupted report files cannot be reused',async()=>{
 const dir=await fs.mkdtemp(os.tmpdir()+'/pd-pdf-audit-'),file=dir+'/report.pdf';
 try{
  assert.equal(await pdfReady(file),false);
  await fs.writeFile(file,'%PDF-1.7\npartial downloaded content');assert.equal(await pdfReady(file),false);
  await fs.writeFile(file,'<html>upstream error</html>%%EOF');assert.equal(await pdfReady(file),false);
  await fs.writeFile(file,'%PDF-1.7\nreport download complete\n%%EOF\n');assert.equal(await pdfReady(file),true);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

import {runProcess} from '../worker/run-process.mjs';
test('stalled subprocess stops instead of occupying the worker indefinitely',async()=>{
 await runProcess(process.execPath,['-e','process.exit(0)'],{}, {timeoutMs:1000,stdio:['ignore','ignore','pipe']});
 const started=Date.now();await assert.rejects(runProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{}, {timeoutMs:150,killAfterMs:100,stdio:['ignore','ignore','pipe']}),/Process timeout/);
 assert.ok(Date.now()-started<3000);
});
import {bodyLimit} from '../server/body-limit.mjs';
test('small API requests do not inherit report upload allowance',()=>{assert.equal(bodyLimit('/api/login'),65536);assert.equal(bodyLimit('/api/jobs'),11*1024*1024);assert.equal(bodyLimit('/api/worker/artifact/job/ai'),51*1024*1024);assert.equal(bodyLimit('/api/worker/evidence/job'),10*1024*1024);});
