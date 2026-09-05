import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const artifactsDir = process.env.E2E_ARTIFACTS_DIR ?? 'e2e-artifacts';

await mkdir(artifactsDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext();
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
let failed = false;

async function visibleText(text) {
  await page.getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
}

try {
  await page.goto(`${baseUrl}/`);
  await page.getByRole('button', { name: 'login' }).click();

  await page.locator('#username').fill('e2e');
  await page.locator('#password').fill('e2e-password');
  await page.locator('#kc-login').click();

  await visibleText('e2e@balance.test');
  await visibleText('E2E oats');
  await visibleText('100 g');
  await visibleText('synced');

  const durableStorage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(window.localStorage)),
    session: Object.fromEntries(Object.entries(window.sessionStorage)),
  }));
  assert.deepEqual(durableStorage.local, { 'balance.dashboard.oidc-sso.v1': '1' });
  assert.deepEqual(durableStorage.session, {});

  const row = page.getByText('E2E oats', { exact: true }).locator('..');
  await row.getByText('100 g', { exact: true }).click();
  const quantity = page.getByRole('textbox', { name: 'Edit quantity' });
  await quantity.fill('150');
  await quantity.press('Enter');
  await visibleText('150 g');
  await visibleText('synced');

  await page.reload();
  await visibleText('e2e@balance.test');
  await visibleText('E2E oats');
  await visibleText('150 g');
  await visibleText('synced');

  const historicalRow = page.getByText('E2E historic spoon', { exact: true }).locator('..');
  await historicalRow.getByText('5 cucharada', { exact: true }).click();
  await quantity.fill('1');
  await quantity.press('Enter');
  await visibleText('1 cucharada');
  await visibleText('synced');
  await page.reload();
  await visibleText('1 cucharada');
  await visibleText('synced');
  // 1/5 of 30 g = 6 g; at 400 kcal/100 g the historical row is 24 kcal.
  await historicalRow.getByText('24', { exact: true }).waitFor({ state: 'visible' });

  await page.getByLabel('Balance terminal food log').focus();
  await page.keyboard.press('a');
  const librarySearch = page.getByRole('textbox', { name: 'Search food library' });
  await librarySearch.fill('E2E oats');
  await librarySearch.press('Enter');
  await page.getByText('E2E oats', { exact: true }).nth(1).waitFor({ state: 'visible' });
  await visibleText('synced');
  await page.reload();
  await page.getByText('E2E oats', { exact: true }).nth(1).waitFor({ state: 'visible' });
  await visibleText('100 g');
  await visibleText('150 g');
  await visibleText('1 cucharada');
  await visibleText('synced');
  await page.screenshot({ path: join(artifactsDir, 'shared-domain-smoke.png'), fullPage: true });

  await page.getByRole('button', { name: 'logout' }).click();
  await page.getByRole('button', { name: 'login' }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.localStorage.getItem('balance.dashboard.oidc-sso.v1')), null);

  await page.goto(`${baseUrl}/?code=bogus&state=bogus`);
  await page.getByText('Invalid OIDC callback: missing transaction', { exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
} catch (error) {
  failed = true;
  await page.screenshot({ path: join(artifactsDir, 'failure.png'), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await context.tracing.stop(failed ? { path: join(artifactsDir, 'trace.zip') } : undefined);
  await browser.close();
}
