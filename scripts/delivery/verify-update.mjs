import { readFileSync, writeFileSync } from 'node:fs';
export function verifyUpdate(updates, sha, runtime) {
  if (!Array.isArray(updates) || updates.length !== 1) throw new Error('Expected exactly one Android update');
  const update = updates[0];
  if (update.platform !== 'android' || update.runtimeVersion !== runtime || !update.id || !update.group ||
      !String(update.message).includes(sha)) throw new Error('Published update identity/runtime mismatch');
  return { status: 'published', source_sha: sha, runtime_version: runtime, update_id: update.id, group_id: update.group };
}
if (process.argv[1]?.endsWith('/verify-update.mjs')) {
  const baseline = JSON.parse(readFileSync('delivery/daily-runtime.json'));
  const result = verifyUpdate(JSON.parse(readFileSync('daily-update.json')), process.env.GITHUB_SHA, baseline.runtime_version);
  const after = JSON.parse(readFileSync('daily-after.json')).currentPage[0];
  if (after?.group !== result.group_id) throw new Error('Daily branch no longer points to the published group');
  const before = JSON.parse(readFileSync('daily-before.json')).currentPage[0];
  result.previous_group_id = before?.group || null;
  writeFileSync('daily-delivery.json', JSON.stringify(result, null, 2) + '\n');
}
