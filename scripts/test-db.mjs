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

const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

const missing = [];
if (!DB_HOST) missing.push("DB_HOST");
if (!DB_PORT) missing.push("DB_PORT");
if (!DB_USER) missing.push("DB_USER");
if (DB_PASSWORD === undefined) missing.push("DB_PASSWORD");
if (!DB_NAME) missing.push("DB_NAME");

if (missing.length > 0) {
  console.error(`Error: Missing required database environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Connecting to MySQL at:", { host: DB_HOST, port: DB_PORT, user: DB_USER, database: DB_NAME });

try {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  console.log("MySQL connection successful!");

  await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  console.log(`Database '${DB_NAME}' created or verified.`);
  await conn.end();
} catch (err) {
  console.error("MySQL connection error:", err);
  process.exit(1);
}
