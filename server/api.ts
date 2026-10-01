import {adminFile,withFiles} from './admin-files';
import {recovery} from './recovery';
import {support} from './support';
import {jianReady,jianCall,jianCallback,settleJian} from '@/lib/jianpay';
import {E,db,stmt,first,rows,hash,random,password,identity,requireUser,HttpError,rate,balance,origin,secret,products,signature,requireAdmin} from '@/lib/server';
export const dynamic='force-dynamic';
const json=(data:any,status=200,headers:any={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
async function handle(req:Request){try{
 const path=new URL(req.url).pathname.slice(5).split('/'),action=path[0],now=Date.now();
 if(req.method==='POST'&&!['worker','payment','admin'].includes(action))origin(req);
 if(['forgot-password','change-password'].includes(action)||action==='admin'&&['password-requests','reset-password','retry-job'].includes(path[1]))return json(await recovery(req,path));
 if(action==='support')return json(await support(req,path));
 if(action==='state'&&req.method==='GET'){const u=await identity(req),last=await first("SELECT value FROM runtime WHERE key='worker_seen'"),announcement=u?await first("SELECT value FROM runtime WHERE key='site_announcement'"):null;return json({user:u,announcement:announcement?.value||'',balance:u?await balance(u.id):0,jobs:u?await rows('SELECT id,filename,status,created_at,ai_score,similarity_score,error,layout_version,report_sources FROM jobs WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',u.id):[],orders:u?await rows('SELECT id,product_name,status,code,created_at,provider,pay_url FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100',u.id):[],products:products(),paymentConfigured:!!jianReady(),paymentEnabled:!!((jianReady()||E().PAYMENT_ENABLED==='true'&&E().CHECKOUT_URL&&E().PAYMENT_SECRET)&&products().some(p=>p.price>0)),workerOnline:!!last&&now-Number(last.value)<90000})}
 if(['register','login'].includes(action)&&req.method==='POST'){
  await rate(req,action);const b=await req.json() as any,email=String(b.email||'').trim().toLowerCase(),pass=String(b.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||pass.length<(action==='register'?10:1)||pass.length>128)throw new HttpError(400,'请输入有效邮箱和密码；注册密码需 10–128 位');
  let u=await first('SELECT * FROM users WHERE email=?',email);
  if(action==='register'){if(u)throw new HttpError(409,'该邮箱已注册，请登录');u={id:random(),email};await stmt('INSERT INTO users(id,email,password,created_at) VALUES(?,?,?,?)',u.id,email,await password(pass),now).run()}
  else {const stored=u?.password||'none:none';const computed=await password(pass,stored.split(':')[0]);if(!u||await hash(computed)!==await hash(stored))throw new HttpError(401,'邮箱或密码不正确')}
  await stmt('INSERT INTO account_events(id,user_id,action,created_at) VALUES(?,?,?,?)',random(),u.id,action,now).run();
  const token=random()+random();await stmt('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)',await hash(token),u.id,now+604800000).run();return json({ok:true},200,{'Set-Cookie':`pd_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${new URL(req.url).protocol==='https:'?'; Secure':''}`})
 }
 if(action==='logout'&&req.method==='POST'){const raw=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('pd_session='))?.slice(11);if(raw)await stmt('DELETE FROM sessions WHERE token=?',await hash(raw)).run();return json({ok:true},200,{'Set-Cookie':'pd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'})}
 if(action==='redeem'&&req.method==='POST'){
  const u=await requireUser(req);await rate(req,'redeem',20);const b=await req.json() as any,code=String(b.code||'').trim().toUpperCase();if(code.length>100)throw new HttpError(400,'兑换码格式不正确');const h=await hash(code),nonce=random();
  await db().batch([stmt('UPDATE codes SET redeemed_by=?,redeemed_at=?,nonce=? WHERE hash=? AND redeemed_by IS NULL AND (expires IS NULL OR expires>?)',u.id,now,nonce,h,now),stmt('INSERT OR IGNORE INTO ledger(id,user_id,delta,created_at) SELECT ?,?,credits,? FROM codes WHERE hash=? AND nonce=?','cdk:'+h,u.id,now,h,nonce)]);
  const c=await first('SELECT credits FROM codes WHERE hash=? AND nonce=?',h,nonce);if(!c)throw new HttpError(409,'兑换码无效、已使用或已过期');return json({credits:c.credits})
 }
 if(action==='document'&&req.method==='GET'){
 const u=await requireUser(req),j=await first('SELECT input_key,filename FROM jobs WHERE id=? AND user_id=? AND deleted_at IS NULL',path[1],u.id);if(!j)throw new HttpError(404,'文稿不存在');const obj=await E().BUCKET.get(j.input_key);if(!obj)throw new HttpError(404,'文稿不存在');return new Response(obj.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(j.filename),'Cache-Control':'private, no-store'}});
 }
 if(action==='delete-job'&&req.method==='POST'){
 const u=await requireUser(req),j=await first('SELECT status FROM jobs WHERE id=? AND user_id=?',path[1],u.id);if(!j)throw new HttpError(404,'任务不存在');if(!['completed','failed'].includes(j.status))throw new HttpError(409,'检测中的任务暂不能删除');await stmt('UPDATE jobs SET deleted_at=? WHERE id=? AND user_id=?',now,path[1],u.id).run();return json({ok:true});
 }
 if(action==='jobs'&&req.method==='POST'){
  const u=await requireUser(req);await rate(req,'upload',30);const seen=await first("SELECT value FROM runtime WHERE key='worker_seen'");if(!seen||now-Number(seen.value)>90000)throw new HttpError(503,'检测通道暂未连接，请稍后提交，额度不会扣除');
  if(Number(req.headers.get('content-length')||0)>11*1024*1024)throw new HttpError(413,'文件不能超过 10 MB');const form=await req.formData(),file=form.get('file'),requestId=String(form.get('requestId')||'');if(!(file instanceof File)||!file.size||!/^[-a-zA-Z0-9]{16,64}$/.test(requestId))throw new HttpError(400,'请选择有效文稿');if(file.size>10*1024*1024)throw new HttpError(413,'文件不能超过 10 MB');
  const ext=file.name.toLowerCase().endsWith('.pdf')?'pdf':file.name.toLowerCase().endsWith('.docx')?'docx':'';if(!ext)throw new HttpError(400,'仅支持 PDF 和 DOCX');const bytes=await file.arrayBuffer(),magic=new Uint8Array(bytes.slice(0,5));if(ext==='pdf'&&String.fromCharCode(...magic)!=='%PDF-'||ext==='docx'&&(magic[0]!==80||magic[1]!==75))throw new HttpError(400,'文件内容与扩展名不匹配');
  const id=await hash(u.id+':'+requestId),old=await first('SELECT id FROM jobs WHERE id=?',id);if(old)return json(old);const key='inputs/'+id+'.'+ext;await E().BUCKET.put(key,bytes);
  await db().batch([stmt("INSERT OR IGNORE INTO jobs(id,user_id,filename,status,input_key,created_at,updated_at) SELECT ?,?,?,'queued',?,?,? WHERE (SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=?)>0",id,u.id,file.name.slice(0,240),key,now,now,u.id),stmt('INSERT OR IGNORE INTO ledger(id,user_id,delta,created_at) SELECT ?,?,-1,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)','job:'+id,u.id,now,id)]);
  if(!await first('SELECT id FROM jobs WHERE id=?',id)){await E().BUCKET.delete(key);throw new HttpError(402,'检测额度不足，请先购买额度')}return json({id})
 }
 if(action==='report'&&req.method==='GET'){
  const u=await requireUser(req),job=await first("SELECT * FROM jobs WHERE id=? AND user_id=? AND status IN ('completed','failed') AND deleted_at IS NULL",path[1],u.id);if(!job||!['ai','similarity','restyled','ai-restyled','similarity-restyled'].includes(path[2])||job.status==='failed'&&(path[2]!=='similarity'||job.similarity_score===null))throw new HttpError(404,'报告不存在');const obj=await E().BUCKET.get('reports/'+job.id+'/'+path[2]+'.pdf');if(!obj)throw new HttpError(404,'报告暂不可用');return new Response(obj.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${path[2]}-report.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 }
 if(action==='payment'&&path[1]==='jianpay'&&req.method==='POST')return await jianCallback(req);
 if(action==='orders'&&path[1]&&path[2]==='check'&&req.method==='POST'){
  const u=await requireUser(req);const o=await first("SELECT * FROM orders WHERE id=? AND user_id=?",path[1],u.id);if(!o)throw new HttpError(404,'订单不存在');
  if(o.status==='paid')return json({paid:true});if(o.provider!=='jianpay')return json({paid:false});
  const lock=await stmt('UPDATE orders SET last_checked_at=? WHERE id=? AND last_checked_at<? RETURNING id',now,o.id,now-5000).first();if(!lock)return json({paid:false});
  return json(await settleJian(await jianCall('/open/payment/pay/info',o.provider_order_id?{orderId:o.provider_order_id}:{merchantOrderNo:o.id})));
 }
 if(action==='orders'&&!path[1]&&req.method==='POST'&&E().PAYMENT_PROVIDER==='jianpay'){
  const u=await requireUser(req);await rate(req,'order',15);const b=await req.json() as any,p=products().find(p=>p.id===b.product);
  if(!jianReady()||!p||!Number.isSafeInteger(p.price)||p.price<=0)throw new HttpError(503,'在线支付尚未配置完成');
  const method=b.payMethod||'wx';if(!['wx','alipay'].includes(method))throw new HttpError(400,'支付方式无效');
  const id=random();await stmt("INSERT INTO orders(id,user_id,product_name,credits,amount,currency,status,created_at,provider) VALUES(?,?,?,?,?,'CNY','pending',?,'jianpay')",id,u.id,p.name,p.credits,p.price,now).run();
  const fields:any={orderNo:id,amount:p.price,goodsName:p.name,payMethod:method};
  if(new URL(req.url).protocol==='https:'){fields.notifyUrl=new URL('/api/payment/jianpay',req.url).href;fields.returnUrl=new URL('/?view=orders',req.url).href}
  const result=await jianCall('/open/payment/pay/create',fields);
  if(result.clientNo!==E().JIANPAY_CLIENT_NO||result.merchantOrderNo!==id||result.amount!==p.price||typeof result.orderId!=='string')throw new HttpError(502,'简付下单信息不匹配');
  let url;try{url=new URL(result.payUrl)}catch{throw new HttpError(502,'简付支付地址无效')}
  if(url.protocol!=='https:'||!['jpay.hzjianban.com','api.jian-pay.com'].includes(url.hostname))throw new HttpError(502,'简付支付地址无效');
  await stmt('UPDATE orders SET provider_order_id=?,pay_url=? WHERE id=?',result.orderId,url.href,id).run();return json({id,url:url.href});
 }
 if(action==='orders'&&req.method==='POST'){
  const u=await requireUser(req);await rate(req,'order',15);const b=await req.json() as any,p=products().find(p=>p.id===b.product);if(E().PAYMENT_ENABLED!=='true'||!p||!p.price||!E().CHECKOUT_URL||!E().PAYMENT_SECRET)throw new HttpError(503,'在线支付尚未接入，暂不收款');if(!E().CHECKOUT_URL.startsWith('https://'))throw new HttpError(503,'支付配置有误');
  const id=random();await stmt("INSERT INTO orders(id,user_id,product_name,credits,amount,currency,status,created_at) VALUES(?,?,?,?,?,'CNY','pending',?)",id,u.id,p.name,p.credits,p.price,now).run();const payload=JSON.stringify({orderId:id,amount:p.price,currency:'CNY',description:p.name,callbackUrl:new URL('/api/payment/callback',req.url).href,returnUrl:new URL('/?view=orders',req.url).href});const response=await fetch(E().CHECKOUT_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Signature':await signature(E().PAYMENT_SECRET,payload)},body:payload});if(!response.ok)throw new HttpError(502,'支付服务暂不可用');const result=await response.json() as any;if(!result.url?.startsWith('https://'))throw new HttpError(502,'支付地址无效');return json({id,url:result.url})
 }
 if(action==='payment'&&path[1]==='callback'&&req.method==='POST'){
  if(E().PAYMENT_ENABLED!=='true'||!E().PAYMENT_SECRET)throw new HttpError(503,'支付未启用');const raw=await req.text();if(raw.length>20000)throw new HttpError(400,'请求过大');const sig=req.headers.get('x-signature')||'';if(await hash(sig)!==await hash(await signature(E().PAYMENT_SECRET,raw)))throw new HttpError(401,'签名不匹配');const b=JSON.parse(raw),o=await first('SELECT * FROM orders WHERE id=? AND provider=?',b.orderId,'adapter');if(!o||b.status!=='paid'||b.amount!==o.amount||b.currency!==o.currency||!Number.isFinite(b.timestamp)||Math.abs(now-b.timestamp)>300000)throw new HttpError(400,'支付回调不匹配');if(o.status==='paid')return json({ok:true});await db().batch([stmt("UPDATE orders SET status='paid' WHERE id=? AND status='pending'",o.id),stmt("INSERT OR IGNORE INTO ledger(id,user_id,delta,created_at) SELECT 'order:'||id,user_id,credits,? FROM orders WHERE id=? AND status='paid'",now,o.id)]);return json({ok:true})
 }
 if(action==='admin'&&path[1]==='file'&&req.method==='GET')return await adminFile(req,path[2],path[3]);
 if(action==='admin'&&path[1]==='announcement'&&req.method==='POST'){
  await requireAdmin(req);const b=await req.json() as any;
  if(typeof b.content!=='string'||b.content.length>500)throw new HttpError(400,'公告最多 500 字');
  const content=b.content.trim();await stmt("INSERT INTO runtime(key,value) VALUES('site_announcement',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",content).run();return json({content});
 }
 if(action==='admin'&&path[1]==='overview'&&req.method==='GET'){
  await requireAdmin(req);return json({
   dailyStats:await rows("SELECT date(created_at / 1000,'unixepoch','+8 hours') day,COUNT(*) total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM jobs GROUP BY day ORDER BY day DESC"),
   users:await rows("SELECT u.id,u.email,u.role,u.created_at,(SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=u.id) balance FROM users u ORDER BY u.created_at DESC LIMIT 500"),
   jobs:await Promise.all((await rows("SELECT j.id,u.email,j.filename,j.status,j.error,j.ai_score,j.similarity_score,j.created_at,j.input_key FROM jobs j JOIN users u ON u.id=j.user_id ORDER BY j.created_at DESC LIMIT 200")).map(withFiles)),
   orders:await rows("SELECT o.id,u.email,o.product_name,o.credits,o.amount,o.status,o.created_at FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 200"),
   codes:await rows("SELECT substr(c.hash,1,12) reference,c.credits,c.created_at,c.redeemed_at,c.expires,u.email redeemed_by FROM codes c LEFT JOIN users u ON u.id=c.redeemed_by ORDER BY c.created_at DESC LIMIT 200"),
   events:await rows("SELECT u.email,e.action,e.created_at FROM account_events e JOIN users u ON u.id=e.user_id ORDER BY e.created_at DESC LIMIT 200"),
   ledger:await rows("SELECT u.email,l.id,l.delta,l.created_at FROM ledger l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 200")});
 }
 if(action==='admin'&&path[1]==='users'&&req.method==='POST'){
  await requireAdmin(req);await rate(req,'admin-create',60);const b=await req.json() as any,email=String(b.email||'').trim().toLowerCase(),pass=String(b.password||''),credits=Number(b.credits||0);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||pass.length<10||pass.length>128||!Number.isInteger(credits)||credits<0||credits>1000)throw new HttpError(400,'请输入有效邮箱、10–128 位密码及 0–1000 次初始额度');
  if(await first('SELECT id FROM users WHERE email=?',email))throw new HttpError(409,'该邮箱已存在');
  const id=random();await db().batch([stmt("INSERT INTO users(id,email,password,created_at,role) VALUES(?,?,?,?,'customer')",id,email,await password(pass),now),stmt('INSERT INTO ledger(id,user_id,delta,created_at) VALUES(?,?,?,?)','admin-create:'+id,id,credits,now),stmt('INSERT INTO account_events(id,user_id,action,created_at) VALUES(?,?,?,?)',random(),id,'admin-created',now)]);return json({ok:true,id});
 }
 if(action==='admin'&&path[1]==='codes'&&req.method==='POST'){
  await requireAdmin(req);const b=await req.json() as any,count=Number(b.count||1),credits=Number(b.credits||1);if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(credits)||credits<1||credits>1000)throw new HttpError(400,'数量或额度无效');const generated=Array.from({length:count},()=> 'PD-'+random().toUpperCase());const statements=[];for(const c of generated)statements.push(stmt('INSERT INTO codes(hash,credits,created_at) VALUES(?,?,?)',await hash(c),credits,now));await db().batch(statements);return json({codes:generated})
 }
 if(action==='worker'){
  await secret(req,'WORKER_TOKEN');await stmt("INSERT INTO runtime(key,value) VALUES('worker_seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(now)).run();
  if(path[1]==='claim'&&req.method==='POST'){await db().batch([stmt("INSERT OR IGNORE INTO ledger(id,user_id,delta,created_at) SELECT 'refund:'||id,user_id,1,? FROM jobs WHERE status='processing' AND lease_until<?",now,now),stmt("UPDATE jobs SET status='failed',error='检测连接中断，额度已退还',updated_at=? WHERE status='processing' AND lease_until<?",now,now)]);const lease=random();const j=await stmt("UPDATE jobs SET status='processing',lease=?,lease_until=?,updated_at=? WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING id,input_key,filename",lease,now+900000,now).first();return json({job:j?{...j,lease}:null})}
  if(path[1]==='status'&&req.method==='GET'){const state=await first('SELECT status FROM jobs WHERE id=? AND lease=?',path[2],req.headers.get('x-job-lease'));if(!state)throw new HttpError(404,'任务不存在');return json(state)}
  if(['complete','complete-similarity','fail'].includes(path[1])&&req.method==='POST'){const done=await first('SELECT status FROM jobs WHERE id=? AND lease=?',path[2],req.headers.get('x-job-lease'));if(done?.status===(path[1]==='fail'?'failed':'completed'))return json({ok:true})}
  const job=await first('SELECT * FROM jobs WHERE id=? AND lease=? AND status=? AND lease_until>?',path[2],req.headers.get('x-job-lease'),'processing',now);if(!job)throw new HttpError(409,'任务状态不匹配');
  if(path[1]==='heartbeat'&&req.method==='POST'){await stmt('UPDATE jobs SET lease_until=?,updated_at=? WHERE id=?',now+900000,now,job.id).run();return json({ok:true})}
  if(path[1]==='input'&&req.method==='GET'){const obj=await E().BUCKET.get(job.input_key);if(!obj)throw new HttpError(404,'文稿不存在');return new Response(obj.body)}
  if(path[1]==='artifact'&&req.method==='POST'){if(!['ai','similarity','restyled','ai-restyled','similarity-restyled'].includes(path[3]))throw new HttpError(400,'报告类型无效');const bytes=await req.arrayBuffer();if(bytes.byteLength>50*1024*1024||String.fromCharCode(...new Uint8Array(bytes.slice(0,5)))!=='%PDF-')throw new HttpError(400,'无效 PDF');await E().BUCKET.put('reports/'+job.id+'/'+path[3]+'.pdf',bytes);return json({ok:true})}
 if(path[1]==='complete-similarity'&&req.method==='POST'){const b=await req.json() as any;if(!Number.isFinite(b.score)||b.score<0||b.score>100||!/^trn:oid:::\d+:\d+$/.test(b.submissionId||'')||!['chinese','word-minimum','word-limit'].includes(b.reason)||!await E().BUCKET.head('reports/'+job.id+'/similarity.pdf'))throw new HttpError(400,'相似度报告未验证');const explanation=b.reason==='chinese'?'中文文稿不提交 AI 检测；本次仅完成相似度检测':b.reason==='word-minimum'?'文稿不足 AI 检测 350 词下限；本次仅完成相似度检测':'文稿超过 AI 检测 29,500 词上限；本次仅完成相似度检测';await db().batch([stmt("UPDATE jobs SET status='completed',ai_score=NULL,similarity_score=?,layout_version=0,report_sources=?,error=?,updated_at=? WHERE id=?",b.score,JSON.stringify({ai:null,similarity:'Turnitin',submissionId:b.submissionId}),explanation,now,job.id),stmt('DELETE FROM ledger WHERE id=? AND user_id=?','refund:'+job.id,job.user_id)]);return json({ok:true})}
  if(path[1]==='partial-similarity'&&req.method==='POST'){const b=await req.json() as any;if(!Number.isFinite(b.score)||b.score<0||b.score>100||!/^trn:oid:::\d+:\d+$/.test(b.submissionId||'')||!await E().BUCKET.head('reports/'+job.id+'/similarity.pdf'))throw new HttpError(400,'相似度报告未验证');await stmt('UPDATE jobs SET similarity_score=?,report_sources=?,updated_at=? WHERE id=?',b.score,JSON.stringify({ai:null,similarity:'Turnitin',submissionId:b.submissionId}),now,job.id).run();return json({ok:true})}
  if(path[1]==='complete'&&req.method==='POST'){const b=await req.json() as any;for(const s of [b.aiScore,b.similarityScore])if(!Number.isFinite(s)||s<0||s>100)throw new HttpError(400,'无效分数');for(const type of (b.layoutVersion>=2?['ai','similarity','restyled','ai-restyled','similarity-restyled']:['ai','similarity','restyled']))if(!await E().BUCKET.head('reports/'+job.id+'/'+type+'.pdf'))throw new HttpError(409,'报告文件尚未齐全');let sources=null;if(b.sources){if(b.sources.ai!=='ACADEMI.CX'||!['Turnitin','ACADEMI.CX'].includes(b.sources.similarity)||b.sources.similarity==='Turnitin'&&!/^trn:oid:::\d+:\d+$/.test(b.sources.submissionId||''))throw new HttpError(400,'报告来源无效');sources=JSON.stringify({ai:b.sources.ai,similarity:b.sources.similarity,submissionId:b.sources.similarity==='Turnitin'?b.sources.submissionId:undefined})}await db().batch([stmt("UPDATE jobs SET status='completed',error=NULL,ai_score=?,similarity_score=?,layout_version=?,report_sources=?,updated_at=? WHERE id=?",b.aiScore,b.similarityScore,b.layoutVersion>=3?3:b.layoutVersion>=2?2:0,sources,now,job.id),stmt('DELETE FROM ledger WHERE id=? AND user_id=?','refund:'+job.id,job.user_id)]);return json({ok:true})}
  if(path[1]==='fail'&&req.method==='POST'){const b=await req.json() as any;const reason=({pending:'官网报告暂未取回，原提交已保留，额度已退还；请联系支持恢复，勿重复上传',similarity:'相似度报告生成失败或等待超时，已保留诊断资料，额度已退还',validation:'报告与原文校验未通过，额度已退还；请联系支持核对原文',aiPreflight:'文稿超过 AI 检测 30,000 词上限，未提交检测，额度已退还',aiLimit:'AI 检测超过上游 30,000 词限制；相似度报告可下载，检测额度已退还',layout:'报告排版未完成，请联系支持检查字体或原文格式，额度已退还',upstream:'检测服务暂不可用，已自动重试，额度已退还'} as Record<string,string>)[b.reason]||'检测未完成，额度已退还';await db().batch([stmt("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?",reason,now,job.id),stmt('INSERT OR IGNORE INTO ledger(id,user_id,delta,created_at) VALUES(?,?,1,?)','refund:'+job.id,job.user_id,now)]);return json({ok:true})}
 }
 throw new HttpError(404,'接口不存在');
 }catch(e:any){if(!(e instanceof HttpError))console.error('API error',e.message);return json({error:e instanceof HttpError?e.message:'服务暂不可用，请稍后再试'},e instanceof HttpError?e.status:503)}}
export const GET=handle;export const POST=handle;
