import {env} from '../server/runtime.mjs';
export const E=()=>env as any;
export const db=()=>{if(!E().DB)throw Error('数据服务尚未配置');return E().DB};
export const stmt=(sql:string,...args:any[])=>db().prepare(sql).bind(...args);
export const first=async(sql:string,...args:any[])=>stmt(sql,...args).first();
export const rows=async(sql:string,...args:any[])=>(await stmt(sql,...args).all()).results;
export const hash=async(s:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
export const random=()=>crypto.randomUUID().replaceAll('-','');
export async function password(value:string,salt=random()){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256);return salt+':'+Buffer.from(bits).toString('hex')}
export async function identity(req:Request){const raw=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('pd_session='))?.slice(11);if(!raw)return null;return first('SELECT u.id,u.email,u.role,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',await hash(raw),Date.now())}
export async function requireUser(req:Request){const u=await identity(req);if(!u)throw new HttpError(401,'请先登录');if(u.must_change_password)throw new HttpError(403,'请先修改临时密码');return u}
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export async function rate(req:Request,name:string,limit=15){const bucket=Math.floor(Date.now()/900000);const key=await hash(name+':'+(req.headers.get('x-verified-client-ip')||'local')+':'+bucket);const r=await stmt('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',key,Date.now()+900000).first();if(r.count>limit)throw new HttpError(429,'操作过于频繁，请稍后再试')}
export const balance=async(id:string)=>(await first('SELECT COALESCE(SUM(delta),0) AS balance FROM ledger WHERE user_id=?',id)).balance;
export function origin(req:Request){const o=req.headers.get('origin');if(o&&o!==new URL(req.url).origin)throw new HttpError(403,'请求来源不匹配')}
export async function secret(req:Request,key:string){const configured=E()[key];const supplied=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!configured||!supplied||await hash(configured)!==await hash(supplied))throw new HttpError(401,'无权访问')}
export const products=()=>{const configured=E().PRODUCT_PRICES?JSON.parse(E().PRODUCT_PRICES):{};return [{id:'single',name:'单次检测',credits:1,price:configured.single||0},{id:'five',name:'5 次检测包',credits:5,price:configured.five||0},{id:'twenty',name:'20 次检测包',credits:20,price:configured.twenty||0}]};
export async function signature(key:string,text:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(text))).toString('hex')}

export async function requireAdmin(req:Request){if(req.headers.has("authorization")){await secret(req,"ADMIN_TOKEN");return}const u=await requireUser(req);if(u.role!=="admin")throw new HttpError(403,"仅管理员可访问");if(req.method!=="GET")origin(req);}
