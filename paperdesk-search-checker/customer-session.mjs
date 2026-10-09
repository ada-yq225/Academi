import {randomUUID} from 'node:crypto';
export function sessionId(cookie=''){const value=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('paperdesk_session='))?.slice(18);return /^[a-f0-9-]{36}$/.test(value||'')?value:null;}
export function originMatches(origin,host){if(!origin)return true;try{const url=new URL(origin);return ['http:','https:'].includes(url.protocol)&&url.host===host;}catch{return false;}}
export function customerSession(req,res,next){let id=sessionId(req.headers.cookie);if(!id){id=randomUUID();const secure=req.headers['x-forwarded-proto']==='https'||req.secure;res.append('Set-Cookie',`paperdesk_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure?'; Secure':''}`);}req.customerId=id;next();}
