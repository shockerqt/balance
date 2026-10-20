import assert from 'node:assert/strict';
import test from 'node:test';
import { getDashboardServiceConfig, validateDashboardServiceConfig } from '../src/services/config.ts';

test('dashboard candidate defaults bind Eri resource, renewable scopes and application transport', () => {
  const config = getDashboardServiceConfig('https://balance.shocker.cl');
  assert.equal(config.oidcIssuer, 'https://auth.shocker.cl');
  assert.equal(config.oidcClientId, 'balance-dashboard');
  assert.equal(config.wsSyncUrl, 'wss://balance.shocker.cl/api/ws/sync/application');
  assert.equal(config.wsAuthMode, 'application');
  assert.equal(config.oidcResource, 'https://balance.shocker.cl/api');
  assert.equal(config.oidcScopes, 'openid profile email offline_access');
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


test('explicit legacy E2E fixture preserves isolated legacy request and transport defaults', () => {
  const config = getDashboardServiceConfig('http://127.0.0.1:4173', {
    VITE_API_URL: 'http://127.0.0.1:8080', VITE_WS_URL: 'ws://127.0.0.1:8080/ws/sync',
    VITE_OIDC_ISSUER: 'http://127.0.0.1:8180/realms/balance-e2e', VITE_OIDC_CLIENT_ID: 'balance-dashboard-e2e',
    VITE_OIDC_REDIRECT_URI: 'http://127.0.0.1:4173/',
  });
  assert.equal(config.wsAuthMode, 'legacy');
  assert.equal(config.oidcResource, undefined);
  assert.equal(config.oidcScopes, undefined);
  assert.equal(config.oidcClientId, 'balance-dashboard-e2e');
  assert.equal(config.wsSyncUrl, 'ws://127.0.0.1:8080/ws/sync');
});

test('explicit staging configuration remains independent of production defaults', () => {
  const config = getDashboardServiceConfig('https://balance-staging.shocker.cl', {
    VITE_API_URL: 'https://balance-staging.shocker.cl/api',
    VITE_WS_URL: 'wss://balance-staging.shocker.cl/api/ws/sync/application', VITE_WS_AUTH_MODE: 'application',
    VITE_OIDC_ISSUER: 'https://auth-staging.shocker.cl', VITE_OIDC_CLIENT_ID: 'balance-dashboard-staging',
    VITE_OIDC_RESOURCE: 'https://balance-staging.shocker.cl/api', VITE_OIDC_SCOPES: 'openid email offline_access',
  });
  assert.equal(config.oidcIssuer, 'https://auth-staging.shocker.cl');
  assert.equal(config.oidcResource, 'https://balance-staging.shocker.cl/api');
  assert.equal(config.oidcClientId, 'balance-dashboard-staging');
  assert.equal(config.oidcScopes, 'openid email offline_access');
  assert.equal(config.wsAuthMode, 'application');
});
