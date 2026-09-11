import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile() {
  try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          process.env[key] = val;
        }
      }
    }
  } catch (e) {}
}
loadEnvFile();

const DB_HOST = process.env.DB_DEMO_HOST || process.env.DB_HOST;
const DB_PORT = process.env.DB_DEMO_PORT ? parseInt(process.env.DB_DEMO_PORT, 10) : (process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306);
const DB_USER = process.env.DB_DEMO_USER || process.env.DB_USER;
const DB_PASSWORD = process.env.DB_DEMO_PASSWORD !== undefined ? process.env.DB_DEMO_PASSWORD : process.env.DB_PASSWORD;
const DB_DEMO_NAME = process.env.DB_DEMO_NAME || process.env.DB_NAME;
const UPLOAD_DEMO_DIR = process.env.UPLOAD_DEMO_DIR || "public/uploads/demo";

if (!DB_HOST || !DB_USER || DB_PASSWORD === undefined || !DB_DEMO_NAME) {
  console.error("Error: Missing required database environment variables (DB_DEMO_HOST/DB_HOST, DB_DEMO_USER/DB_USER, DB_DEMO_PASSWORD/DB_PASSWORD, DB_DEMO_NAME).");
  process.exit(1);
}

async function cleanDemo() {
  console.log(`--- Cleaning Demo Data on '${DB_DEMO_NAME}' (User: ${DB_USER}) ---`);

  // 1. Clean Database
  try {
    const conn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_DEMO_NAME,
    });

    console.log("Connected to Demo Database. Truncating user-generated tables...");
    await conn.execute("SET FOREIGN_KEY_CHECKS = 0;");
    await conn.execute("TRUNCATE TABLE transactions;");
    await conn.execute("TRUNCATE TABLE categories;");
    await conn.execute("TRUNCATE TABLE payment_requests;");
    await conn.execute("TRUNCATE TABLE notifications;");
    await conn.execute("TRUNCATE TABLE user_settings;");
    await conn.execute("TRUNCATE TABLE business_profiles;");
    await conn.execute("TRUNCATE TABLE reports;");
    await conn.execute("TRUNCATE TABLE users;");
    await conn.execute("SET FOREIGN_KEY_CHECKS = 1;");
    await conn.end();
    console.log("✓ Demo Database tables truncated cleanly.");
  } catch (err) {
    console.error("Failed to clean demo database:", err.message || err);
  }

  // 2. Clean Demo Upload Files
  const demoUploadPath = path.resolve(process.cwd(), UPLOAD_DEMO_DIR);
  if (fs.existsSync(demoUploadPath)) {
    const files = fs.readdirSync(demoUploadPath);
    let count = 0;
    for (const f of files) {
      if (f === ".gitkeep") continue;
      const p = path.join(demoUploadPath, f);
      try {
        fs.unlinkSync(p);
        count++;
      } catch (e) {}
    }
    console.log(`✓ Cleaned ${count} demo uploaded files in '${UPLOAD_DEMO_DIR}'.`);
  } else {
    fs.mkdirSync(demoUploadPath, { recursive: true });
    console.log(`✓ Created demo upload directory '${UPLOAD_DEMO_DIR}'.`);
  }

  console.log("\nDemo cleanup completed successfully! Run `npm run seed` to reseed demo data anytime.\n");
}

cleanDemo();
