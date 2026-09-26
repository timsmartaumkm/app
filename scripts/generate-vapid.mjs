import webpush from "web-push";
import crypto from "node:crypto";

const keys = webpush.generateVAPIDKeys();
console.log("Add these values to Hostinger environment variables and .env.local:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:smartaumkm@gmail.com");
console.log(`CRON_SECRET=${crypto.randomBytes(32).toString("base64url")}`);
