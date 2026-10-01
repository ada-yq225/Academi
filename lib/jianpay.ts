import {createHash,timingSafeEqual} from 'node:crypto';
import {E,db,stmt,first,HttpError} from './server';
export function signParams(p:Record<string,any>,key:string){return createHash('md5').update(Object.keys(p).filter(k=>!['sign','sign_type'].includes(k)&&p[k]!==''&&p[k]!=null).sort().map(k=>k+'='+(typeof p[k]==='object'?JSON.stringify(p[k]):String(p[k]))).join('&')+key).digest('hex')}
export const jianReady=()=>E().PAYMENT_PROVIDER==='jianpay'&&E().PAYMENT_ENABLED==='true'&&!!E().JIANPAY_CLIENT_NO&&!!E().JIANPAY_KEY;
export async function jianCall(endpoint:string,fields:Record<string,any>){
 if(!jianReady())throw new HttpError(503,'简付商户尚未配置完成');
 const gateway=(E().JIANPAY_GATEWAY||'https://jpay.hzjianban.com').replace(/\/+$/,'');
 if(!['https://jpay.hzjianban.com','https://api.jian-pay.com'].includes(gateway))throw new HttpError(503,'简付网关配置无效');
 const body={...fields,clientNo:E().JIANPAY_CLIENT_NO,timestamp:String(Math.floor(Date.now()/1000)),sign_type:'MD5'};
 let response;try{response=await fetch(gateway+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,sign:signParams(body,E().JIANPAY_KEY)}),signal:AbortSignal.timeout(15000)})}catch{throw new HttpError(502,'简付连接超时，请稍后查询订单')}
 if(!response.ok)throw new HttpError(502,'简付服务暂不可用');const result=await response.json() as any;
 if(result.code!==1000||!result.data)throw new HttpError(502,'简付未能处理订单，请检查商户通道或稍后重试');return result.data;
}
export async function settleJian(data:any){
 const o=await first("SELECT * FROM orders WHERE id=? AND provider='jianpay'",data.merchantOrderNo||'');
 if(!o||data.clientNo!==E().JIANPAY_CLIENT_NO||!Number.isSafeInteger(data.amount)||data.amount!==o.amount||o.currency!=='CNY'||typeof data.orderId!=='string'||!data.orderId||o.provider_order_id&&o.provider_order_id!==data.orderId)throw new HttpError(400,'简付订单信息不匹配');
 if(data.status!==2)return {paid:false};
 await db().batch([stmt("UPDATE orders SET status='paid',provider_order_id=? WHERE id=? AND status='pending'",data.orderId,o.id),stmt("INSERT OR IGNORE INTO ledger(id,user_id,delta,created_at) SELECT 'order:'||id,user_id,credits,? FROM orders WHERE id=? AND status='paid'",Date.now(),o.id)]);return {paid:true};
}
export async function jianCallback(req:Request){
 if(!jianReady())throw new HttpError(503,'支付未启用');const raw=await req.text();if(raw.length>20000)throw new HttpError(400,'请求过大');
 let data;try{data=JSON.parse(raw)}catch{throw new HttpError(400,'无效通知')}
 if(!data||Array.isArray(data)||typeof data!=='object')throw new HttpError(400,'无效通知');
 const expected=signParams(data,E().JIANPAY_KEY),sig=String(data.sign||'').toLowerCase();
 if(!/^[a-f0-9]{32}$/.test(sig)||!timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))throw new HttpError(401,'签名不匹配');
 await settleJian(data);return new Response('success',{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
}
