import { execFileSync } from 'node:child_process';
const sha = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Missing immutable source SHA');
if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Delivery requires main');
const current = execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/git/ref/heads/main`, '--jq', '.object.sha'], { encoding: 'utf8' }).trim();
if (current !== sha) throw new Error(`SUPERSEDED: ${sha}; main is ${current}. The newer run owns delivery.`);
