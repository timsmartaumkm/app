import crypto from "node:crypto";
import webpush, { type PushSubscription } from "web-push";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "./db";

const REMINDER_TYPE = "daily_transaction_reminder";

interface DueUserRow extends RowDataPacket {
  id: string;
  reminder_time: string;
}

interface PushSubscriptionRow extends RowDataPacket {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export function getVapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"]?.trim() || null;
}

function configureWebPush() {
  const publicKey = getVapidPublicKey();
  const privateKey = process.env["VAPID_PRIVATE_KEY"]?.trim();
  const subject = process.env["VAPID_SUBJECT"]?.trim();
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push is not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export function validatePushSubscription(value: unknown): value is PushSubscriptionInput {
  if (!value || typeof value !== "object") return false;
  const subscription = value as Partial<PushSubscriptionInput>;
  if (typeof subscription.endpoint !== "string" || subscription.endpoint.length > 2048) return false;
  try {
    if (new URL(subscription.endpoint).protocol !== "https:") return false;
  } catch {
    return false;
  }
  return Boolean(
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" && subscription.keys.p256dh.length <= 512 &&
    typeof subscription.keys.auth === "string" && subscription.keys.auth.length <= 512
  );
}

export async function savePushSubscription(userId: string, subscription: PushSubscriptionInput, userAgent: string, isDemo: boolean) {
  const id = crypto.createHash("sha256").update(subscription.endpoint).digest("hex");
  await query<ResultSetHeader>(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, expiration_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth),
       user_agent = VALUES(user_agent), expiration_time = VALUES(expiration_time), updated_at = CURRENT_TIMESTAMP`,
    [id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth,
      userAgent.slice(0, 512), subscription.expirationTime ? new Date(subscription.expirationTime) : null],
    isDemo
  );
}

export async function deletePushSubscription(userId: string, endpoint: string, isDemo: boolean) {
  await query<ResultSetHeader>("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", [userId, endpoint], isDemo);
}

export async function sendTestPush(userId: string, isDemo: boolean) {
  configureWebPush();
  const subscriptions = await query<PushSubscriptionRow[]>(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    [userId],
    isDemo
  );
  const result = { subscriptions: subscriptions.length, sent: 0, failed: 0, removed: 0 };
  const payload = JSON.stringify({
    title: "Tes notifikasi SMARTA UMKM",
    body: "Web Push berhasil terhubung ke perangkat ini.",
    tag: `smarta-push-test-${Date.now()}`,
    url: "/",
  });
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      } as PushSubscription, payload, { TTL: 300, urgency: "high" });
      result.sent += 1;
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await query<ResultSetHeader>("DELETE FROM push_subscriptions WHERE endpoint = ?", [subscription.endpoint], isDemo);
        result.removed += 1;
      } else {
        console.error("Web Push test delivery failed:", error?.statusCode || error?.message || error);
        result.failed += 1;
      }
    }
  }
  return result;
}

function jakartaClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, time: `${parts["hour"]}:${parts["minute"]}` };
}

export async function runDuePushReminders() {
  configureWebPush();
  const db = getPool(false);
  const connection = await db.getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK('smarta_push_reminders', 0) AS acquired");
    locked = Number(lockRows[0]?.["acquired"]) === 1;
    if (!locked) return { skipped: true, reason: "Another reminder job is running", candidates: 0, users: 0, alreadyProcessed: 0, sent: 0, failed: 0, removed: 0 };

    await connection.execute(
      "DELETE FROM push_deliveries WHERE status = 'pending' AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)"
    );

    const clock = jakartaClock();
    const [users] = await connection.execute<DueUserRow[]>(
      `SELECT u.id, s.reminder_time
       FROM users u
       JOIN user_settings s ON s.user_id = u.id
       WHERE u.aktif = TRUE AND u.role = 'user' AND s.reminder_on = TRUE
         AND LEFT(s.reminder_time, 5) <= ?
         AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.tanggal = ?)`,
      [clock.time, clock.date]
    );

    const result = { skipped: false, candidates: users.length, users: 0, alreadyProcessed: 0, sent: 0, failed: 0, removed: 0 };
    for (const user of users) {
      const [claim] = await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO push_deliveries (user_id, notification_type, delivery_date, status)
         VALUES (?, ?, ?, 'pending')`,
        [user.id, REMINDER_TYPE, clock.date]
      );
      if (claim.affectedRows !== 1) {
        result.alreadyProcessed += 1;
        continue;
      }
      result.users += 1;

      const [subscriptions] = await connection.execute<PushSubscriptionRow[]>(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
        [user.id]
      );
      let delivered = 0;
      for (const subscription of subscriptions) {
        const payload = JSON.stringify({
          title: "Pengingat pencatatan",
          body: `Anda belum mencatat transaksi hari ini. Pengingat harian aktif pukul ${String(user.reminder_time).slice(0, 5)} WIB.`,
          tag: `smarta-daily-reminder-${clock.date}`,
          url: "/",
        });
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          } as PushSubscription, payload, { TTL: 3600, urgency: "normal" });
          delivered += 1;
          result.sent += 1;
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await connection.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", [subscription.endpoint]);
            result.removed += 1;
          } else {
            console.error("Web Push delivery failed:", error?.statusCode || error?.message || error);
            result.failed += 1;
          }
        }
      }

      if (delivered > 0) {
        await connection.execute(
          "UPDATE push_deliveries SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE user_id = ? AND notification_type = ? AND delivery_date = ?",
          [user.id, REMINDER_TYPE, clock.date]
        );
        await connection.execute(
          `INSERT INTO notifications (id, user_id, tag, judul, isi)
           VALUES (?, ?, ?, 'Pengingat pencatatan', ?)`,
          [crypto.randomUUID(), user.id, `reminder_${clock.date}`,
            `Anda belum mencatat transaksi hari ini. Pengingat harian aktif pukul ${String(user.reminder_time).slice(0, 5)} WIB.`]
        );
      } else {
        await connection.execute(
          "DELETE FROM push_deliveries WHERE user_id = ? AND notification_type = ? AND delivery_date = ?",
          [user.id, REMINDER_TYPE, clock.date]
        );
      }
    }
    return result;
  } finally {
    if (locked) await connection.execute("SELECT RELEASE_LOCK('smarta_push_reminders')");
    connection.release();
  }
}
