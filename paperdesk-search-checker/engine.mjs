import {compare,sentences,tokens} from './matcher.mjs';
import {queryForSentence} from './query.mjs';
import {searchWeb,searchScholarly,searchArxiv,searchEuropePMC,searchOpenVenues,fetchSource} from './retrieval.mjs';
import {sourcePriority,failureKind} from './source-policy.mjs';
const defaults={searchWeb,searchScholarly,searchArxiv,searchEuropePMC,searchOpenVenues,fetchSource};
export async function checkDocument({text,urls=[],corpus=[],maxQueries=6},progress=()=>{},providers=defaults){
 const diagnostics=[],sources=[],candidates=new Map(),providerStats={};let successes=0,completed=0;const queries=[];
 const eligible=sentences(text).filter(s=>tokens(s.text).length>=5),selected=[],n=Math.min(maxQueries,eligible.length);
 for(let i=0;i<n;i++)selected.push(eligible[Math.floor(i*eligible.length/n)]);
 function add(item){try{const url=new URL(item.url);url.hash='';item.url=url.href;const old=candidates.get(item.url);if(!old)candidates.set(item.url,item);else if(item.abstract&&!old.abstract)candidates.set(item.url,{...old,abstract:item.abstract});}catch{}}
 urls.forEach(url=>add({url,title:url,provider:'用户指定'}));
 const providerDefinitions=[['searchWeb','网页检索'],['searchScholarly','Crossref'],['searchArxiv','arXiv'],['searchEuropePMC','Europe PMC'],['searchOpenVenues','开放期刊会议网站']].filter(([key])=>providers[key]);
 for(const [i,s] of selected.entries()){
  progress({stage:'search',message:`多源学术检索 ${i+1}/${selected.length}`,completed:i,total:selected.length});
  const q=queryForSentence(s.text);
  queries.push(q);
  const outcomes=await Promise.allSettled(providerDefinitions.map(([key])=>providers[key](q)));
  for(const [j,[key,label]] of providerDefinitions.entries()){
   const outcome=outcomes[j],stats=providerStats[label]||={calls:0,successes:0,candidates:0,errors:0};stats.calls++;
   if(outcome.status==='fulfilled'){successes++;stats.successes++;stats.candidates+=outcome.value.length;outcome.value.forEach(add);}else{stats.errors++;diagnostics.push({stage:label,query:i+1,error:outcome.reason.message});}
  }
 }
 // Interleave providers so early generic search results cannot displace scholarly sources.
 const groups=new Map();for(const c of candidates.values()){const group=groups.get(c.provider)||[];group.push(c);groups.set(c.provider,group);}
 for(const group of groups.values())group.sort((a,b)=>sourcePriority(a)-sourcePriority(b));
 const maximum=60,selectedCandidates=[];while(selectedCandidates.length<maximum){let added=false;for(const group of groups.values()){if(group.length&&selectedCandidates.length<maximum){selectedCandidates.push(group.shift());added=true;}}if(!added)break;}
 let nextCandidate=0;
 await Promise.all(Array.from({length:Math.min(4,selectedCandidates.length)},async()=>{
  while(nextCandidate<selectedCandidates.length){const candidate=selectedCandidates[nextCandidate++];
   try{const source=await providers.fetchSource(candidate);sources.push(source);if(source.truncated)diagnostics.push({stage:'来源长度限制',url:candidate.url,error:'正文超过50万字符，仅比对已读取部分'});if(source.fulltextWarning)diagnostics.push({stage:'读取PDF',url:candidate.url,error:source.fulltextWarning});}
   catch(e){diagnostics.push({stage:'读取来源',url:candidate.url,error:e.message,failureKind:e.failureKind||failureKind(e),cachedFailure:Boolean(e.cachedFailure),httpStatus:e.httpStatus||null});if(candidate.abstract?.length>80)sources.push({...candidate,text:candidate.abstract,scope:'仅摘要元数据',truncated:false});}
   progress({stage:'fetch',message:`读取学术及网页来源 ${++completed}/${selectedCandidates.length}`,completed,total:selectedCandidates.length});
  }
 }));
 for(const [i,item] of corpus.entries())sources.push({id:'local-'+i,title:item.title||'自有参考文稿',url:null,text:item.text,textVariants:item.textVariants,variantScopes:item.variantScopes,scope:'用户提供参考文稿',provider:'自有语料'});
 sources.forEach((s,i)=>s.id='source-'+(i+1));progress({stage:'compare',message:'比对文字并定位重复片段'});const matches=compare(text,sources);
 return {...matches,similarity:sources.length?matches.similarity:null,status:!sources.length?'unavailable':diagnostics.length?'partial':'complete',diagnostics,coverage:{sentences:sentences(text).length,querySentences:selected.length,successfulSearchCalls:successes,queries,providers:providerStats,cachedSources:sources.filter(s=>s.cacheHit).length,candidates:candidates.size,fetchedCandidates:selectedCandidates.length,readableSources:sources.length,fulltextSources:sources.filter(s=>s.scope?.includes('全文')).length,abstractOnlySources:sources.filter(s=>s.scope==='仅摘要元数据').length,unfetchedCandidates:Math.max(0,candidates.size-maximum),note:'在已获取来源中的文字重复占比；不代表全互联网重复率。未检索片段仍与全部已获取来源比对。'},generatedAt:new Date().toISOString()};
}
