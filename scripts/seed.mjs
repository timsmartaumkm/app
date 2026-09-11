import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
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
const targetDbName = process.env.DB_DEMO_NAME || process.env.DB_NAME;

const missing = [];
if (!DB_HOST) missing.push("DB_DEMO_HOST or DB_HOST");
if (!DB_USER) missing.push("DB_DEMO_USER or DB_USER");
if (DB_PASSWORD === undefined) missing.push("DB_DEMO_PASSWORD or DB_PASSWORD");
if (!targetDbName) missing.push("DB_DEMO_NAME or DB_NAME");

if (missing.length > 0) {
  console.error(`Error: Missing required database environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const INCOME_CATS = ["Penjualan Barang", "Penjualan Jasa", "Pendapatan Lainnya", "Modal", "Lainnya"];
const EXPENSE_CATS = ["Pembelian Barang", "Bahan Baku", "Gaji Karyawan", "Sewa Tempat", "Listrik & Air", "Transportasi", "Operasional", "Lainnya"];

async function runSeed() {
  console.log(`Connecting to MySQL database '${targetDbName}' on ${DB_HOST}:${DB_PORT} as user '${DB_USER}'...`);
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: targetDbName,
  });

  console.log("Connected successfully. Seeding demo and admin accounts...");

  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const subEnd = new Date(now.getTime() + 150 * 24 * 60 * 60 * 1000);

  const demoPwHash = await bcrypt.hash("demo123", 10);
  const adminPwHash = await bcrypt.hash("admin123", 10);

  const demoId = "usr_demo_" + Math.random().toString(36).slice(2, 7);
  const adminId = "usr_admin_" + Math.random().toString(36).slice(2, 7);

  // Check existing
  const [existingDemo] = await conn.execute("SELECT id FROM users WHERE email = 'demo@smartaumkm.id'");
  if (existingDemo.length > 0) {
    console.log("Deleting previous demo user data...");
    await conn.execute("DELETE FROM users WHERE email = 'demo@smartaumkm.id'");
  }

  const [existingAdmin] = await conn.execute("SELECT id FROM users WHERE email = 'admin@smartaumkm.id'");
  if (existingAdmin.length > 0) {
    console.log("Deleting previous admin user data...");
    await conn.execute("DELETE FROM users WHERE email = 'admin@smartaumkm.id'");
  }

  // 1. Insert Demo User & Admin User
  await conn.execute(
    `INSERT INTO users (id, nama, email, password_hash, role, aktif, nama_usaha, jenis_usaha, plan, trial_start, trial_end)
     VALUES (?, ?, ?, ?, 'user', TRUE, ?, 'Dagang', 'pkg_trial', ?, ?)`,
    [demoId, "Bu Sum", "demo@smartaumkm.id", demoPwHash, "Toko Sembako Makmur Jaya", now, trialEnd]
  );
  console.log("✓ Created Demo User: demo@smartaumkm.id (password: demo123)");

  await conn.execute(
    `INSERT INTO users (id, nama, email, password_hash, role, aktif, nama_usaha, jenis_usaha, plan, trial_start, trial_end, sub_status_manual, sub_end)
     VALUES (?, ?, ?, ?, 'admin', TRUE, ?, 'Jasa', 'pkg_6bulan', ?, ?, 'active', ?)`,
    [adminId, "Admin SMARTA", "admin@smartaumkm.id", adminPwHash, "SMARTA UMKM", now, trialEnd, subEnd]
  );
  console.log("✓ Created Admin User: admin@smartaumkm.id (password: admin123)");

  // 2. Business profiles
  await conn.execute(
    `INSERT INTO business_profiles (id, user_id, nama_usaha, jenis_usaha, pemilik, email, hp, alamat)
     VALUES (?, ?, ?, 'Dagang', 'Bu Sum', 'busum@email.com', '0812-3456-7890', 'Jl. Pasar Baru No. 12, Surakarta')`,
    ["bp_" + demoId, demoId, "Toko Sembako Makmur Jaya"]
  );

  await conn.execute(
    `INSERT INTO business_profiles (id, user_id, nama_usaha, jenis_usaha, pemilik, email, hp, alamat)
     VALUES (?, ?, ?, 'Jasa', 'Admin SMARTA', 'admin@smartaumkm.id', '0800-1234-5678', 'Surakarta, Jawa Tengah')`,
    ["bp_" + adminId, adminId, "SMARTA UMKM"]
  );

  // 3. User settings
  await conn.execute(`INSERT INTO user_settings (user_id, reminder_on, reminder_time, monthly_report_notif) VALUES (?, TRUE, '20:00', TRUE)`, [demoId]);
  await conn.execute(`INSERT INTO user_settings (user_id, reminder_on, reminder_time, monthly_report_notif) VALUES (?, TRUE, '20:00', TRUE)`, [adminId]);

  // 4. Default categories
  for (const uid of [demoId, adminId]) {
    for (const cat of INCOME_CATS) {
      await conn.execute(`INSERT INTO categories (id, user_id, nama, jenis) VALUES (?, ?, ?, 'pemasukan')`, [
        "cat_" + Math.random().toString(36).slice(2, 9),
        uid,
        cat,
      ]);
    }
    for (const cat of EXPENSE_CATS) {
      await conn.execute(`INSERT INTO categories (id, user_id, nama, jenis) VALUES (?, ?, ?, 'pengeluaran')`, [
        "cat_" + Math.random().toString(36).slice(2, 9),
        uid,
        cat,
      ]);
    }
  }

  // 5. Sample transactions for demo user
  const mkTx = (monthOffset, day, jenis, kategori, nominal, deskripsi, akun = "usaha") => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, day);
    const dateStr = d.toISOString().slice(0, 10);
    return [
      "trx_" + Math.random().toString(36).slice(2, 9),
      demoId,
      dateStr,
      jenis,
      kategori,
      nominal,
      akun,
      deskripsi,
      null,
      d,
    ];
  };

  const sampleTxs = [
    mkTx(0, 2, "pemasukan", "Penjualan Barang", 850000, "Penjualan Beras 5kg"),
    mkTx(0, 1, "pemasukan", "Penjualan Barang", 320000, "Penjualan Minyak Goreng"),
    mkTx(0, 3, "pemasukan", "Penjualan Jasa", 1200000, "Jasa antar barang pelanggan"),
    mkTx(0, 1, "pengeluaran", "Pembelian Barang", 420000, "Beli Stok Gula"),
    mkTx(0, 1, "pengeluaran", "Operasional", 185000, "Tagihan Listrik"),
    mkTx(0, 4, "pengeluaran", "Gaji Karyawan", 1200000, "Gaji karyawan toko"),
    mkTx(0, 5, "pengeluaran", "Sewa Tempat", 500000, "Sewa kios pasar"),
    mkTx(0, 6, "pengeluaran", "Transportasi", 265000, "Bensin & angkut barang"),
    mkTx(0, 7, "pemasukan", "Penjualan Barang", 1450000, "Penjualan sembako mingguan"),
    mkTx(0, 8, "pengeluaran", "Bahan Baku", 680000, "Kulakan minyak & tepung"),
    mkTx(0, 3, "pemasukan", "Modal", 2000000, "Pengambilan laba pemilik", "pribadi"),
    mkTx(0, 2, "pengeluaran", "Lainnya", 650000, "Belanja kebutuhan rumah", "pribadi"),
    mkTx(1, 5, "pemasukan", "Penjualan Barang", 4200000, "Penjualan bulan lalu"),
    mkTx(1, 6, "pemasukan", "Penjualan Jasa", 900000, "Jasa titip barang"),
    mkTx(1, 7, "pengeluaran", "Pembelian Barang", 2100000, "Kulakan stok"),
    mkTx(1, 8, "pengeluaran", "Listrik & Air", 210000, "Listrik & air"),
    mkTx(1, 9, "pengeluaran", "Gaji Karyawan", 1200000, "Gaji karyawan"),
    mkTx(2, 5, "pemasukan", "Penjualan Barang", 3800000, "Penjualan dua bulan lalu"),
    mkTx(2, 7, "pengeluaran", "Pembelian Barang", 1750000, "Kulakan stok"),
    mkTx(2, 9, "pengeluaran", "Operasional", 320000, "Perawatan alat & kemasan"),
  ];

  for (const t of sampleTxs) {
    await conn.execute(
      `INSERT INTO transactions (id, user_id, tanggal, jenis, kategori, nominal, akun_keuangan, deskripsi, bukti, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t
    );
  }
  console.log(`✓ Inserted ${sampleTxs.length} sample transactions for demo user.`);

  await conn.end();
  console.log("\nDatabase seeding completed successfully!");
}

runSeed().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
});
