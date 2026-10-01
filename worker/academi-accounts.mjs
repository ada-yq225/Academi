import fs from 'node:fs/promises';
import path from 'node:path';
export function configuredAccounts(env=process.env) {
  const accounts=[{email:env.ACADEMI_EMAIL,password:env.ACADEMI_PASSWORD}];
  if(env.ACADEMI_EMAIL_2||env.ACADEMI_PASSWORD_2)accounts.push({email:env.ACADEMI_EMAIL_2,password:env.ACADEMI_PASSWORD_2});
  if(accounts.some(a=>!a.email||!a.password))throw Error('Incomplete ACADEMI account configuration');
  if(new Set(accounts.map(a=>a.email.toLowerCase())).size!==accounts.length)throw Error('Duplicate ACADEMI accounts');
  return accounts;
}
async function atomic(file,data){await fs.writeFile(file+'.tmp',JSON.stringify(data),{mode:0o600});await fs.rename(file+'.tmp',file)}
export async function accountForJob(root,dir,accounts){
  const assignment=path.join(dir,'academi-account.json');
  let saved;try{saved=JSON.parse(await fs.readFile(assignment,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  if(saved){const account=accounts.find(a=>a.email===saved.email);if(!account)throw Error('Assigned ACADEMI account missing; restore configuration to resume');return account}
  // Existing attempts must remain attached to the account that uploaded them.
  const names=await fs.readdir(dir);
  const legacy=names.some(n=>/^(ai-report\.pdf|source\.json|academi-attempt-\d+\.json|attempt-\d+\.json)$/.test(n));
  let index=0;
  if(!legacy){
    const cursor=path.join(root,'academi-rotation.json');let next=0;
    try{const value=JSON.parse(await fs.readFile(cursor,'utf8'));if(!Number.isSafeInteger(value.next)||value.next<0)throw Error('Invalid ACADEMI rotation state');next=value.next}catch(e){if(e.code!=='ENOENT')throw e}
    index=next%accounts.length;
    await atomic(assignment,{email:accounts[index].email});
    await atomic(cursor,{next:next+1});
  }else await atomic(assignment,{email:accounts[0].email});
  return accounts[index];
}
