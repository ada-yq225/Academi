import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {configuredAccounts,accountForJob} from '../worker/academi-accounts.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'academi-accounts-'));
const accounts=configuredAccounts({ACADEMI_EMAIL:'one@example.test',ACADEMI_PASSWORD:'test-one',ACADEMI_EMAIL_2:'two@example.test',ACADEMI_PASSWORD_2:'test-two'});
try{
 for(const [name,index] of [['a',0],['b',1],['c',0]]){
  const dir=path.join(root,name);await fs.mkdir(dir);
  assert.equal((await accountForJob(root,dir,accounts)).email,accounts[index].email);
  assert.equal((await accountForJob(root,dir,accounts)).email,accounts[index].email);
  assert.ok(!(await fs.readFile(path.join(dir,'academi-account.json'),'utf8')).includes('test-one'));
 }
 const legacy=path.join(root,'legacy');await fs.mkdir(legacy);await fs.writeFile(path.join(legacy,'academi-attempt-1.json'),'{}');assert.equal((await accountForJob(root,legacy,accounts)).email,accounts[0].email);
 await assert.rejects(accountForJob(root,path.join(root,'b'),[accounts[0]]),/missing/);
 assert.throws(()=>configuredAccounts({ACADEMI_EMAIL:'one',ACADEMI_PASSWORD:'password',ACADEMI_EMAIL_2:'two'}),/Incomplete/);
 console.log('PASS: alternating accounts, stable retries, persistent assignments, legacy account retention, no password in receipts and missing-account refusal');
}finally{await fs.rm(root,{recursive:true,force:true})}
