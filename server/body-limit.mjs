export function bodyLimit(pathname) {
 if(pathname==='/api/jobs')return 11*1024*1024;
 if(pathname.startsWith('/api/worker/artifact/'))return 51*1024*1024;
 if(pathname.startsWith('/api/worker/evidence/'))return 10*1024*1024;
 return 64*1024;
}
