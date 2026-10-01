export function sendStream(stream,res){
 stream.once('error',error=>{
  console.error('Response stream failed:',error.code||error.message);
  if(!res.headersSent){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('文件暂不可用，请稍后重试');}
  else res.destroy();
 });
 res.once('close',()=>stream.destroy());
 stream.pipe(res);
}
