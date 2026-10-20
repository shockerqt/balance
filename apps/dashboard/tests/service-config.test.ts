import assert from 'node:assert/strict';
import test from 'node:test';
import { getDashboardServiceConfig, validateDashboardServiceConfig } from '../src/services/config.ts';

test('dashboard defaults retain Keycloak and legacy transport without resource or scope override', () => {
  const config = getDashboardServiceConfig('https://balance.shocker.cl');
  assert.equal(config.oidcIssuer, 'https://auth.shocker.cl/realms/balance');
  assert.equal(config.oidcClientId, 'balance-mobile');
  assert.equal(config.wsSyncUrl, 'wss://balance.shocker.cl/api/ws/sync');
  assert.equal(config.wsAuthMode, 'legacy');
  assert.equal(config.oidcResource, undefined);
  assert.equal(config.oidcScopes, undefined);
});

test('optional candidate resource, scopes and transport are validated', () => {
  const config = getDashboardServiceConfig('https://balance.example');
  assert.equal(validateDashboardServiceConfig({ ...config, oidcResource: 'https://balance.example/api', oidcScopes: 'openid profile offline_access', wsAuthMode: 'application' }).wsAuthMode, 'application');
  for (const oidcResource of ['', '/api', 'http://balance.example/api', 'https://user:secret@balance.example/api', 'https://balance.example/api#fragment', 'https://balance.example/api?resource=other']) {
    assert.throws(() => validateDashboardServiceConfig({ ...config, oidcResource }));
  }
  for (const oidcScopes of ['', 'profile', 'openid\nemail', 'openid  email', 'openid "email"']) {
    assert.throws(() => validateDashboardServiceConfig({ ...config, oidcScopes }));
  }
  assert.throws(() => validateDashboardServiceConfig({ ...config, wsAuthMode: 'invalid' as 'legacy' }));
  assert.throws(() => validateDashboardServiceConfig({ ...config, wsAuthMode: 'application', wsSyncUrl: 'ws://balance.example/api/ws/sync/application' }));
});
