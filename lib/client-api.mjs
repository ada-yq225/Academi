// Never expose gateway HTML or automatically replay a charged upload/order.
export async function requestJSON(url, body) {
 let response;
 try {
  response = await fetch(url, {method: body === undefined ? 'GET' : 'POST',
   headers: body instanceof FormData ? {} : {'Content-Type':'application/json'},
   body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
   signal: AbortSignal.timeout(60000)});
 } catch {
  throw Error('网络连接中断或超时，请刷新后确认操作结果，避免重复提交');
 }
 let data;
 try { data = JSON.parse(await response.text()); }
 catch { throw Error(response.status === 429 ? '操作过于频繁，请稍后再试' : '网站或公网连接暂不可用，请稍后刷新重试'); }
 if (!response.ok) throw Error(typeof data?.error === 'string' ? data.error : '操作失败，请稍后重试');
 if (!data || typeof data !== 'object') throw Error('服务返回的数据不完整，请稍后重试');
 return data;
}
