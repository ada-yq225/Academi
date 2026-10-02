// Dedicated UTAD Similarity worker. Original official PDF is never restyled.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {scanPages,waitForReport,retryTransient}=require('./utad-tracking.cjs');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const atomic = (p, v) => {fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2),{mode:0o600});fs.renameSync(p+'.tmp',p)};
(async()=>{
 const input=path.resolve(process.argv[2]);
 const dir=path.resolve(process.env.RESULT_DIR||path.dirname(input));
 if(!/\.(txt|pdf|docx)$/i.test(input))throw Error('Unsupported input');
 if(process.env.SIMILARITY_PROVIDER!=='utad'||process.env.UTAD_DEFAULT_POLICY_ACCEPTED!=='true')throw Error('UTAD primary/default policy not enabled');
 if(!process.env.FALLBACK_TURNITIN_USERNAME||!process.env.FALLBACK_TURNITIN_PASSWORD)throw Error('UTAD credentials missing');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const jobId=process.env.UTAD_JOB_ID||path.basename(input,path.extname(input));
 const title=process.env.UTAD_EXISTING_TITLE||('PaperDesk-'+jobId);
 const receiptPath=path.join(dir,'utad-submission.json');
 let receipt=fs.existsSync(receiptPath)?JSON.parse(fs.readFileSync(receiptPath)):null;
 if(receipt&&(receipt.inputSha256!==hash(input)||receipt.title!==title))throw Error('UTAD receipt/input mismatch');
 if(receipt?.state==='validated'&&fs.existsSync(path.join(dir,'similarity-report.pdf'))){
  if(receipt.reportSha256!==hash(path.join(dir,'similarity-report.pdf')))throw Error('Cached UTAD report changed');
  console.log('Resuming validated UTAD result without another submission');return;
 }
 const browser=await chromium.launch({headless:process.env.UTAD_HEADLESS!=='false',...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 let diagnosticPage;
 try{
  const ctx=await browser.newContext({acceptDownloads:true});ctx.setDefaultTimeout(60000);
  let page=await ctx.newPage();diagnosticPage=page;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()){const u=new URL(frame.url());console.log('UTAD stage',u.hostname,u.pathname)}});
  page.on('requestfailed',r=>{const u=new URL(r.url());console.log('UTAD network failure',u.hostname,r.failure()?.errorText)});
  page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url());if(u.hostname.endsWith('turnitin.com'))console.log('UTAD HTTP error',r.status(),u.hostname,u.pathname)}});
  await page.goto('https://turnitin.utad.pt',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Username',{exact:true}).fill(process.env.FALLBACK_TURNITIN_USERNAME);
  await page.getByLabel('Password',{exact:true}).fill(process.env.FALLBACK_TURNITIN_PASSWORD);
  await page.getByRole('button',{name:'Login',exact:true}).click();
  // Information release is routine sign-in consent, not a terms agreement.
  const consent=page.getByRole('button',{name:'Accept',exact:true});
  await Promise.any([consent.waitFor(),page.waitForURL('https://utad.turnitin.com/**',{waitUntil:'domcontentloaded',timeout:120000})]);
  if(await consent.isVisible()){
   await page.getByLabel('Ask me again at next login',{exact:false}).check();
   await consent.click();
  }
  await page.waitForURL('https://utad.turnitin.com/**',{waitUntil:'domcontentloaded',timeout:120000});
  if(new URL(page.url()).pathname.startsWith('/home')){
   const popup=ctx.waitForEvent('page');
   await page.getByRole('button',{name:/^(Executar|Launch)$/,exact:true}).click();page=await popup;diagnosticPage=page;
  }
  await page.waitForURL('**/originality/inbox/**',{waitUntil:'domcontentloaded',timeout:120000});
  const inboxUrl=page.url();
  const row=page.getByRole('row').filter({has:page.getByText(title,{exact:true})});
  const probe=()=>scanPages({
   reset:async()=>{await page.goto(inboxUrl,{waitUntil:'domcontentloaded'});await page.getByRole('table').waitFor();},
   read:async()=>{
    await row.waitFor({timeout:2500}).catch(e=>{if(e.name!=='TimeoutError')throw e});
    const count=await row.count();if(count>1)throw Error('Ambiguous UTAD title');if(!count)return null;
    const text=await row.innerText();const match=text.match(/\b(\d{1,3})\s*%/);
    return {score:match?Number(match[1]):null};
   },
   next:async()=>{
    const next=page.getByRole('button',{name:/^(Next Page|Próxima página)$/});
    if(!await next.count()||await next.isDisabled())return false;
    const pageSelector=page.getByLabel('Select page');
    const marker=pageSelector.getByText(/^(Page \d+ of \d+|Página \d+ de \d+)$/);
    const before=await marker.innerText();await next.click();
    await pageSelector.getByText(before,{exact:true}).waitFor({state:'hidden'});return true;
   }
  });
  const existing=await retryTransient(probe);
  // Resume by deterministic title. Uncertain submissions are never uploaded twice.
  if(!existing&&!receipt&&!process.env.UTAD_EXISTING_TITLE){
   await page.getByRole('link',{name:/^(My Files|Meus arquivos)$/,exact:true}).first().click();
   await page.getByRole('button',{name:/^(Fazer upload|Upload)$/,exact:true}).click();
   const chooser=page.waitForEvent('filechooser');
   await page.getByRole('button',{name:/^(Pesquisar arquivos|Browse Files)$/,exact:true}).click();
   await (await chooser).setFiles(input);
   await page.getByRole('textbox',{name:/^(Título \(Obrigatório\)|Title \(Required\))$/}).fill(title);
   receipt={jobId,title,inputSha256:hash(input),state:'submission-started',policy:'institution-default',startedAt:new Date().toISOString()};
   atomic(receiptPath,receipt);
   const submit=page.getByRole('button',{name:/^(Enviar|Submit)$/,exact:true});
   await submit.click();
   await page.screenshot({path:path.join(dir,'utad-after-submit.png')}).catch(()=>{});
   // The upload continues after the click. Navigating to refresh the inbox here
   // cancels the in-flight upload, so wait for the upload dialog to close first.
   try{await submit.waitFor({state:'hidden',timeout:240000})}
   catch(e){
    await page.screenshot({path:path.join(dir,'utad-upload-stalled.png')}).catch(()=>{});
    fs.writeFileSync(path.join(dir,'utad-upload-stalled.txt'),(await page.locator('body').innerText().catch(()=>'' )).slice(-4000),{mode:0o600});
    throw Error('UTAD upload did not finish before timeout; submission not confirmed');
   }
   fs.writeFileSync(path.join(dir,'utad-after-submit.txt'),(await page.locator('body').innerText().catch(()=>'' )).slice(-4000),{mode:0o600});
  }
  const ready=await waitForReport(probe,{onProgress:progress=>atomic(path.join(dir,'utad-progress.json'),{...progress,updatedAt:new Date().toISOString(),title})});
  const score=ready.score;
  const popup=ctx.waitForEvent('page');await row.getByText(title,{exact:true}).click();
  const viewer=await popup;diagnosticPage=viewer;await viewer.waitForURL('**/viewer/submissions/**');
  const oid=new URL(viewer.url()).pathname.match(/oid:(\d+):(\d+)/);
  if(!oid)throw Error('Missing official submission identifier');
  const submissionId='trn:oid:::'+oid[1]+':'+oid[2];
  receipt={...receipt,jobId,title,inputSha256:hash(input),submissionId,similarityScore:score,state:'report-ready',policy:'institution-default'};
  atomic(receiptPath,receipt);
  const target=path.join(dir,'similarity-report.pdf');
  await retryTransient(async()=>{
   await viewer.getByRole('button',{name:/^(Baixar|Download)$/,exact:true}).last().click();
   const [download]=await Promise.all([viewer.waitForEvent('download',{timeout:120000}),viewer.getByText(/^(Relatório de similaridades|Similarity Report)$/).click()]);
   await download.saveAs(target+'.tmp');fs.renameSync(target+'.tmp',target);
  });
  const audit=path.join(dir,'utad-audit.json');
  const checked=spawnSync(process.env.PYTHON_BIN||'python3',[path.join(__dirname,'validate_official_report.py'),'--report',target,'--input',input,'--submission-id',submissionId,'--score',String(score),'--audit',audit],{encoding:'utf8'});
  if(checked.status!==0)throw Error('Official report validation failed: '+checked.stderr.slice(-1000));
  receipt={...receipt,jobId,title,inputSha256:hash(input),submissionId,similarityScore:score,reportSha256:hash(target),state:'validated',policy:'institution-default',completedAt:new Date().toISOString()};
  atomic(receiptPath,receipt);console.log(JSON.stringify({provider:'Turnitin',submissionId,similarityScore:score,validated:true}));
 }catch(e){
  if(diagnosticPage){
   await diagnosticPage.screenshot({path:path.join(dir,'login-diagnostic.png')}).catch(()=>{});
   const u=new URL(diagnosticPage.url());console.error('Stopped at',u.hostname,u.pathname);
   console.error((await diagnosticPage.locator('body').innerText().catch(()=>'' )).slice(0,1200));
  }
  throw e;
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message.replace(/#token=[^\s]+/g,'#token=[redacted]'));process.exitCode=1});
