import test from 'node:test';import assert from 'node:assert/strict';
import {compare,sentences} from '../matcher.mjs';import {extractHtml,blockedIp,safeUrl} from '../retrieval.mjs';
const source=text=>({id:'s',title:'fixture',url:'https://example.org/article',text,scope:'test'});
test('Exact copy late in long page retains original offsets',()=>{const text='He joined NASA’s predecessor, the NACA, as an aeronautical research scientist and pilot in 1955.';const r=compare(text,[source('unrelated navigation '.repeat(1000)+text)]);assert.equal(r.similarity,100);const h=r.results[0].spans[0];assert.equal(text.slice(h.start,h.end),text.slice(0,-1));});
test('Duplicate sources never double count',()=>{const text='We analyze the heat transfer in experimental flow systems.';const r=compare(text,[source(text),{...source(text),id:'s2'}]);assert.equal(r.similarity,100);assert.equal(r.matchedCharacters,r.totalCharacters);});
test('Partial match excludes original introduction',()=>{const text='An entirely new introduction precedes the heat transfer experiments showed significant improvements in efficiency.';const r=compare(text,[source('The heat transfer experiments showed significant improvements in efficiency.')]);assert.ok(r.similarity>30&&r.similarity<100);const h=r.results[0].spans[0];assert.match(text.slice(h.start,h.end),/^the heat transfer/);});
test('Chinese sentence and character spans',()=>{const text='这是原创介绍。我们研究了不同温度条件下材料的导热性能及其变化趋势。';const r=compare(text,[source('我们研究了不同温度条件下材料的导热性能及其变化趋势。')]);assert.equal(r.results.length,2);assert.equal(r.results[0].spans.length,0);assert.equal(r.results[1].similarity,100);});
test('English initials, titles and decimals are preserved',()=>assert.equal(sentences('Dr. John F. Kennedy measured 3.14 units. The second sentence ends here.').length,2));
test('Same vocabulary in different order gives no exact match',()=>assert.equal(compare('flow heat data complex model experimental research.',[source('research experimental model complex data heat flow.')]).similarity,0));
test('HTML extraction retains bottom article beyond 5000 characters',()=>{const r=extractHtml('<body><nav>menu</nav><main>'+('filler '.repeat(1000))+'<p>A copied sentence at the bottom of a scientific article.</p></main>');assert.ok(r.text.includes('A copied sentence'));assert.ok(!r.text.includes('menu'));});
test('Private and mapped addresses blocked',async()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1'])assert.ok(blockedIp(ip));await assert.rejects(safeUrl('http://localhost/'));await assert.rejects(safeUrl('http://127.0.0.1/'));await assert.rejects(safeUrl('file:///etc/passwd'));});
test('Bilingual documents retain short English matches without lowering Chinese minimum',()=>{
 const english='Experimental findings require careful independent validation.';const r=compare('这是一段原创中文背景内容，用来验证混合文稿的英文阈值不会被全文语言比例改变。\n'+english,[source(english)]);
 assert.equal(r.results.at(-1).similarity,100);assert.equal(compare('短中文重复段',[source('短中文重复段')]).similarity,0);
});
test('PDF normalization variants retain both real compound hyphens and wrapped single words',()=>{
 const raw='The encoder-\ndecoder configuration supports regulari-\nzation for robust neural models.';
 const normalized='The encoderdecoder configuration supports regularization for robust neural models.';
 const text='The encoder-decoder configuration supports regularization for robust neural models.';
 const r=compare(text,[{...source(raw),textVariants:[normalized]}]);assert.equal(r.similarity,100);assert.equal(r.results[0].sources.length,1);assert.equal(r.sources[0].textVariants,undefined);
});
test('Metadata matches retain their scope instead of claiming PDF evidence',()=>{
 const text='The original abstract retains this distinctive scientific description.';const s={...source('An unrelated revised PDF body contains different scientific findings.'),scope:'开放论文PDF全文',textVariants:[text],variantScopes:['开放论文PDF全文','仅摘要元数据']};const r=compare(text,[s]);assert.equal(r.similarity,100);assert.equal(r.results[0].sources[0].scope,'仅摘要元数据');
});
