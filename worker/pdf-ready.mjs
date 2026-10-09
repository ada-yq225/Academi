import fs from 'node:fs/promises';
// A failed download may have created a file before the browser reported failure.
export async function pdfReady(file) {
 try {
  const bytes=await fs.readFile(file);
  return bytes.length>20 && bytes.subarray(0,5).toString()==='%PDF-' && /%%EOF\s*$/.test(bytes.subarray(-1024).toString());
 } catch(e) { if(e.code==='ENOENT')return false;throw e; }
}
