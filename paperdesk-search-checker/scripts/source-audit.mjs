import {download,extractHtml,extractXml,extractEmbeddedArticleText,pdfText} from '../retrieval.mjs';
import {load} from 'cheerio';
import {mkdir,writeFile} from 'node:fs/promises';
const targets=[
 ['crossref','Crossref 元数据 API','metadata','https://api.crossref.org/works?rows=3&query.bibliographic=Batch%20Normalization'],
 ['epmc-search','Europe PMC 检索 API','search','https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=3&query=fruit%20counting%20AND%20OPEN_ACCESS:Y'],
 ['arxiv-api','arXiv 检索 API','search','https://export.arxiv.org/api/query?search_query=ti:attention&max_results=3'],
 ['ddg','DuckDuckGo 免费搜索','search','https://html.duckduckgo.com/html/?q=Batch%20Normalization%20Ioffe'],
 ['ddg','DuckDuckGo 免费搜索','search','https://html.duckduckgo.com/html/?q=next%20sentence%20prediction%20jointly%20pretrains%20text-pair%20representations'],
 ['epmc-xml','Europe PMC XML 全文','fulltext','https://www.ebi.ac.uk/europepmc/webservices/rest/PMC5426829/fullTextXML'],
 ['epmc-xml','Europe PMC XML 全文','fulltext','https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7699151/fullTextXML'],
 ['arxiv-pdf','arXiv PDF','fulltext','https://arxiv.org/pdf/1502.03167v3'],
 ['arxiv-html','arXiv HTML 全文','fulltext','https://arxiv.org/html/1706.03762v6'],
 ['jmlr','JMLR 开放期刊','fulltext','https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf'],
 ['jmlr-page','JMLR 论文页面','abstract','https://jmlr.org/papers/v15/srivastava14a.html'],
 ['pmlr','PMLR 会议全文','fulltext','https://proceedings.mlr.press/v37/ioffe15.pdf'],
 ['acl','ACL Anthology 会议全文','fulltext','https://aclanthology.org/N19-1423.pdf'],
 ['acl-page','ACL 论文页面','abstract','https://aclanthology.org/N19-1423/'],
 ['neurips','NeurIPS 会议全文','fulltext','https://proceedings.neurips.cc/paper_files/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf'],
 ['neurips','NeurIPS 会议全文','fulltext','https://proceedings.neurips.cc/paper_files/paper/2025/file/bc97207e3979d1cc23109db0be0e8ed2-Paper-Conference.pdf'],
 ['openreview','OpenReview PDF','fulltext','https://openreview.net/pdf?id=RIZCe7BuEp'],
 ['cjig','中国图象图形学报正文','fulltext','https://cjig.cn/zh/article/doi/10.11834/jig.180402/'],
 ['sciencedirect','ScienceDirect 文章页面','article-page','https://www.sciencedirect.com/science/article/pii/S0925231224014723'],
 ['springer','Springer DOI 文章页面','article-page','https://doi.org/10.1007/11510888_23'],
 ['ieee','IEEE DOI 文章页面','article-page','https://doi.org/10.1109/radar.2008.4720850'],
 ['taylor','Taylor & Francis DOI 页面','article-page','https://doi.org/10.1080/15235882.2004.10162614'],
 ['mitpress','MIT Press DOI 页面','article-page','https://doi.org/10.7551/mitpress/7475.003.0007'],
 ['zhihu','知乎文章页面','web','https://zhuanlan.zhihu.com/p/70758906'],
 ['csdn','CSDN 文章页面','web','https://blog.csdn.net/qq_53171460/article/details/144721510']
].map(([id,label,role,url])=>({id,label,role,url}));
function validate(target,response){
 const s=response.buffer.toString('utf8'),type=response.type;
 if(/pdf/.test(type)||response.buffer.subarray(0,5).toString()==='%PDF-')return pdfText(response.buffer).then(text=>{if(text.length<500)throw Error('PDF文本不足或需要OCR');return {characters:text.length,evidence:'PDF全文'};});
 if(target.id==='crossref'){const j=JSON.parse(s);if(!j.message?.items)throw Error('元数据结构错误');return {candidates:j.message.items.length,evidence:'仅元数据'};}
 if(target.id==='epmc-search'){const j=JSON.parse(s);if(!j.resultList)throw Error('检索结构错误');return {candidates:j.resultList.result?.length||0,evidence:'检索结果'};}
 if(target.id==='arxiv-api'){const $=load(s,{xmlMode:true});if(!$('feed').length||$('entry id').text().includes('/errors'))throw Error('arXiv响应错误');return {candidates:$('entry').length,evidence:'检索结果'};}
 if(target.id==='ddg'){if(/anomaly\.js|challenge-form|bots use DuckDuckGo/i.test(s))throw Error('搜索验证码');const $=load(s);const count=$('.result__a').length;if(!count)throw Error('没有搜索结果或页面格式改变');return {candidates:count,evidence:'检索结果'};}
 if(/xml/.test(type)){const {text}=extractXml(s);if(text.length<500)throw Error('XML正文不足');return {characters:text.length,evidence:'XML全文'};}
 const {title,text}=extractHtml(s);if(/just a moment|access denied|verify you are human|captcha/i.test(title)||/challenge-form|enable javascript and cookies to continue/i.test(text))throw Error('验证或访问拒绝页面');
 if(target.id==='cjig'){const body=extractEmbeddedArticleText(s);if(body.length<500)throw Error('没有结构化论文正文');return {characters:body.length,evidence:'结构化全文'};}
 if(text.length<500)throw Error('正文不足或需要登录');
 if(target.id==='arxiv-html'&&!/ltx_para|ltx_document/.test(s))throw Error('没有arXiv HTML论文正文');
 return {characters:text.length,evidence:target.role==='fulltext'?'HTML全文':target.role==='abstract'?'摘要/论文页面':target.role==='article-page'?'文章页面（未验证完整全文）':'可访问网页'};
}
await mkdir('test-expanded',{recursive:true});const startedAt=new Date().toISOString(),attempts=[];
for(let round=1;round<=3;round++){
 let index=0;await Promise.all(Array.from({length:3},async()=>{while(index<targets.length){const target=targets[index++],start=Date.now();let record;
  try{const response=await download(target.url,{}, {timeoutMs:15000,retries:0});const detail=await validate(target,response);record={...target,round,ok:true,status:response.status,finalUrl:response.url,bytes:response.buffer.length,...detail};}
  catch(error){record={...target,round,ok:false,status:error.httpStatus||null,error:error.message,code:error.cause?.code||error.code||null,finalUrl:error.url||null};}
  record.seconds=Number(((Date.now()-start)/1000).toFixed(2));record.checkedAt=new Date().toISOString();attempts.push(record);console.log(`${round} ${target.id} ${record.ok?'OK':record.error} ${record.seconds}s`);
 }}));await writeFile('test-expanded/source-audit-progress.json',JSON.stringify({startedAt,attempts},null,2));
}
const groups=Object.values(Object.groupBy(attempts,x=>x.id)).map(rows=>{const successes=rows.filter(x=>x.ok),times=successes.map(x=>x.seconds).sort((a,b)=>a-b);return {id:rows[0].id,label:rows[0].label,role:rows[0].role,checks:rows.length,successes:successes.length,successRate:Math.round(successes.length/rows.length*100),medianSeconds:times.length?times[Math.floor(times.length/2)]:null,distinctUrls:new Set(rows.map(x=>x.url)).size,evidence:[...new Set(successes.map(x=>x.evidence))],errors:[...new Set(rows.filter(x=>!x.ok).map(x=>x.error))],classification:successes.length===rows.length?'本次全通过':successes.length?'本次间歇受限':'本次全部失败'};});
const data={startedAt,generatedAt:new Date().toISOString(),rounds:3,targetCount:targets.length,checks:attempts.length,groups,attempts,notes:['当前本机网络与代理环境的短时实测；不是长期SLA或整个网站覆盖率。','不使用来源缓存；每轮实际发起GET。HTTP成功仍检查验证码、内容类型和可提取文字。','元数据、摘要、文章页面和开放全文分别统计；HTTP 200不等于拿到全文。','每次请求15秒、最多10MB，不自动重试；失效网址、大文件和登录限制单列，不能归因于整站故障。']};
await writeFile('test-expanded/source-audit.json',JSON.stringify(data,null,2));await writeFile('public/samples/source-audit.json',JSON.stringify(data,null,2));console.log(JSON.stringify(groups));
