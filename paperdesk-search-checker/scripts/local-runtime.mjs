// Optional dependency cache for local development; regular installs need no override.
import {registerHooks,createRequire,isBuiltin} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
const cached=path.join(homedir(),'.cache/paperdesk-search-checker-runtime');
const runtime=process.env.PAPERDESK_RUNTIME_DIR||(existsSync(path.join(cached,'node_modules/express/package.json'))?cached:null);
if(runtime){
 const require=createRequire(path.join(runtime,'package.json'));
 const project=new URL('../',import.meta.url).href;let resolving=false;
 registerHooks({resolve(specifier,context,next){
  if(!resolving&&context.parentURL?.startsWith(project)&&!context.parentURL.includes('/node_modules/')&&!isBuiltin(specifier)&&!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':')){
   try{resolving=true;const target=require.resolve(specifier);resolving=false;return next(pathToFileURL(target).href,context);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}finally{resolving=false;}
  }
  return next(specifier,context);
 }});
}
