import mammoth from 'mammoth';
import {pdfText} from './retrieval.mjs';
import path from 'node:path';
export async function extractDocument(bytes,filename){
 if(bytes.length>10*1024*1024)throw Error('单个文件不能超过10 MB');
 const ext=path.extname(filename).toLowerCase();let text;
 if(ext==='.pdf'&&bytes.subarray(0,5).toString()==='%PDF-')text=await pdfText(bytes);
 else if(ext==='.docx')text=(await mammoth.extractRawText({buffer:bytes})).value;
 else if(ext==='.txt')text=bytes.toString('utf8');
 else throw Error('支持TXT、DOCX和文字型PDF');
 if(text.trim().length<30)throw Error('文件未提取到足够文字；扫描版PDF需要先做OCR');
 if(text.length>150000)throw Error('当前最多支持150,000字符');
 return text;
}
