import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
const dir=await fs.mkdtemp(os.tmpdir()+'/pd-api-audit-'),base='http://127.0.0.1:3251';
const previous=globalThis.fetch,adminToken=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),paymentKey=randomBytes(32).toString('hex');
Object.assign(process.env,{APP_ORIGIN:base,DATA_DIR:dir,ADMIN_TOKEN:adminToken,WORKER_TOKEN:workerToken,PAYMENT_PROVIDER:'jianpay',PAYMENT_ENABLED:'true',JIANPAY_CLIENT_NO:'AUDIT',JIANPAY_KEY:paymentKey});
const {GET,POST}=await import('../dist/audit-api.mjs');
globalThis.fetch=async(url,options={})=>{const req=new Request(url,options);return req.method==='POST'?POST(req):GET(req);};
let db;
try{
 const post=(route,body,headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 assert.equal((await post('login','{broken-json')).status,400);

 const auth=await post('register',{email:'audit@paperdesk.test',password:randomBytes(16).toString('hex')});assert.equal(auth.status,200);const cookie=auth.headers.get('set-cookie').split(';')[0];
 assert.equal((await post('admin/codes',{}, {Cookie:cookie})).status,403);
 assert.equal((await post('logout',{}, {Cookie:cookie,Origin:'https://other.test'})).status,403);
 db=new DatabaseSync(dir+'/paperdesk.sqlite');const user=db.prepare('SELECT id FROM users LIMIT 1').get().id;
 db.prepare("INSERT INTO runtime(key,value) VALUES('worker_seen',?)").run(String(Date.now()));db.prepare('INSERT INTO ledger VALUES(?,?,?,?)').run('audit-credit',user,2,Date.now());
 const requestId=randomUUID(),bodies=[Buffer.from('%PDF-1.7\nfirst input'),Buffer.from('%PDF-1.7\nsecond input')];
 async function upload(bytes,name='audit.pdf'){const form=new FormData();form.append('file',new Blob([bytes]),name);form.append('requestId',requestId);return fetch(base+'/api/jobs',{method:'POST',headers:{Cookie:cookie,Origin:base},body:form});}
 const responses=await Promise.all(bodies.map((bytes,index)=>upload(bytes,'audit-'+index+'.pdf')));assert.deepEqual(responses.map(r=>r.status),[200,200]);
 const ids=await Promise.all(responses.map(r=>r.json()));assert.equal(ids[0].id,ids[1].id);
 const job=db.prepare('SELECT * FROM jobs').get();assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n,1);assert.equal(db.prepare('SELECT sum(delta) n FROM ledger').get().n,1);
 const saved=await fs.readFile(dir+'/files/'+job.input_key);assert.deepEqual(saved,bodies[Number(job.filename.match(/audit-(\d)/)[1])],'accepted job metadata must match the saved input');assert.ok(job.input_key.includes(createHash('sha256').update(saved).digest('hex')));assert.equal((await fs.readdir(dir+'/files/inputs')).length,1);
 await upload(Buffer.from('%PDF-1.7\nthird input'));assert.deepEqual(await fs.readFile(dir+'/files/'+job.input_key),saved,'later replay must not replace accepted input');
 const get=(route,headers={})=>fetch(base+'/api/'+route,{headers});
 const bearer={Authorization:'Bearer '+adminToken},customer={Cookie:cookie};
 // Double redemption is atomic; passwords never appear in admin account lists.
 const code=await (await post('admin/codes',{count:1,credits:5},bearer)).json();
 const redeemed=await Promise.all([post('redeem',{code:code.codes[0]},customer),post('redeem',{code:code.codes[0]},customer)]);
 assert.deepEqual(redeemed.map(r=>r.status).sort(),[200,409]);
 assert.equal((await (await get('state',customer)).json()).balance,6);
 // Signed payment callbacks, concurrent delivery and replay must credit once.
 db.prepare("INSERT INTO orders(id,user_id,product_name,credits,amount,currency,status,created_at,provider,provider_order_id) VALUES(?,?,'audit',5,1,'CNY','pending',?,'jianpay','PAYAUDIT')").run('audit-order',user,Date.now());
 const payload={clientNo:'AUDIT',merchantOrderNo:'audit-order',orderId:'PAYAUDIT',amount:1,status:2};
 function signed(data){return {...data,sign_type:'MD5',sign:createHash('md5').update(Object.keys(data).sort().map(k=>k+'='+data[k]).join('&')+paymentKey).digest('hex')}}
 assert.equal((await post('payment/jianpay',{...payload,sign:'bad'})).status,401);
 assert.equal((await post('payment/jianpay',signed({...payload,amount:2}))).status,400);
 assert.deepEqual((await Promise.all([post('payment/jianpay',signed(payload)),post('payment/jianpay',signed(payload))])).map(r=>r.status),[200,200]);
 await post('payment/jianpay',signed(payload));assert.equal((await (await get('state',customer)).json()).balance,11);
 // Chat isolation, deduplication, admin replies and read acknowledgement.
 const other=await post('register',{email:'other@paperdesk.test',password:randomBytes(16).toString('hex')});const stranger={Cookie:other.headers.get('set-cookie').split(';')[0]};
 db.prepare("UPDATE users SET role='admin' WHERE email='other@paperdesk.test'").run();
 assert.equal((await get('support/messages?customer=other',customer)).status,403);
 const msg={body:'audit customer question',requestId:randomUUID()};await post('support/messages',msg,customer);await post('support/messages',msg,customer);
 assert.equal((await (await get('support/messages',customer)).json()).messages.length,1);
 assert.equal((await post('support/messages?customer='+user,{body:'admin reply',requestId:randomUUID()},stranger)).status,200);
 const chat=await (await get('support/messages',customer)).json();assert.equal(chat.unread,1);await post('support/read',{lastId:chat.messages.at(-1).id},customer);assert.equal((await (await get('support/messages',customer)).json()).unread,0);
 assert.equal((await get('admin/file/'+job.id+'/input',customer)).status,403);
 assert.deepEqual(Buffer.from(await (await get('admin/file/'+job.id+'/input',bearer)).arrayBuffer()),saved);
 // Partial success, exact-once refunds, recovery and own-account evidence/download.
 const wh={Authorization:'Bearer '+workerToken};const claimed=await (await post('worker/claim',{},wh)).json();assert.equal(claimed.job.id,job.id);const lease={...wh,'X-Job-Lease':claimed.job.lease};
 const result={similarity:42,status:'partial',coverage:{readableSources:2}};
 assert.equal((await post('worker/evidence/'+job.id,result,lease)).status,200);
 const pdf=Buffer.from('%PDF-1.7\nTest fixture PDF bytes\n%%EOF\n');
 for(const type of ['similarity','similarity-restyled'])assert.equal((await fetch(base+'/api/worker/artifact/'+job.id+'/'+type,{method:'POST',headers:lease,body:pdf})).status,200);
 await post('worker/partial-paperdesk/'+job.id,{similarityScore:42},lease);
 assert.equal((await post('worker/complete-paperdesk/'+job.id,{similarityScore:42,aiScore:10},lease)).status,409);
 await post('worker/fail/'+job.id,{reason:'upstream'},lease);await post('worker/fail/'+job.id,{reason:'upstream'},lease);
 assert.equal((await (await get('state',customer)).json()).balance,12);
 assert.equal((await get('report/'+job.id+'/similarity',customer)).status,200);
 assert.equal((await get('evidence/'+job.id,stranger)).status,404);
 assert.equal((await post('admin/retry-job',{jobId:job.id},bearer)).status,200);
 assert.equal((await post('admin/retry-job',{jobId:job.id},bearer)).status,409);
 const retry=await (await post('worker/claim',{},wh)).json(),retryLease={...wh,'X-Job-Lease':retry.job.lease};
 assert.equal((await post('worker/complete-paperdesk/'+job.id,{similarityScore:42,aiScore:null,aiSkippedReason:'chinese'},retryLease)).status,200);
 assert.equal((await post('worker/complete-paperdesk/'+job.id,{similarityScore:42,aiScore:null,aiSkippedReason:'chinese'},retryLease)).status,200);
 assert.equal((await (await get('state',customer)).json()).balance,11);
 assert.equal((await get('report/'+job.id+'/similarity-restyled',customer)).status,200);
 assert.equal((await post('delete-job/'+job.id,{},customer)).status,200);assert.equal((await get('report/'+job.id+'/similarity',customer)).status,404);
 // Recovery revokes all sessions, requires an explicit identity check and preserves quota.
 assert.equal((await post('admin/reset-password',{userId:user},bearer)).status,400);
 const reset=await (await post('admin/reset-password',{userId:user,verified:true},bearer)).json();assert.ok(reset.temporaryPassword);
 assert.equal((await (await get('state',customer)).json()).user,null);
 const login=await post('login',{email:'audit@paperdesk.test',password:reset.temporaryPassword});const temporary={Cookie:login.headers.get('set-cookie').split(';')[0]};
 assert.equal((await post('redeem',{code:'anything'},temporary)).status,403);
 assert.equal((await post('change-password',{currentPassword:reset.temporaryPassword,password:'Audit-New-Password-12345'},temporary)).status,200);
 const login2=await post('login',{email:'audit@paperdesk.test',password:'Audit-New-Password-12345'});const recovered={Cookie:login2.headers.get('set-cookie').split(';')[0]};assert.equal((await (await get('state',recovered)).json()).balance,11);
 console.log('PASS: concurrent uploads/debits, request format, CSRF/admin permissions, CDK concurrency, signed payment amount/replay, chat privacy/read/dedup, admin download, partial report, refund/retry/completion, deletion and password recovery preserving balance');
}finally{db?.close();globalThis.fetch=previous;await fs.rm(dir,{recursive:true,force:true});}
