// Copy all release resources before publishing the entry point.
import fs from 'node:fs/promises';import path from 'node:path';
const source=path.resolve('dist/client'),target=process.env.STATIC_DIR&&path.resolve(process.env.STATIC_DIR);
if(target&&target!==source){
 await fs.mkdir(target,{recursive:true});
 for(const entry of await fs.readdir(source,{withFileTypes:true})){
  if(entry.name==='index.html')continue;
  await fs.cp(path.join(source,entry.name),path.join(target,entry.name),{recursive:true});
 }
 await fs.copyFile(path.join(source,'index.html'),path.join(target,'index.html.pending'));
 await fs.rename(path.join(target,'index.html.pending'),path.join(target,'index.html'));
 console.log('Published complete portal assets');
}
