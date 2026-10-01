import {requireUser,origin,rate,rows,first,stmt,HttpError} from '../lib/server';
export async function support(req:Request,path:string[]){
 const u=await requireUser(req),admin=u.role==='admin',url=new URL(req.url);
 if(req.method==='POST')origin(req);
 if(path[1]==='threads'&&req.method==='GET'){
  if(!admin)throw new HttpError(403,'仅管理员可访问');
  return {threads:await rows(`SELECT u.id,u.email,m.body preview,m.created_at,
   (SELECT COUNT(*) FROM support_messages x WHERE x.customer_id=u.id AND x.sender_role='customer' AND x.id>COALESCE((SELECT last_id FROM support_reads WHERE customer_id=u.id AND reader_id=?),0)) unread
   FROM users u JOIN support_messages m ON m.id=(SELECT MAX(id) FROM support_messages WHERE customer_id=u.id)
   ORDER BY m.id DESC LIMIT 500`,u.id)};
 }
 const customer=admin?(url.searchParams.get('customer')||u.id):u.id;
 if(!customer||!await first('SELECT id FROM users WHERE id=?',customer))throw new HttpError(404,'客户不存在');
 if(!admin&&url.searchParams.has('customer')&&url.searchParams.get('customer')!==u.id)throw new HttpError(403,'不能访问其他客户会话');
 if(path[1]==='messages'&&req.method==='GET'){
  const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)throw new HttpError(400,'无效分页');
  const messages=await rows('SELECT id,sender_role,body,created_at FROM support_messages WHERE customer_id=? AND id<? ORDER BY id DESC LIMIT 100',customer,before);
  const unread=await first('SELECT COUNT(*) n FROM support_messages WHERE customer_id=? AND sender_role=? AND id>COALESCE((SELECT last_id FROM support_reads WHERE customer_id=? AND reader_id=?),0)',customer,admin?'customer':'admin',customer,u.id);
  return {messages:messages.reverse(),unread:unread.n};
 }
 if(path[1]==='messages'&&req.method==='POST'){
  await rate(req,'support-'+u.id,100);const b=await req.json() as any,body=String(b.body||'').trim(),requestId=String(b.requestId||'');
  if(!body||body.length>2000||!/^[-a-zA-Z0-9]{16,64}$/.test(requestId))throw new HttpError(400,'消息需为 1–2000 字');
  const existing=await first('SELECT id,customer_id FROM support_messages WHERE sender_id=? AND request_id=?',u.id,requestId);if(existing&&existing.customer_id!==customer)throw new HttpError(409,'消息编号已使用');
  await stmt('INSERT OR IGNORE INTO support_messages(customer_id,sender_id,sender_role,body,request_id,created_at) VALUES(?,?,?,?,?,?)',customer,u.id,admin?'admin':'customer',body,requestId,Date.now()).run();return {ok:true};
 }
 if(path[1]==='read'&&req.method==='POST'){
  const b=await req.json() as any,last=Number(b.lastId);if(!Number.isSafeInteger(last)||last<1||!await first('SELECT id FROM support_messages WHERE id=? AND customer_id=?',last,customer))throw new HttpError(400,'无效消息');
  await stmt('INSERT INTO support_reads(customer_id,reader_id,last_id) VALUES(?,?,?) ON CONFLICT(customer_id,reader_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)',customer,u.id,last).run();return {ok:true};
 }
 throw new HttpError(404,'接口不存在');
}
