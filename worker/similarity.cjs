module.exports=async function waitSimilarity(report,{timeout=600000,poll=2000,statusPoll=30000,onStatus=()=>{}}={}){
    // Wait for the similarity panel itself; the AI download toolbar can linger while switching.
    const similarityDownload=report.locator('a[href*="download_file.php"]:not([href*="type=ai_report"])');
    const deadline=Date.now()+timeout;let requested=false,lastCheck=Date.now();
    const fileId=/const FILE_ID = (\d+)/.exec(await report.content())?.[1];
    while(true){
      const body=await report.locator('body').innerText();
      if(/Similarity Report Limit Reached/i.test(body))throw new Error('Academi daily similarity report limit reached');
      const generate=report.locator('#btnGenerate');
      if(await generate.isVisible() && !requested){await generate.click();await report.waitForFunction(()=>!/Similarity Report Not Generated Yet/.test(document.body.innerText),{},{timeout:Math.min(timeout,60000)});requested=true;console.log('Similarity generation acknowledged');}
      else if(!/Similarity Report Not Generated Yet|Similarity Report Being Generated|Loading document|Loading\.\.\./i.test(body) && await similarityDownload.isVisible())break;
      if(fileId && Date.now()-lastCheck>statusPoll){
        lastCheck=Date.now();let status;
        try{const response=await report.request.get('https://academi.cx/dashboard/get_file_status.php',{timeout:15000});const data=await response.json();status=data.files?.find(f=>String(f.file_id)===fileId)}catch{}
        if(status)onStatus({time:new Date().toISOString(),fileId,status:status.similarity_scan_status??null,message:status.similarity_scan_message??null,available:!!status.similarity_report_available,error:status.similarity_error_message??null});
        if(status?.similarity_error_message)throw new Error('Similarity upstream failed: '+String(status.similarity_error_message).slice(0,500));
        if(status?.similarity_report_available){await report.reload({waitUntil:'domcontentloaded'});await report.getByRole('button',{name:'Similarity',exact:true}).first().click();}
        // Missing status is unknown, not a terminal failure. The provider also polls until availability.
        // Keep waiting without issuing another generation request.
      }
      if(Date.now()>deadline){throw new Error('Similarity report still unavailable after 10 minutes');}
      await report.waitForTimeout(poll);
    }
};
