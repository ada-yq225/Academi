import {load} from 'cheerio';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FailureCooldown} from './source-policy.mjs';
const exec=promisify(execFile);
export function blockedIp(ip){
 if(ip.includes(':'))return !/^[23][0-9a-f]{3}:/i.test(ip); // Public global IPv6 only; reject mapped/local addresses.
 const [a,b]=ip.split('.').map(Number);return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19);
}
const trustedDnsHosts=new Set(['api.crossref.org','export.arxiv.org','www.ebi.ac.uk','html.duckduckgo.com']);
const trustedDnsCache=new Map(),dnsInFlight=new Map();
async function publicAddresses(host){
 const hit=trustedDnsCache.get(host);if(hit&&hit.expires>Date.now())return hit.addresses;
 if(dnsInFlight.has(host))return dnsInFlight.get(host);
 let timer;const task=Promise.race([lookup(host,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS解析超时')),8000);})]).then(addresses=>{
  if(!addresses.length||addresses.some(a=>blockedIp(a.address)))throw Error('不能访问内网地址');
  if(trustedDnsHosts.has(host))trustedDnsCache.set(host,{addresses,expires:Date.now()+5*60*1000});
  return addresses;
 }).finally(()=>{clearTimeout(timer);dnsInFlight.delete(host);});dnsInFlight.set(host,task);return task;
}
export async function safeUrl(value){
 const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw Error('不支持这个来源地址');
 const host=u.hostname.replace(/^\[|\]$/g,'');if(host==='localhost'||host.endsWith('.local'))throw Error('不能访问本机或内网地址');
 const addresses=isIP(host)?[{address:host}]:await publicAddresses(host);if(!addresses.length||addresses.some(a=>blockedIp(a.address)))throw Error('不能访问内网地址');return u;
}
async function downloadOnce(value,headers={},options={}){
 let u=await safeUrl(value);const signal=AbortSignal.timeout(options.timeoutMs||20000),visited=new Set();
 for(let redirects=0;redirects<5;redirects++){
  if(visited.has(u.href))throw Error('来源重定向循环');visited.add(u.href);
  const r=await fetch(u,{redirect:'manual',signal,headers:{'User-Agent':'PaperDeskResearchChecker/0.1',...headers}});
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');await r.body?.cancel();if(!location)throw Error('来源跳转缺少地址');u=await safeUrl(new URL(location,u).href);continue;}
  if(!r.ok){await r.body?.cancel();const error=Error('HTTP '+r.status);error.httpStatus=r.status;error.url=u.href;error.retryAfter=r.headers.get('retry-after');throw error;}
  const reader=r.body.getReader();const buffers=[];let bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>10*1024*1024){await reader.cancel();throw Error('来源文件超过10 MB');}buffers.push(Buffer.from(value));}
  return {url:u.href,type:r.headers.get('content-type')||'',status:r.status,buffer:Buffer.concat(buffers)};
 }
 throw Error('来源跳转过多');
}
export async function download(value,headers={},options={}){
 for(let attempt=0;;attempt++){
  try{const response=await downloadOnce(value,headers,options);return {...response,attempts:attempt+1};}catch(e){
   if(attempt>=(options.retries??1)||!(/HTTP (429|500|502|503|504)$|timeout|fetch failed/i.test(e.message)))throw e;
   const seconds=Number(e.retryAfter),date=Date.parse(e.retryAfter);const wait=Number.isFinite(seconds)&&seconds>=0?seconds*1000:Number.isFinite(date)?Math.max(0,date-Date.now()):1500;
   if(wait>30000)throw e; // Do not ignore a long provider cooldown.
   await new Promise(r=>setTimeout(r,Math.max(1500,wait)));
  }
 }
}
export function normalizeExtractedText(text){return text.replace(/\u00ad/g,'').replace(/([\p{L}])-\s*\n\s*(?=\p{L})/gu,'$1');}
export function extractXml(xml){
 const $=load(xml,{xmlMode:true});$('script,style').remove();$('p,sec,title,abstract,ref,table').each((_,e)=>$(e).append('\n'));
 const text=$.root().text().replace(/[ \t]+/g,' ').trim();return {text:text.slice(0,500000),truncated:text.length>500000};
}
export function extractHtml(html){
 const $=load(html);const title=$('title').first().text().trim();$('script,style,nav,header,footer,aside,noscript,form,button,svg,[role=navigation]').remove();
 $('p,div,section,article,h1,h2,h3,li,br').each((_,e)=>$(e).append(' '));
 const text=$('body').text().replace(/\s+/g,' ').trim(); // Keep complete visible body, never cut before article content.
 return {title,text:text.slice(0,500000),truncated:text.length>500000};
}
export function extractEmbeddedArticleText(html){
 const parts=[];for(const m of html.matchAll(/\bdata:"((?:\\.|[^"\\])*)"/g)){
  try{const value=JSON.parse('"'+m[1]+'"');if(typeof value==='string'&&value.length>=30&&!value.includes('<script'))parts.push(value);}catch{}
  if(parts.length>=5000)break;
 }
 return [...new Set(parts)].join('\n').slice(0,500000);
}
export async function pdfText(buffer){
 const folder=await mkdtemp(path.join(tmpdir(),'paperdesk-extract-'));
 try{const file=path.join(folder,'document.pdf');await writeFile(file,buffer);const {stdout}=await exec(process.env.PYTHON_BIN||'python3',['-c','import sys;from pypdf import PdfReader;r=PdfReader(sys.argv[1]);print("\\n".join((p.extract_text() or "") for p in r.pages))',file],{timeout:25000,maxBuffer:4*1024*1024});return stdout.replace(/\u00ad/g,'');}finally{await rm(folder,{recursive:true,force:true});}
}
async function fetchSourceUncached(candidate){
 const response=await download(candidate.url);let text,title=candidate.title,truncated=false;
 if(response.type.includes('pdf')||response.buffer.subarray(0,5).toString()==='%PDF-')text=await pdfText(response.buffer);
 else if(response.type.includes('html')){const extracted=extractHtml(response.buffer.toString('utf8'));if(/^(?:just a moment|access denied|verify you are human)/i.test(extracted.title)||/challenge-form|enable javascript and cookies to continue/i.test(extracted.text))throw Error('来源返回验证或访问拒绝页面，未取得正文');text=extracted.text;title=extracted.title||title;truncated=extracted.truncated;}
 else if(response.type.includes('xml')){const extracted=extractXml(response.buffer.toString('utf8'));text=extracted.text;truncated=extracted.truncated;}
 else if(response.type.includes('text/plain'))text=response.buffer.toString('utf8');
 else throw Error('来源不包含可读取的文本');
 if(!text||text.length<80)throw Error('来源全文不可读取，可能需要登录或OCR');
 let scope=candidate.representation==='fulltext-xml'?'开放论文XML全文':(response.type.includes('pdf')||response.buffer.subarray(0,5).toString()==='%PDF-')?'开放论文PDF全文':'可访问网页文本';
 // Read public embedded article text without executing the site's scripts.
 if(response.type.includes('html')&&/(^|\.)cjig\.cn$/.test(new URL(response.url).hostname)){const embedded=extractEmbeddedArticleText(response.buffer.toString('utf8'));if(embedded.length>80){text+='\n'+embedded;scope='公开网页结构化正文';}}
 // Follow published PDF links on scholarly landing pages, retaining the page if unavailable.
 let pageText,pageScope;
 if(response.type.includes('html')){
  pageText=text;pageScope=scope;const $=load(response.buffer.toString('utf8'));const hint=$('meta[name="citation_pdf_url"]').attr('content');
  const known=/arxiv\.org|jmlr\.org|proceedings\.mlr\.press|aclanthology\.org|papers\.(?:nips|neurips)\.cc/.test(new URL(response.url).hostname);
  const href=hint||(known?$('a[href]').toArray().map(e=>$(e).attr('href')).find(x=>/\.pdf(?:$|\?)/i.test(x)):null);
  if(href){try{const pdf=await download(new URL(href,response.url).href);if(pdf.buffer.subarray(0,5).toString()==='%PDF-'){const full=await pdfText(pdf.buffer);if(full.length>80){text=full;scope='开放论文PDF全文';candidate={...candidate,fulltextUrl:pdf.url};}}}catch(e){candidate={...candidate,fulltextWarning:'PDF全文未读取：'+e.message};}}
 }
 const bounded=text.slice(0,500000),normalized=scope.includes('PDF全文')?normalizeExtractedText(bounded):bounded,variants=[],variantScopes=[scope];
 for(const [value,label] of [[normalized,scope],[pageText,pageScope],[candidate.abstract,'仅摘要元数据']]){if(value?.length>80&&value!==bounded&&!variants.includes(value)){variants.push(value.slice(0,500000));variantScopes.push(label);}}
 return {...candidate,url:response.url,title:title||response.url,text:bounded,textVariants:variants,variantScopes,scope,truncated:truncated||text.length>500000};
}
const sourceCache=new Map(),failedSources=new FailureCooldown();let cacheCharacters=0;
export async function fetchSource(candidate){
 const key=candidate.url,now=Date.now(),hit=sourceCache.get(key);
 if(hit&&now-hit.time<30*60*1000)return {...candidate,...hit.source,cacheHit:true};
 if(hit){sourceCache.delete(key);cacheCharacters-=hit.characters;}
 const blocked=failedSources.get(key);if(blocked){const error=Error(blocked.reason+'（该网址短期冷却，'+blocked.retryInSeconds+'秒后可重试）');error.cachedFailure=true;error.httpStatus=blocked.httpStatus;error.failureKind=blocked.kind;throw error;}
 let source;try{source=await fetchSourceUncached(candidate);failedSources.clear(key);}catch(error){failedSources.record(key,error);throw error;}
 const characters=source.text.length+(source.textVariants||[]).reduce((s,t)=>s+t.length,0);
 if(characters<=1000000){while(sourceCache.size>=64||cacheCharacters+characters>8000000){const [key,old]=sourceCache.entries().next().value;sourceCache.delete(key);cacheCharacters-=old.characters;}sourceCache.set(key,{time:now,source,characters});cacheCharacters+=characters;}
 return source;
}
export async function searchWeb(query){
 if(process.env.BRAVE_API_KEY){
  const r=await download('https://api.search.brave.com/res/v1/web/search?count=5&q='+encodeURIComponent(query),{'X-Subscription-Token':process.env.BRAVE_API_KEY});const j=JSON.parse(r.buffer);return (j.web?.results||[]).map(x=>({url:x.url,title:x.title,provider:'Brave'}));
 }
 const r=await download('https://html.duckduckgo.com/html/?q='+encodeURIComponent(query));const $=load(r.buffer.toString());
 if(/anomaly\.js|challenge-form|bots use DuckDuckGo/i.test($.html()))throw Error('免费搜索触发验证，未取得检索结果');
 const candidates=[];$('.result__a').each((_,e)=>{let url=$(e).attr('href');if(!url)return;try{url=new URL(url,'https://html.duckduckgo.com');const target=url.searchParams.get('uddg')||url.href;if(!new URL(target).hostname.endsWith('duckduckgo.com'))candidates.push({url:target,title:$(e).text(),provider:'DuckDuckGo'});}catch{}});return candidates.slice(0,4);
}
let crossrefQueue=Promise.resolve(),lastCrossref=0;
export async function searchScholarly(query){
 const task=crossrefQueue.then(async()=>{
  const pause=Math.max(0,250-(Date.now()-lastCrossref));if(pause)await new Promise(r=>setTimeout(r,pause));lastCrossref=Date.now();
  const url=new URL('https://api.crossref.org/works');url.searchParams.set('rows','5');url.searchParams.set('query.bibliographic',query);if(process.env.CROSSREF_MAILTO)url.searchParams.set('mailto',process.env.CROSSREF_MAILTO);
  const response=await download(url.href);const j=JSON.parse(response.buffer);
  return (j.message?.items||[]).filter(x=>['journal-article','proceedings-article','book-chapter','posted-content'].includes(x.type)).map(x=>({url:x.URL||'https://doi.org/'+x.DOI,title:x.title?.[0]||x.DOI,doi:x.DOI,workType:x.type,provider:'Crossref',abstract:x.abstract?extractHtml(x.abstract).text:''}));
 });crossrefQueue=task.catch(()=>{});return task;
}

