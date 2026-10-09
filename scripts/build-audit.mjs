import {build} from 'esbuild';await build({entryPoints:['server/api.ts'],outfile:'dist/audit-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()}});
