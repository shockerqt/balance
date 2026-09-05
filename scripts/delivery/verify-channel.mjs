import { readFileSync } from 'node:fs';
export function verifyChannel(data) {
  const channel = data.currentPage;
  const mapping = JSON.parse(channel.branchMapping);
  const routes = mapping.data;
  if (channel.name !== 'daily' || channel.isPaused || routes.length !== 1 || routes[0].branchMappingLogic !== 'true' ||
      !channel.updateBranches.some(branch => branch.id === routes[0].branchId && branch.name === 'daily')) {
    throw new Error('Daily must be active and map exclusively to the daily branch');
  }
  return true;
}
if (process.argv[1]?.endsWith('/verify-channel.mjs')) verifyChannel(JSON.parse(readFileSync(process.argv[2])));