let lastArxiv=0;let arxivQueue=Promise.resolve();
export async function searchArxiv(query){
 const task=arxivQueue.then(async()=>{
  const pause=Math.max(0,3100-(Date.now()-lastArxiv));if(pause)await new Promise(r=>setTimeout(r,pause));lastArxiv=Date.now();
  const response=await download('https://export.arxiv.org/api/query?search_query='+encodeURIComponent('all:"'+query.replaceAll('"','')+'"')+'&max_results=3');
  const $=load(response.buffer.toString(),{xmlMode:true});if($('entry id').text().includes('/errors'))throw Error('arXiv查询错误');
  return $('entry').toArray().map(e=>{const entry=$(e),id=entry.find('id').first().text().replace('http:','https:');const raw=entry.find('link[title="pdf"]').attr('href');return {url:(raw||id).replace('http:','https:'),landingUrl:id,title:entry.find('title').text().replace(/\s+/g,' ').trim(),abstract:entry.find('summary').text().replace(/\s+/g,' ').trim(),provider:'arXiv',workType:'预印本/作者公开版本'};});
 });arxivQueue=task.catch(()=>{});return task;
}
export async function searchEuropePMC(query){
 const response=await download('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=3&query='+encodeURIComponent('"'+query.replaceAll('"','')+'" AND OPEN_ACCESS:Y'));
 const j=JSON.parse(response.buffer);return (j.resultList?.result||[]).map(x=>({url:x.pmcid?'https://www.ebi.ac.uk/europepmc/webservices/rest/'+x.pmcid+'/fullTextXML':x.doi?'https://doi.org/'+x.doi:'https://europepmc.org/article/'+x.source+'/'+x.id,title:x.title,abstract:x.abstractText?extractHtml(x.abstractText).text:'',doi:x.doi,provider:'Europe PMC',workType:x.pubTypeList?.pubType?.join(', '),representation:x.pmcid?'fulltext-xml':undefined}));
}
export async function searchOpenVenues(query){
 // Published proceedings and open journal sites; general web search can find other publishers.
 return (await searchWeb(query+' (site:proceedings.mlr.press OR site:jmlr.org OR site:aclanthology.org OR site:papers.nips.cc OR site:openreview.net OR site:proceedings.neurips.cc OR site:cjig.cn)')).map(c=>({...c,provider:'开放期刊会议网站'}));
}
