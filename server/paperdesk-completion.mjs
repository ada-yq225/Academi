export function validatePaperdesk(body,result){
 if(!result||!Number.isFinite(result.similarity)||result.similarity<0||result.similarity>100||body.similarityScore!==result.similarity||!Number.isInteger(result.coverage?.readableSources)||result.coverage.readableSources<1||!['partial','complete'].includes(result.status))throw Error('自主查重结果无效或缺少可比对来源');
 if(body.aiScore===null){if(!['chinese','word-minimum','word-limit'].includes(body.aiSkippedReason))throw Error('AI跳过原因无效');}
 else if(!Number.isFinite(body.aiScore)||body.aiScore<0||body.aiScore>100)throw Error('AI分数无效');
 const reason=body.aiScore===null?({chinese:'中文文稿仅做相似度检测', 'word-minimum':'文稿不足AI检测350词下限，仅做相似度检测','word-limit':'文稿超过AI检测29,500词上限，仅做相似度检测'})[body.aiSkippedReason]:'';
 const warning=result.status==='partial'?'部分公开来源未获取，相似度仅按已取得来源计算':'';
 return {sources:{ai:body.aiScore===null?null:'ACADEMI.CX',similarity:'PaperDesk',retrievalStatus:result.status,readableSources:result.coverage.readableSources},message:[reason,warning].filter(Boolean).join('；')||null};
}
