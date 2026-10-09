import {readFile,writeFile} from 'node:fs/promises';import {failureKind} from '../source-policy.mjs';
const data=JSON.parse(await readFile('test-expanded/source-audit.json','utf8'));
for(const row of data.attempts)if(!row.ok)row.failureKind=failureKind(row.error);
for(const group of data.groups){
 const rows=data.attempts.filter(r=>r.id===group.id);group.urls=Object.values(Object.groupBy(rows,r=>r.url)).map(items=>({url:items[0].url,checks:items.length,successes:items.filter(r=>r.ok).length,evidence:[...new Set(items.filter(r=>r.ok).map(r=>r.evidence))],errors:[...new Set(items.filter(r=>!r.ok).map(r=>r.error))]}));
 group.failureKinds=[...new Set(rows.filter(r=>!r.ok).map(r=>r.failureKind))];
 if(group.failureKinds.length===1&&group.failureKinds[0]==='size-limit')group.classification='部分样本超过文件上限';
 if(group.id==='ddg')group.caution='本次6次成功；此前文稿测试曾触发验证码，不能据此认定长期稳定。';
 if(group.id==='sciencedirect')group.caution='当前DNS返回非公网地址，被内网安全策略拦截；未实际访问到文章服务器。';
 if(group.role==='metadata')group.caution='稳定获取的是元数据，不是全文库。';
}
data.successes=data.attempts.filter(r=>r.ok).length;data.failed=data.checks-data.successes;
await writeFile('public/samples/source-audit.json',JSON.stringify(data,null,2));await writeFile('test-expanded/source-audit.json',JSON.stringify(data,null,2));
const lines=['# 来源可用性实测','',`记录时间：${data.generatedAt}。25个样本地址，3轮，${data.checks}次实际请求，${data.successes}次满足内容校验。未使用来源缓存或自动重试。`,'','| 来源 | 成功/检查 | 中位耗时 | 证据/失败原因 |','|---|---:|---:|---|',...data.groups.map(g=>`| ${g.label} | ${g.successes}/${g.checks} | ${g.medianSeconds??'-'} 秒 | ${[...g.evidence,...g.errors].join('；')} |`),'',...data.notes.map(n=>'- '+n),'','实现改进：优先读取已验证的开放全文；失败网址按原因冷却30秒或5分钟，到期可重试；一个失败论文不封禁整站。冷却跳过继续记录失败，分数不可判定时不会显示0%。尊重Retry-After；重定向循环单独识别。','',`## 逐个网址`,...data.groups.flatMap(g=>['',`### ${g.label}`,...g.urls.map(u=>`- ${u.successes}/${u.checks}：${u.url}；${[...u.evidence,...u.errors].join('；')}`)])];await writeFile('test-expanded/SOURCE-AVAILABILITY.md',lines.join('\n'));console.log({checks:data.checks,successes:data.successes,groups:data.groups.length});
