// Transport test using a genuine downloaded report; isolated database, no worker
// browser and no external submission. This is not a full AI + similarity test.
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes, createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const report = await readFile(process.argv[2]);
const dir = await mkdtemp(tmpdir() + '/official-report-delivery-');
const base = 'http://127.0.0.1:3238';
const workerToken = randomBytes(32).toString('hex');
const adminToken = randomBytes(32).toString('hex');
const child = spawn(process.execPath, ['dist/server.mjs'], {
  env: {...process.env, PORT: '3238', APP_ORIGIN: base, DATA_DIR: dir,
    WORKER_TOKEN: workerToken, ADMIN_TOKEN: adminToken},
  stdio: ['ignore', 'pipe', 'pipe'],
});
let errors = '', database;
child.stderr.on('data', b => { errors += b; });
const call = (route, body, headers = {}) => fetch(base + '/api/' + route, {
  method: body === undefined ? 'GET' : 'POST',
  headers: {'Content-Type': 'application/json', ...headers},
  body: body === undefined ? undefined : JSON.stringify(body),
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(errors || 'Test server exited');
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'Isolated test server did not start: ' + errors);
  const registered = await call('register', {email: 'report-test@example.com', password: randomBytes(20).toString('hex')});
  assert.equal(registered.status, 200);
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  database = new DatabaseSync(dir + '/paperdesk.sqlite');
  const user = database.prepare('SELECT id FROM users WHERE email=?').get('report-test@example.com');
  database.prepare("INSERT INTO jobs(id,user_id,filename,status,input_key,created_at,updated_at,lease,lease_until) VALUES(?,?,?,'processing',?,1,1,?,?)")
    .run('official-test', user.id, 'SYNTHETIC TECHNICAL TEST.pdf', 'inputs/synthetic.pdf', 'test-lease', Date.now() + 600000);
  const headers = {Authorization: 'Bearer ' + workerToken, 'X-Job-Lease': 'test-lease'};
  const upload = await fetch(base + '/api/worker/artifact/official-test/similarity', {
    method: 'POST', headers: {...headers, 'Content-Type': 'application/pdf'}, body: report,
  });
  assert.equal(upload.status, 200);
  assert.equal((await call('admin/file/official-test/similarity')).status, 401);
  assert.equal((await call('admin/file/official-test/similarity', undefined, {Cookie: cookie})).status, 403);
  const download = await call('admin/file/official-test/similarity', undefined, {Authorization: 'Bearer ' + adminToken});
  assert.equal(download.status, 200);
  const returned = Buffer.from(await download.arrayBuffer());
  assert.deepEqual(returned, report, 'Official report must be preserved byte for byte');
  assert.equal((await call('report/official-test/similarity', undefined, {Cookie: cookie})).status, 404,
    'Partial task must not be exposed as a completed customer result');
  assert.equal((await call('worker/complete/official-test', {aiScore: 0, similarityScore: 0, layoutVersion: 3}, headers)).status, 409,
    'Missing AI/report files must prevent completion even with numeric scores');
  if (process.argv[3]) {
    const bundle = process.argv[3];
    const scores = JSON.parse(await readFile(bundle + '/scores.json', 'utf8'));
    for (const kind of ['ai','ai-restyled','similarity-restyled','restyled']) {
      const bytes = await readFile(bundle + '/' + (kind === 'ai' ? 'ai-report' : kind) + '.pdf');
      const r = await fetch(base + '/api/worker/artifact/official-test/' + kind, {
        method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:bytes});
      assert.equal(r.status,200);
    }
    assert.equal((await call('worker/complete/official-test', {...scores,sources:{ai:'Turnitin',similarity:'Turnitin'}},headers)).status,400);
    for (let i=0;i<2;i++) assert.equal((await call('worker/complete/official-test',scores,headers)).status,200);
    const state=await (await call('state',undefined,{Cookie:cookie})).json();
    assert.equal(state.jobs[0].status,'completed');
    assert.deepEqual(JSON.parse(state.jobs[0].report_sources),scores.sources);
    assert.deepEqual(Buffer.from(await (await call('report/official-test/similarity-restyled',undefined,{Cookie:cookie})).arrayBuffer()),report);
  }
  assert.equal(database.prepare('SELECT COUNT(*) n FROM ledger').get().n, 0, 'Transport must not debit customer');
  console.log(JSON.stringify({result: 'PASS', transport: 'byte-identical',
    sha256: createHash('sha256').update(returned).digest('hex'),
    unauthorizedDenied: true, incompleteCompletionRejected: true, customerDebit: 0}));
} finally {
  database?.close();
  if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; }
  await rm(dir, {recursive: true, force: true});
}
