import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/api-handler.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let role = 'admin', writes = [], paymentStatus = 'pending', rolledBack = false, committed = false, cronRuns = 0;
const user = { id: 'user', role: 'user', aktif: true, plan: 'pkg' };
const pkg = { id: 'pkg', durasi: 2, satuan: 'hari' };
const query = async (sql, args) => {
  if (sql.startsWith('SELECT')) {
    if (sql.includes('packages')) return [pkg];
    if (sql.includes("role = 'admin'")) return [{ role: 'admin', aktif: true }];
    return [args[0] === 'admin' ? { role, aktif: true } : user];
  }
  writes.push({ sql, args }); return { affectedRows: 1 };
};
const connection = {
  beginTransaction: async () => {}, rollback: async () => { rolledBack = true; }, commit: async () => { committed = true; }, release() {},
  execute: async (sql, args) => {
    if (sql.includes('FROM payment_requests')) return [[{ id: 'pay', status: paymentStatus, package_id: 'pkg', user_id: 'user' }]];
    return [await query(sql, args)];
  }
};
const module = { exports: {} };
vm.runInNewContext(compiled, { exports: module.exports, module, Request, Response, URL, Buffer, console, process,
  require(name) {
    if (name === './db') return { query, initDatabase: async () => true, getPool: () => ({ getConnection: async () => connection }) };
    if (name === './auth') return { getAuthUserFromRequest: () => ({ userId: 'admin', role }) };
    if (name === './push') return {
      deletePushSubscription: async () => {}, getVapidPublicKey: () => 'public-key',
      runDuePushReminders: async () => { cronRuns++; return { sent: 0 }; }, savePushSubscription: async () => {},
      sendBroadcastTestPush: async () => ({ users: 1, subscriptions: 1, sent: 1, failed: 0, removed: 0 }),
      sendTestPush: async () => ({ subscriptions: 1, sent: 1, failed: 0, removed: 0 }),
      validatePushSubscription: () => true,
    };
    if (name === 'node:fs') return fs;
    if (name === 'node:crypto') return { default: crypto };
    if (name === 'node:path') return {};
    throw Error(name);
  }
});
const request = (path, method, body, headers = {}) => module.exports.handleApiRequest(new Request('http://localhost' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
process.env.CRON_SECRET = 'cron-test-secret';
assert.equal((await request('/api/internal/push-reminders', 'POST')).status, 401);
assert.equal(cronRuns, 0);
assert.equal((await request('/api/internal/push-reminders', 'POST', undefined, { Authorization: 'Bearer cron-test-secret' })).status, 200);
assert.equal(cronRuns, 1);
assert.equal((await request('/api/internal/push-test', 'POST')).status, 401);
assert.equal((await request('/api/internal/push-test', 'POST', undefined, { Authorization: 'Bearer cron-test-secret' })).status, 200);
role = 'user';
assert.equal((await request('/api/admin/users/user', 'DELETE')).status, 403);
assert.equal(writes.length, 0);
assert.equal((await request('/api/push/test', 'POST', {})).status, 200);
committed = false;
assert.equal((await request('/api/subscription', 'DELETE')).status, 200);
const cancellation = writes.findLast(w => w.sql.includes("sub_status_manual = 'cancelled'"));
assert.ok(cancellation);
assert.equal(cancellation.args[0], 'admin');
assert.equal(committed, true);
role = 'admin';
assert.equal((await request('/api/admin/users/admin', 'DELETE')).status, 403);
assert.equal((await request('/api/admin/users/user/status', 'PUT', { status: 'bad' })).status, 400);
assert.equal((await request('/api/admin/users/user/status', 'PUT', { status: 'active', plan: 'pkg', aktif: false })).status, 200);
let update = writes.at(-1);
assert.equal(update.args[1], false);
assert.equal(update.args[4] - update.args[3], 2 * 86400000);
assert.doesNotMatch(update.sql, /\?\s*=\s*'/);
assert.equal((await request('/api/admin/users/user/status', 'PUT', { status: 'trial', plan: 'pkg', aktif: true })).status, 200);
update = writes.at(-1);
assert.equal(update.args[2], null);
assert.ok(update.args[5]);
assert.equal(update.args[6] - update.args[5], 30 * 86400000);
assert.equal((await request('/api/admin/users/user', 'DELETE')).status, 200);
assert.match(writes.at(-1).sql, /DELETE FROM users/);
assert.equal((await request('/api/admin/packages/pkg', 'PUT', { aktif: false })).status, 200);
assert.ok(writes.at(-1).args.every(v => v !== undefined));
assert.equal((await request('/api/admin/packages', 'POST', { nama: 'bad', harga: -1 })).status, 400);
assert.equal((await request('/api/admin/content', 'PUT', { faq: [] })).status, 200);
assert.ok(writes.at(-1).args.every(v => v !== undefined));
assert.equal((await request('/api/admin/payments/pay/verify', 'PUT', { status: 'rejected', adminNote: '' })).status, 400);
assert.equal((await request('/api/admin/payments/pay/verify', 'PUT', { status: 'approved' })).status, 200);
assert.equal(committed, true);
update = writes.findLast(w => w.sql.startsWith('UPDATE users SET plan'));
assert.equal(update.args[0], 'pkg');
assert.equal(update.args[2] - update.args[1], 2 * 86400000);
paymentStatus = 'approved'; committed = false;
assert.equal((await request('/api/admin/payments/pay/verify', 'PUT', { status: 'approved' })).status, 409);
assert.equal(rolledBack, true); assert.equal(committed, false);
const html = fs.readFileSync(new URL('../public/smarta.html', import.meta.url), 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
console.log('Admin API regression checks and frontend JavaScript syntax passed.');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const tree = ts.createSourceFile('frontend.js', inline, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['adminRequest', 'pkgToggle', 'faqSave']);
const handlers = tree.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text)).map(n => n.getText(tree)).join('\n');
let fail = true, refreshes = 0, errors = 0;
const state = { packages: [{ id: 'pkg', aktif: true }], content: { faq: [{ q: 'old', a: 'old' }] } };
const ui = vm.createContext({ DB: state, API: { request: async () => { if (fail) throw Error('Save failed'); } },
  toast: () => errors++, refreshAdmin: async () => refreshes++, val: () => 'new', setErr: () => true });
vm.runInContext(handlers, ui);
await vm.runInContext('pkgToggle("pkg")', ui);
await vm.runInContext('faqSave(0)', ui);
assert.equal(refreshes, 0); assert.equal(errors, 2);
assert.equal(state.packages[0].aktif, true); assert.equal(state.content.faq[0].q, 'old');
fail = false;
await vm.runInContext('pkgToggle("pkg")', ui);
assert.equal(refreshes, 1);
console.log('Frontend failed saves leave cached state unchanged.');
