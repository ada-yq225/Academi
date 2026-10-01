const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// --existing resumes an uploaded file, avoiding another submission.
(async () => {
  const existing = process.argv[2] === '--existing';
  const input = process.argv[existing ? 3 : 2];
  if (!input || !process.env.ACADEMI_EMAIL || !process.env.ACADEMI_PASSWORD) throw new Error('Set ACADEMI_EMAIL and ACADEMI_PASSWORD; run: node run.cjs [--existing] filename.pdf');
  if (!/\.(pdf|docx)$/i.test(input)) throw new Error('Only PDF and DOCX are supported');
  const out = path.resolve(process.env.RESULT_DIR || 'results');
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  let reportPage;
  try {
    const ctx = await browser.newContext({acceptDownloads:true});
    const page = await ctx.newPage();
    page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url());if(u.hostname.endsWith('academi.cx'))console.error('ACADEMI HTTP error',r.status(),u.pathname)}});
    page.on('requestfailed',r=>{const u=new URL(r.url());if(u.hostname.endsWith('academi.cx'))console.error('ACADEMI network failure',u.pathname,r.failure()?.errorText)});
    ctx.setDefaultTimeout(120000);
    await page.goto('https://academi.cx/dashboard/');
    await page.locator('#email').fill(process.env.ACADEMI_EMAIL);
    await page.locator('#password').fill(process.env.ACADEMI_PASSWORD);
    await page.getByRole('button',{name:'Login',exact:true}).click();
    await page.waitForURL('**/dashboard/**');
    console.log('Logged in');
    const filename = path.basename(input);
    const row = page.getByRole('row').filter({has:page.getByTitle(filename,{exact:true}).or(page.getByText(filename,{exact:true}))});
    if (!existing) {
      for(let attempt=0;attempt<4&&!await row.count();attempt++){
        await page.locator('#fileInput').setInputFiles(path.resolve(input));
        await Promise.race([
          row.waitFor({timeout:8000}).catch(()=>{}),
          page.getByText('Cooldown Active',{exact:true}).waitFor({timeout:8000}).catch(()=>{})
        ]);
        if(await row.count())break;
        if(await page.getByText('Cooldown Active',{exact:true}).isVisible().catch(()=>false)){
          const cancel=page.locator('.modal.show').getByRole('button',{name:'Cancel',exact:true});
          if(await cancel.count()===1)await cancel.click();
          else await page.getByRole('button',{name:'Cancel',exact:true}).filter({visible:true}).last().click();
          await page.waitForTimeout(4000);
          await page.locator('#fileInput').setInputFiles([]);
          continue;
        }
        break;
      }
    }
    await row.waitFor({timeout:60000}).catch(async e=>{
      fs.writeFileSync(path.join(out,'academi-dashboard-ui.txt'),await page.locator('body').innerText().catch(()=>''));
      await page.screenshot({path:path.join(out,'academi-dashboard.png'),fullPage:true}).catch(()=>{});
      throw e;
    });
    if (await row.count() !== 1) throw new Error('Ambiguous filename: use a unique upload filename');
    await row.getByRole('button',{name:'View Results'}).waitFor({timeout:600000});
    const [report] = await Promise.all([ctx.waitForEvent('page'),row.getByRole('button',{name:'View Results'}).click()]);
    reportPage=report;console.log('Report opened');
    report.on('response',async response=>{
      if(new URL(response.url()).pathname!=='/dashboard/run_similarity.php')return;
      try{const data=await response.json();fs.appendFileSync(path.join(out,'similarity-status.jsonl'),JSON.stringify({time:new Date().toISOString(),event:'generation-response',httpStatus:response.status(),status:data.status,code:data.code,message:data.message})+'\n')}catch{}
    });
    report.on('dialog',async dialog=>{if(dialog.type()==='confirm'&&/similarity|generate/i.test(dialog.message()))await dialog.accept();else await dialog.dismiss()});
    await report.waitForLoadState('domcontentloaded');
    await report.getByText('Loading document...',{exact:true}).waitFor({state:'hidden',timeout:120000});
    await report.waitForFunction(() => ![...document.querySelectorAll('.loading-state')].some(el =>
      el.textContent?.trim() === 'Loading...' && el.getClientRects().length > 0
    ),null,{timeout:120000});
    fs.writeFileSync(path.join(out,'ai-ui.txt'),await report.locator('body').innerText());
    if(/AI Detection Not Available[\s\S]*30,000 word limit/i.test(fs.readFileSync(path.join(out,'ai-ui.txt'),'utf8')))
      throw new Error('AI detection unavailable: word limit exceeded (30,000 words)');
    async function download(name) {
      const [file] = await Promise.all([report.waitForEvent('download',{timeout:120000}),report.getByRole('link',{name:'Download PDF'}).click()]);
      await file.saveAs(path.join(out,name));
      if (!fs.readFileSync(path.join(out,name)).subarray(0,5).equals(Buffer.from('%PDF-'))) throw new Error('Downloaded response is not PDF');
    }
    await download('ai-report.pdf');
    if(process.env.ACADEMI_AI_ONLY==='true'){
      fs.writeFileSync(path.join(out,'source.json'),JSON.stringify({source:'ACADEMI.CX',filename,downloadedAt:new Date().toISOString(),aiModel:'Academi in-house model',mode:'ai-only'}));
      console.log('AI PDF saved; similarity handled by configured primary provider');
      return;
    }
    console.log('AI PDF saved; requesting similarity report');
    await report.getByRole('button',{name:'Similarity',exact:true}).first().click();
    await require('./similarity.cjs')(report,{onStatus:entry=>fs.appendFileSync(path.join(out,'similarity-status.jsonl'),JSON.stringify(entry)+'\n')});
    fs.writeFileSync(path.join(out,'similarity-ui.txt'),await report.locator('body').innerText());
    await download('similarity-report.pdf');
    fs.writeFileSync(path.join(out,'source.json'),JSON.stringify({source:'ACADEMI.CX',filename,downloadedAt:new Date().toISOString(),aiModel:'Academi in-house model',similarityProvider:'Turnitin, claimed by Academi; not independently verified',restyleLabel:'非官方重排测试版'},null,2));
    console.log('Both reports saved to',out);
  } catch(e){if(reportPage){fs.writeFileSync(path.join(out,'error-ui.txt'),await reportPage.locator('body').innerText().catch(()=>''));}throw e;} finally { await browser.close(); }
})().catch(e=>{ console.error(e.message); process.exitCode=1; });
