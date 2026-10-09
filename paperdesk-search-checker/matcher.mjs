// Offset-preserving token comparison. Scores measure matched text, not sentence averages.
export function tokens(text) {
 const list=[];const re=/\p{Script=Han}|[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
 for(const m of text.matchAll(re))list.push({value:m[0].normalize('NFKC').toLowerCase().replaceAll('’',"'"),start:m.index,end:m.index+m[0].length});
 return list;
}
export function sentences(text) {
 const result=[];let start=0;
 const add=end=>{let a=start,b=end;while(a<b&&/\s/.test(text[a]))a++;while(b>a&&/\s/.test(text[b-1]))b--;if(b>a)result.push({start:a,end:b,text:text.slice(a,b)});start=end;};
 for(let i=0;i<text.length;i++) {
  const c=text[i];if(c==='\n'||/[。！？!?]/u.test(c)){add(i+1);continue;}
  if(c!=='.')continue;
  const before=text.slice(Math.max(0,i-15),i);
  if(/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||''))continue;
  if(/\b[A-Z]$/.test(before)||/\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|Fig|al)$/i.test(before))continue;
  if(i===text.length-1||/\s/.test(text[i+1]))add(i+1);
 }
 add(text.length);return result;
}
const merge=spans=>{const sorted=spans.map(x=>({...x})).sort((a,b)=>a.start-b.start);const out=[];for(const span of sorted){const last=out.at(-1);if(last&&span.start<=last.end)last.end=Math.max(last.end,span.end);else out.push(span);}return out;};
export function compare(text,sources) {
 const input=tokens(text),parts=sentences(text);const k=5; // Choose the Chinese minimum per anchor, not for the entire bilingual document.
 const weight=t=>[...t.value].length;const total=input.reduce((s,t)=>s+weight(t),0);const covered=new Set();const evidence=[];
 for(const source of sources){
  const sourceTexts=[...new Set([source.text,...(source.textVariants||[])])],corpora=sourceTexts.map(tokens),index=new Map();
  for(const [v,corpus] of corpora.entries())for(let j=0;j<=corpus.length-k;j++){const key=corpus.slice(j,j+k).map(t=>t.value).join('\u0001');const found=index.get(key)||[];if(found.length<64)found.push({j,v});index.set(key,found);}
  const hits=[];let until=-1;
  for(let i=0;i<=input.length-k;i++){
   if(i<until)continue;const key=input.slice(i,i+k).map(t=>t.value).join('\u0001');let best;
   for(const {j,v} of index.get(key)||[]){const corpus=corpora[v];let n=k;while(i+n<input.length&&j+n<corpus.length&&input[i+n].value===corpus[j+n].value)n++;if(!best||n>best.n)best={j,n,v};}
   const minimum=input.slice(i,i+5).filter(t=>/\p{Script=Han}/u.test(t.value)).length>=3?10:5;
   if(!best||best.n<minimum)continue;until=i+best.n;
   for(let z=i;z<until;z++)covered.add(z);
   hits.push({start:input[i].start,end:input[until-1].end,variant:best.v,sourceStart:corpora[best.v][best.j].start,sourceEnd:corpora[best.v][best.j+best.n-1].end});
  }
  if(hits.length)evidence.push({...source,text:undefined,textVariants:undefined,hits,sourceTexts});
 }
 const results=parts.map((part,i)=>{
  const matched=[];const spans=[];
  for(const source of evidence){const overlaps=source.hits.filter(h=>h.start<part.end&&h.end>part.start);if(!overlaps.length)continue;
   const ranges=overlaps.map(h=>({start:Math.max(h.start,part.start)-part.start,end:Math.min(h.end,part.end)-part.start}));spans.push(...ranges);
   matched.push({id:source.id,url:source.url,title:source.title,scope:[...new Set(overlaps.map(h=>source.variantScopes?.[h.variant]||source.scope))].join(' / '),spans:merge(ranges),excerpt:source.sourceTexts[overlaps[0].variant].slice(Math.max(0,overlaps[0].sourceStart-35),overlaps[0].sourceStart+220)});
  }
  const all=input.map((t,n)=>({t,n})).filter(({t})=>t.start>=part.start&&t.end<=part.end),denominator=all.reduce((s,{t})=>s+weight(t),0),numerator=all.reduce((s,{t,n})=>s+(covered.has(n)?weight(t):0),0);
  return {index:i+1,...part,spans:merge(spans),sources:matched,matchedCharacters:numerator,totalCharacters:denominator,similarity:denominator?Math.round(100*numerator/denominator):0};
 });
 const matchedCharacters=[...covered].reduce((s,i)=>s+weight(input[i]),0);
 return {similarity:total?Math.round(100*matchedCharacters/total):null,matchedCharacters,totalCharacters:total,minMatchTokens:k,matchThresholds:{english:5,chinese:10},results,sources:evidence.map(({sourceTexts,hits,...s})=>s)};
}
