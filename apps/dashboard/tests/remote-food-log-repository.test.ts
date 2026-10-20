import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteFoodLogRepository } from '../src/features/food-log/services/remote-food-log-repository.ts';
import type { DashboardServiceConfig } from '../src/services/config.ts';

const config: DashboardServiceConfig = {
  apiBaseUrl: 'https://balance.example/api', wsSyncUrl: 'wss://balance.example/api/ws/sync/application',
  oidcIssuer: 'https://auth.example', oidcClientId: 'dashboard', oidcRedirectUri: 'https://balance.example/', wsAuthMode: 'application',
};
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  url: string;
  protocols: string[];
  constructor(url: string, protocols: string[]) { this.url = url; this.protocols = protocols; Socket.instances.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
function setup() {
  Socket.instances = [];
  Object.assign(globalThis, { WebSocket: Socket, window: { setTimeout, clearTimeout } });
  let updates = 0;
  const repository = new RemoteFoodLogRepository({ onMealLogs() { updates++; }, onMealTemplates() { updates++; }, onState() {} }, config);
  return { repository, updates: () => updates };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('application socket keeps bearer out of protocols and gates all sync until exact ACK', async () => {
  const { repository } = setup();
  repository.connect('access-one');
  const socket = Socket.instances[0]!;
  assert.deepEqual(socket.protocols, ['balance']);
  socket.open();
  assert.deepEqual(socket.sent, [{ event: 'authenticate', accessToken: 'access-one' }]);
  for (const invalid of [null, [], { event: 'authenticated', extra: true }, { event: 'pull_response' }, { event: 'error' }]) socket.emit(invalid);
  await settle();
  assert.equal(socket.sent.length, 1);
  socket.emit({ event: 'authenticated' });
  assert.equal(socket.sent.filter((frame) => frame.event === 'pull').length, 2);
  for (const frame of socket.sent.filter((frame) => frame.event === 'pull')) socket.emit({ event: 'pull_response', requestId: frame.requestId, collection: frame.collection, documents: [] });
  await settle();
  assert.equal(repository.getState().phase, 'synced');
  repository.disconnect();
});

test('token replacement and disconnect fence late socket ACK and resolved pull callbacks', async () => {
  const { repository, updates } = setup();
  repository.connect('old-token');
  const old = Socket.instances[0]!;
  old.open();
  repository.connect('new-token');
  const next = Socket.instances[1]!;
  old.emit({ event: 'authenticated' });
  assert.equal(old.sent.length, 1);
  next.open();
  assert.deepEqual(next.sent, [{ event: 'authenticate', accessToken: 'new-token' }]);
  next.emit({ event: 'authenticated' });
  for (const frame of next.sent.filter((frame) => frame.event === 'pull')) next.emit({ event: 'pull_response', requestId: frame.requestId, collection: frame.collection, documents: [] });
  // Responses have resolved promises, but their continuations have not executed.
  repository.disconnect();
  await settle();
  assert.equal(updates(), 0);
  assert.notEqual(repository.getState().phase, 'synced');
});

test('application authentication timeout closes and never sends sync', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { repository } = setup();
  repository.connect('token');
  const socket = Socket.instances[0]!;
  socket.open();
  context.mock.timers.tick(12_000);
  assert.equal(socket.readyState, 3);
  assert.equal(socket.sent.length, 1);
  repository.disconnect();
});

test('legacy transport remains default and begins existing sync on open', () => {
  setup();
  const repository = new RemoteFoodLogRepository({ onMealLogs() {}, onMealTemplates() {}, onState() {} }, { ...config, wsAuthMode: undefined });
  repository.connect('legacy-token');
  const socket = Socket.instances[0]!;
  assert.deepEqual(socket.protocols, ['balance', 'balance.bearer.legacy-token']);
  socket.open();
  assert.equal(socket.sent.filter((frame) => frame.event === 'pull').length, 2);
  repository.disconnect();
});
