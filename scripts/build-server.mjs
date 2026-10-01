import {build} from 'esbuild';await build({entryPoints:['server/index.mjs'],bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},outfile:'dist/server.mjs'});
