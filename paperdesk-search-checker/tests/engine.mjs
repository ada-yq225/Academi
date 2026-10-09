import test from 'node:test';import assert from 'node:assert/strict';import {checkDocument} from '../engine.mjs';
const text='This completely public article has a sufficiently long sentence for the search retrieval process.';
const unavailable={searchWeb:async()=>{throw Error('search timeout')},searchScholarly:async()=>{throw Error('search timeout')},fetchSource:async()=>{throw Error('fetch failure')}};
test('Unavailable retrieval is unknown, never zero or clean',async()=>{const r=await checkDocument({text},()=>{},unavailable);assert.equal(r.status,'unavailable');assert.equal(r.similarity,null);assert.equal(r.diagnostics.length,2);});
test('Bad fulltext can use abstract only with explicit scope',async()=>{const providers={...unavailable,searchScholarly:async()=>[{url:'https://example.org/paper',title:'paper',abstract:text}]};const r=await checkDocument({text},()=>{},providers);assert.equal(r.status,'partial');assert.equal(r.similarity,100);assert.equal(r.results[0].sources[0].scope,'仅摘要元数据');});
test('No retrieval is needed for user corpus; exact character count uses all sources once',async()=>{const r=await checkDocument({text,maxQueries:0,corpus:[{text}]},()=>{},unavailable);assert.equal(r.similarity,100);assert.equal(r.coverage.querySentences,0);assert.equal(r.diagnostics.length,0);});
test('Candidate limit retains scholarly providers alongside generic web results',async()=>{
 const candidates=(provider,count)=>Array.from({length:count},(_,i)=>({url:`https://example.org/${provider}/${i}`,title:provider,provider}));
 const fetched=[];const providers={searchWeb:async()=>candidates('web',80),searchArxiv:async()=>candidates('arxiv',3),searchEuropePMC:async()=>candidates('pmc',3),fetchSource:async c=>{fetched.push(c);return {...c,text,scope:'开放论文PDF全文'};}};
 const r=await checkDocument({text,maxQueries:1},()=>{},providers);
 assert.equal(fetched.length,60);assert.equal(fetched.filter(c=>c.provider==='arxiv').length,3);assert.equal(fetched.filter(c=>c.provider==='pmc').length,3);
 assert.equal(r.coverage.unfetchedCandidates,26);assert.equal(r.coverage.providers.arXiv.successes,1);assert.equal(r.coverage.fulltextSources,60);
});
test('A slow source does not prevent freed workers from reading later candidates',async()=>{
 let release;const blocked=new Promise(r=>release=r),started=[];
 const providers={searchWeb:async()=>Array.from({length:5},(_,i)=>({url:'https://example.org/'+i,provider:'web'})),fetchSource:async c=>{const i=Number(c.url.split('/').at(-1));started.push(i);if(i===0)await blocked;return {...c,text,scope:'test'};}};
 const job=checkDocument({text,maxQueries:1},()=>{},providers);await new Promise(r=>setTimeout(r,10));
 try{assert.ok(started.includes(4));}finally{release();}await job;
});
test('Preferred fulltext survives the candidate limit without dropping provider diversity',async()=>{
 const requested=[];const providers={searchWeb:async()=>[...Array.from({length:70},(_,i)=>({url:'https://example.org/paper/'+i,provider:'web'})),{url:'https://aclanthology.org/N19-1423.pdf',provider:'web'}],fetchSource:async c=>{requested.push(c.url);return {...c,text,scope:'test'};}};
 await checkDocument({text,maxQueries:1},()=>{},providers);assert.ok(requested.includes('https://aclanthology.org/N19-1423.pdf'));assert.equal(requested.length,60);
});
test('A cooldown remains a failure diagnostic while supplied abstract evidence is retained',async()=>{
 const providers={searchWeb:async()=>[{url:'https://example.org/restricted',abstract:text}],fetchSource:async()=>{const e=Error('HTTP 403（该网址短期冷却）');e.httpStatus=403;e.cachedFailure=true;throw e;}};
 const r=await checkDocument({text,maxQueries:1},()=>{},providers);assert.equal(r.status,'partial');assert.equal(r.diagnostics[0].failureKind,'access-restricted');assert.equal(r.diagnostics[0].cachedFailure,true);assert.equal(r.results[0].sources[0].scope,'仅摘要元数据');
});
