const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};let data;
const roles={'metadata':'元数据接口','search':'搜索接口','fulltext':'开放全文','abstract':'摘要/论文页面','article-page':'出版商文章页面','web':'普通网页'};
function render(){
 $('sourceCards').replaceChildren();const filter=$('sourceFilter').value;
 const groups=data.groups.filter(g=>filter==='all'||filter==='passed'&&g.successes===g.checks||filter==='partial'&&g.successes>0&&g.successes<g.checks||filter==='failed'&&!g.successes||filter==='fulltext'&&g.role==='fulltext');
 groups.sort((a,b)=>b.successRate-a.successRate||(a.medianSeconds??Infinity)-(b.medianSeconds??Infinity));
 for(const g of groups){const card=node('article',undefined,'card');card.append(node('h2',g.label),node('p',`${roles[g.role]} · ${g.classification} · ${g.successes}/${g.checks} 次通过 · ${g.distinctUrls} 个样本地址 · 成功中位耗时 ${g.medianSeconds??'无成功记录'}${g.medianSeconds===null?'':' 秒'}`));if(g.caution)card.append(node('p',g.caution,'note'));
  for(const u of g.urls){const details=node('details'),summary=node('summary',`${u.successes}/${u.checks} · ${u.evidence.join('、')||u.errors.join('、')}`);details.append(summary);const a=node('a',u.url);a.href=u.url;a.target='_blank';a.rel='noopener noreferrer';details.append(node('p'));details.lastChild.append(a);if(u.errors.length)details.append(node('p','受限原因：'+u.errors.join('；'),'error'));const rows=data.attempts.filter(r=>r.id===g.id&&r.url===u.url);for(const r of rows)details.append(node('p',`第 ${r.round} 轮：${r.ok?'内容校验通过':r.error} · HTTP ${r.status??'未收到响应'} · ${r.seconds} 秒${r.bytes?' · '+Math.round(r.bytes/1024)+' KB':''}`,'hint'));card.append(details);}
  $('sourceCards').append(card);
 }
}
try{const r=await fetch('/samples/source-audit.json');if(!r.ok)throw Error('尚无实测记录');data=await r.json();$('auditStatus').textContent=`${new Date(data.startedAt).toLocaleString('zh-CN')} 至 ${new Date(data.generatedAt).toLocaleString('zh-CN')} · 未使用来源缓存 · 未自动重试`;
 for(const [value,label] of [[data.groups.length,'来源类别'],[data.targetCount,'样本地址'],[data.successes+'/'+data.checks,'内容校验通过']]){const div=node('div',undefined,'metric');div.append(node('strong',String(value)),node('span',label));$('auditMetrics').append(div);}for(const note of data.notes)$('sourceNotes').append(node('p',note,'hint'));$('sourceFilter').addEventListener('change',render);render();
}catch(e){$('auditStatus').textContent=e.message;}
