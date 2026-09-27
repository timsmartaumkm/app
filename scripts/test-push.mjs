import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/push.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

let claimed = false;
const statements = [];
const connection = {
  async execute(sql) {
    statements.push(sql);
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("FROM users u")) return [[{ id: "user-1", reminder_time: "20:00" }]];
    if (sql.includes("INSERT IGNORE INTO push_deliveries")) {
      if (claimed) return [{ affectedRows: 0 }];
      claimed = true; return [{ affectedRows: 1 }];
    }
    if (sql.includes("SELECT endpoint")) return [[
      { endpoint: "https://push.example/ok", p256dh: "key", auth: "auth" },
      { endpoint: "https://push.example/gone", p256dh: "key", auth: "auth" },
    ]];
    return [{ affectedRows: 1 }];
  },
  release() {},
};
const sent = [];
const webpush = {
  generateVAPIDKeys() {}, setVapidDetails() {},
  async sendNotification(subscription) {
    sent.push(subscription.endpoint);
    if (subscription.endpoint.endsWith("/gone")) throw { statusCode: 410 };
  },
};
const subscriptions = [
  { user_id: "user-1", endpoint: "https://push.example/ok", p256dh: "key", auth: "auth" },
  { user_id: "user-2", endpoint: "https://push.example/gone", p256dh: "key", auth: "auth" },
];
const module = { exports: {} };
vm.runInNewContext(compiled, {
  exports: module.exports, module, URL, Date, Intl, console, process,
  require(name) {
    if (name === "node:crypto") return { createHash: () => ({ update() { return this; }, digest: () => "hash" }), randomUUID: () => "notification-id" };
    if (name === "web-push") return webpush;
    if (name === "./db") return {
      query: async sql => sql.includes("FROM push_subscriptions") && sql.startsWith("SELECT") ? subscriptions : { affectedRows: 1 },
      getPool: () => ({ getConnection: async () => connection }),
    };
    throw Error(name);
  },
});

process.env.VAPID_PUBLIC_KEY = "public";
process.env.VAPID_PRIVATE_KEY = "private";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

assert.equal(module.exports.validatePushSubscription({ endpoint: "http://invalid", keys: { p256dh: "a", auth: "b" } }), false);
assert.equal(module.exports.validatePushSubscription({ endpoint: "https://push.example/id", keys: { p256dh: "a", auth: "b" } }), true);
const testDelivery = await module.exports.sendTestPush("user-1", false);
assert.equal(testDelivery.sent, 1);
assert.equal(testDelivery.removed, 1);
sent.length = 0;
const broadcast = await module.exports.sendBroadcastTestPush();
assert.equal(broadcast.users, 2);
assert.equal(broadcast.subscriptions, 2);
assert.equal(broadcast.sent, 1);
assert.equal(broadcast.removed, 1);
sent.length = 0;
const first = await module.exports.runDuePushReminders();
assert.equal(first.users, 1);
assert.equal(first.candidates, 1);
assert.equal(first.sent, 1);
assert.equal(first.removed, 1);
assert.ok(statements.some(sql => sql.includes("UPDATE push_deliveries SET status = 'sent'")));
assert.ok(statements.some(sql => sql.includes("DELETE FROM push_subscriptions")));

const second = await module.exports.runDuePushReminders();
assert.equal(second.users, 0);
assert.equal(second.alreadyProcessed, 1);
assert.equal(sent.length, 2);
console.log("Web Push validation, delivery, cleanup, and deduplication checks passed.");
