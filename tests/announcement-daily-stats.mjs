import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const dir=await mkdtemp(tmpdir()+'/paperdesk-announcement-');
const port=3238,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,PORT:String(port),APP_ORIGIN:base,DATA_DIR:dir,ADMIN_TOKEN:randomBytes(32).toString('hex'),WORKER_TOKEN:randomBytes(32).toString('hex')},stdio:'ignore'});
let database;
try{
 for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 let cookie='';
 const call=(path,body,headers={})=>fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base,...headers},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await call('admin/announcement',{content:'test'})).status,401);
 const password=randomBytes(20).toString('hex');
 let response=await call('register',{email:'customer-announcement@example.com',password});
 assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('admin/announcement',{content:'test'})).status,403);
 database=new DatabaseSync(dir+'/paperdesk.sqlite');
 assert.equal((await(await call('state')).json()).announcement,'');
 database.exec("UPDATE users SET role='admin'");
 assert.equal((await call('admin/announcement',{content:'a'}, {Origin:'https://evil.example'})).status,403);
 assert.equal((await call('admin/announcement',{content:'x'.repeat(501)})).status,400);
 response=await call('admin/announcement',{content:'  系统维护通知  '});assert.equal(response.status,200);
 assert.equal((await(await call('state')).json()).announcement,'系统维护通知');
 const userId=database.prepare('SELECT id FROM users LIMIT 1').get().id;
 const insert=database.prepare('INSERT INTO jobs(id,user_id,filename,status,input_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
 const dayA=Date.UTC(2026,8,29,16,30),dayB=Date.UTC(2026,8,30,0,30);
 insert.run('daily-a',userId,'a.pdf','completed','inputs/a.pdf',dayA,dayA);
 insert.run('daily-b',userId,'b.pdf','failed','inputs/b.pdf',dayB,dayB);
 insert.run('daily-c',userId,'c.pdf','processing','inputs/c.pdf',dayB,dayB);
 const overview=await(await call('admin/overview')).json();
 assert.deepEqual(overview.dailyStats.find(r=>r.day==='2026-09-30'),{day:'2026-09-30',total:3,completed:1,failed:1});
 assert.equal((await call('admin/announcement',{content:''})).status,200);
 assert.equal((await(await call('state')).json()).announcement,'');
 console.log('PASS: admin-only announcement edit, persistence, clearing, validation, origin protection, daily totals in Beijing time');
}finally{database?.close();child.kill();await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true})}
