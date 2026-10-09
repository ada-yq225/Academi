// Only short, per-URL cooldowns. One protected paper must never block a whole
// publisher or make a failed retrieval appear successful.
export function failureKind(error){
 const message=typeof error==='string'?error:error.message;
 if(/内网|不支持这个来源/.test(message))return 'network-policy';
 if(/超过10 MB/.test(message))return 'size-limit';
 if(/HTTP (401|403)|验证码|验证或访问拒绝/.test(message))return 'access-restricted';
 if(/HTTP (404|410)/.test(message))return 'not-found';
 if(/HTTP 429/.test(message))return 'rate-limit';
 if(/跳转|重定向/.test(message))return 'redirect';
 if(/DNS|ENOTFOUND|EAI_AGAIN/.test(message))return 'dns';
 if(/timeout|超时/i.test(message))return 'timeout';
 if(/HTTP 5\d\d|fetch failed/.test(message))return 'transient-network';
 if(/OCR|正文|文本|登录|可读取/.test(message))return 'unreadable';
 return 'other';
}
export class FailureCooldown{
 constructor({now=Date.now,limit=200}={}){this.now=now;this.limit=limit;this.entries=new Map();}
 record(url,error){const kind=failureKind(error);const ms=['access-restricted','not-found','size-limit','unreadable','redirect'].includes(kind)?5*60*1000:30000;this.entries.delete(url);while(this.entries.size>=this.limit)this.entries.delete(this.entries.keys().next().value);this.entries.set(url,{expires:this.now()+ms,reason:error.message,kind,httpStatus:error.httpStatus});}
 get(url){const hit=this.entries.get(url);if(!hit)return null;if(hit.expires<=this.now()){this.entries.delete(url);return null;}return {...hit,retryInSeconds:Math.ceil((hit.expires-this.now())/1000)};}
 clear(url){this.entries.delete(url);}
}
export function sourcePriority(candidate){
 if(candidate.provider==='用户指定')return 0;
 try{const u=new URL(candidate.url),host=u.hostname.toLowerCase();
  if(candidate.representation==='fulltext-xml')return 1;
  if(/^(?:www\.)?(?:arxiv\.org|jmlr\.org|proceedings\.mlr\.press|aclanthology\.org|proceedings\.neurips\.cc|papers\.nips\.cc|cjig\.cn)$/.test(host))return /\.pdf(?:$|\?)|\/pdf\//i.test(u.pathname+u.search)?1:2;
 }catch{}
 return 3; // Other sources remain eligible; no permanent publisher blacklist.
}
