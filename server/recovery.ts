import{requireAdmin,identity,rate,first,rows,stmt,db,password,hash,random,HttpError}from'../lib/server';
export async function recovery(req:Request,path:string[]){
 const now=Date.now();
 if(path[0]==='forgot-password'&&req.method==='POST'){
  await rate(req,'password-help',5);const b=await req.json() as any,email=String(b.email||'').trim().toLowerCase(),contact=String(b.contact||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||contact.length<3||contact.length>500)throw new HttpError(400,'请填写注册邮箱和可联系到你的方式');const id=random();await stmt('INSERT INTO password_requests(id,email,contact,created_at) VALUES(?,?,?,?)',id,email,contact,now).run();return{ok:true,reference:id.slice(0,12)};
 }
 if(path[0]==='change-password'&&req.method==='POST'){
  const u=await identity(req);if(!u)throw new HttpError(401,'请先登录');await rate(req,'change-password',10);const b=await req.json() as any,newPass=String(b.password||''),old=String(b.currentPassword||'');if(newPass.length<10||newPass.length>128)throw new HttpError(400,'新密码需为 10–128 位');const stored=(await first('SELECT password FROM users WHERE id=?',u.id)).password;if(await hash(await password(old,stored.split(':')[0]))!==await hash(stored))throw new HttpError(401,'当前密码不正确');await db().batch([stmt('UPDATE users SET password=?,must_change_password=0 WHERE id=?',await password(newPass),u.id),stmt('DELETE FROM sessions WHERE user_id=?',u.id),stmt('INSERT INTO account_events(id,user_id,action,created_at) VALUES(?,?,?,?)',random(),u.id,'password-changed',now)]);return{ok:true};
 }
 await requireAdmin(req);
 if(path[1]==='password-requests'&&req.method==='GET')return{requests:await rows('SELECT r.*,u.id user_id FROM password_requests r LEFT JOIN users u ON u.email=r.email ORDER BY r.created_at DESC LIMIT 200')};
 if(path[1]==='reset-password'&&req.method==='POST'){
  await rate(req,'admin-reset',30);const b=await req.json() as any;const u=await first("SELECT id,email FROM users WHERE id=? AND role='customer'",String(b.userId||''));if(!u)throw new HttpError(404,'客户账号不存在');if(b.verified!==true)throw new HttpError(400,'请先核实客户身份');const temp='Reset-'+random()+ '!';await db().batch([stmt('UPDATE users SET password=?,must_change_password=1 WHERE id=?',await password(temp),u.id),stmt('DELETE FROM sessions WHERE user_id=?',u.id),stmt("UPDATE password_requests SET status='resolved' WHERE email=? AND status='pending'",u.email),stmt('INSERT INTO account_events(id,user_id,action,created_at) VALUES(?,?,?,?)',random(),u.id,'admin-password-reset',now)]);return{email:u.email,temporaryPassword:temp};
 }
 if(path[1]==='retry-job'&&req.method==='POST'){
  const b=await req.json() as any,j=await first('SELECT * FROM jobs WHERE id=?',String(b.jobId||''));if(!j)throw new HttpError(404,'任务不存在');if(j.status!=='failed')throw new HttpError(409,'只有失败任务可以重试');if(await first("SELECT id FROM jobs WHERE user_id=? AND filename=? AND status IN ('queued','processing')",j.user_id,j.filename))throw new HttpError(409,'同一客户的同名文件正在处理中');const r=await stmt("UPDATE jobs SET status='queued',error=NULL,lease=NULL,lease_until=NULL,deleted_at=NULL,updated_at=? WHERE id=? AND status='failed'",now,j.id).run();if(!r.meta.changes)throw new HttpError(409,'任务状态已变化');await stmt('INSERT INTO account_events(id,user_id,action,created_at) VALUES(?,?,?,?)',random(),j.user_id,'admin-retry-job',now).run();return{ok:true};
 }
 throw new HttpError(404,'接口不存在');
}
