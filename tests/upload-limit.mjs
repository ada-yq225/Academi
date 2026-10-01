import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const dir=await mkdtemp(tmpdir()+'/paperdesk-limit-');
const base='http://127.0.0.1:3237';
const child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,PORT:'3237',APP_ORIGIN:base,DATA_DIR:dir,ADMIN_TOKEN:randomBytes(32).toString('hex'),WORKER_TOKEN:randomBytes(32).toString('hex')},stdio:'ignore'});
let db;
try{
 for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 const auth=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:'upload-limit@example.com',password:randomBytes(20).toString('hex')})});
 assert.equal(auth.status,200);
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 db=new DatabaseSync(dir+'/paperdesk.sqlite');
 const user=db.prepare('SELECT id FROM users LIMIT 1').get().id;
 db.prepare("INSERT INTO runtime(key,value) VALUES('worker_seen',?)").run(String(Date.now()));
 db.prepare('INSERT INTO ledger(id,user_id,delta,created_at) VALUES(?,?,?,?)').run('test-credit',user,2,Date.now());
 async function upload(size){const bytes=Buffer.alloc(size);bytes.write('%PDF-');const form=new FormData();form.append('requestId',randomUUID());form.append('file',new File([bytes],'sample.pdf',{type:'application/pdf'}));return fetch(base+'/api/jobs',{method:'POST',headers:{Cookie:cookie,Origin:base},body:form})}
 let response=await upload(10*1024*1024+1);
 assert.equal(response.status,413);assert.match((await response.json()).error,/10 MB/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
 response=await upload(10*1024*1024);
 assert.equal(response.status,200);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);
 assert.equal(db.prepare('SELECT COALESCE(SUM(delta),0) n FROM ledger').get().n,1);
 console.log('PASS: 10 MB accepted; larger file rejected without job or credit charge');
}finally{db?.close();child.kill();await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true})}
