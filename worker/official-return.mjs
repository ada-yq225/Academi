// Imported official reports are pinned to one job and one input. Importing a
// report never creates a new submission and never charges the customer's ledger.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function officialReturn(dir, input, jobId) {
  const file = path.join(dir, 'official-return.json');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (manifest.jobId !== jobId || manifest.provider !== 'Turnitin' ||
      !/^trn:oid:::\d+:\d+$/.test(manifest.submissionId) ||
      !Number.isFinite(manifest.similarityScore) || manifest.similarityScore < 0 || manifest.similarityScore > 100)
    throw Error('Official return manifest does not match this job');
  for (const [name, expected] of [[input, manifest.inputSha256],
    [path.join(dir, 'similarity-report.pdf'), manifest.reportSha256],
    [path.join(dir, 'ai-report.pdf'), manifest.aiSha256]]) {
    if (!/^[a-f0-9]{64}$/.test(expected || '') || digest(await fs.readFile(name)) !== expected)
      throw Error('Official return file hash mismatch');
  }
  return manifest;
}

// A historical screenshot is not authorization to upload today. An adapter
// must supply a fresh, persisted settings read immediately before submission.
export function assertNoRepository(evidence, assignmentId, now = Date.now()) {
  if (!evidence || evidence.assignmentId !== assignmentId ||
      evidence.persisted !== true || evidence.repository !== 'Do not store the submitted papers' ||
      !Number.isFinite(evidence.checkedAt) || now - evidence.checkedAt > 30000 || evidence.checkedAt > now)
    throw Error('Turnitin repository setting is not verified; submission blocked');
}
