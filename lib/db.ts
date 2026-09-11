import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
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

export function getDbConfig(isDemo = false) {
  const host = process.env["DB_HOST"];
  const portStr = process.env["DB_PORT"];
  const user = process.env["DB_USER"];
  const password = process.env["DB_PASSWORD"];
  const database = isDemo ? (process.env["DB_DEMO_NAME"] || process.env["DB_NAME"]) : process.env["DB_NAME"];

  const missing: string[] = [];
  if (!host) missing.push("DB_HOST");
  if (!portStr) missing.push("DB_PORT");
  if (!user) missing.push("DB_USER");
  if (password === undefined) missing.push("DB_PASSWORD");
  if (!database) missing.push(isDemo ? "DB_DEMO_NAME or DB_NAME" : "DB_NAME");

  if (missing.length > 0) {
    throw new Error(`Missing required database environment variables: ${missing.join(", ")}`);
  }

  const port = parseInt(portStr!, 10);
  if (isNaN(port)) {
    throw new Error(`Invalid DB_PORT: "${portStr}". Must be a valid integer.`);
  }

  return { host: host!, port, user: user!, password: password!, database: database! };
}

let pool: Pool | null = null;
let demoPool: Pool | null = null;
let isInitialized = false;
let isDemoInitialized = false;

export function getPool(isDemo = false): Pool {
  if (isDemo) {
    if (!demoPool) {
      const config = getDbConfig(true);
      demoPool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      });
    }
    return demoPool;
  }

  if (!pool) {
    const config = getDbConfig(false);
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
}

export async function query<T extends RowDataPacket[] | ResultSetHeader>(
  sql: string,
  params: any[] = [],
  isDemo = false
): Promise<T> {
  const p = getPool(isDemo);
  const [results] = await p.execute<T>(sql, params);
  return results;
}

/**
 * Initializes database, tables, and system defaults if needed.
 */
export async function initDatabase(isDemo = false): Promise<boolean> {
  if (isDemo && isDemoInitialized) return true;
  if (!isDemo && isInitialized) return true;

  try {
    // Validate config exists
    getDbConfig(isDemo);

    const db = getPool(isDemo);

    // 1. Create tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        nama VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') DEFAULT 'user',
        aktif BOOLEAN DEFAULT TRUE,
        nama_usaha VARCHAR(255),
        jenis_usaha VARCHAR(64) DEFAULT 'Dagang',
        plan VARCHAR(64) DEFAULT 'pkg_trial',
        trial_start DATETIME NOT NULL,
        trial_end DATETIME NOT NULL,
        sub_status_manual VARCHAR(32) NULL,
        sub_start DATETIME NULL,
        sub_end DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS business_profiles (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) UNIQUE NOT NULL,
        nama_usaha VARCHAR(255),
        jenis_usaha VARCHAR(64),
        pemilik VARCHAR(255),
        email VARCHAR(255),
        hp VARCHAR(64),
        alamat TEXT,
        npwp VARCHAR(64),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        nama VARCHAR(255) NOT NULL,
        jenis ENUM('pemasukan', 'pengeluaran') NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        tanggal DATE NOT NULL,
        jenis ENUM('pemasukan', 'pengeluaran') NOT NULL,
        kategori VARCHAR(255) NOT NULL,
        nominal DECIMAL(15, 2) NOT NULL,
        akun_keuangan ENUM('usaha', 'pribadi') NOT NULL DEFAULT 'usaha',
        deskripsi TEXT,
        bukti VARCHAR(512) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_date (user_id, tanggal)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS packages (
        id VARCHAR(64) PRIMARY KEY,
        nama VARCHAR(255) NOT NULL,
        harga DECIMAL(15, 2) NOT NULL,
        durasi INT NOT NULL,
        satuan VARCHAR(32) NOT NULL DEFAULT 'bulan',
        batas INT NOT NULL DEFAULT 0,
        fitur JSON,
        aktif BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS payment_requests (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        package_id VARCHAR(64) NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        method VARCHAR(64) DEFAULT 'transfer_manual',
        proof VARCHAR(512) NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        admin_note TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        verified_at DATETIME NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        tag VARCHAR(128) NULL,
        judul VARCHAR(255) NOT NULL,
        isi TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id VARCHAR(64) PRIMARY KEY,
        reminder_on BOOLEAN DEFAULT TRUE,
        reminder_time VARCHAR(8) DEFAULT '20:00',
        monthly_report_notif BOOLEAN DEFAULT TRUE,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS site_content (
        id VARCHAR(64) PRIMARY KEY,
        tagline TEXT,
        sub TEXT,
        tentang TEXT,
        wa VARCHAR(64),
        about_title VARCHAR(255),
        about TEXT,
        visi TEXT,
        misi TEXT,
        email VARCHAR(255),
        faq JSON,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS reports (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        periode VARCHAR(32) NOT NULL,
        data JSON NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Ensure system default packages exist
    const [pkgRows] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) as cnt FROM packages");
    const pkgCount = (pkgRows[0] as any)?.cnt || 0;
    if (pkgCount === 0) {
      for (const pkg of DEFAULT_PACKAGES) {
        await db.execute(
          `INSERT INTO packages (id, nama, harga, durasi, satuan, batas, fitur, aktif) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [pkg.id, pkg.nama, pkg.harga, pkg.durasi, pkg.satuan, pkg.batas, JSON.stringify(pkg.fitur), pkg.aktif]
        );
      }
    }

    // 3. Ensure system site content exists
    const [contentRows] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) as cnt FROM site_content");
    const contentCount = (contentRows[0] as any)?.cnt || 0;
    if (contentCount === 0) {
      await db.execute(
        `INSERT INTO site_content (id, tagline, sub, tentang, wa, about_title, about, visi, misi, email, faq)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_CONTENT.tagline,
          DEFAULT_CONTENT.sub,
          DEFAULT_CONTENT.tentang,
          DEFAULT_CONTENT.wa,
          DEFAULT_CONTENT.about_title,
          DEFAULT_CONTENT.about,
          DEFAULT_CONTENT.visi,
          DEFAULT_CONTENT.misi,
          DEFAULT_CONTENT.email,
          JSON.stringify(DEFAULT_CONTENT.faq),
        ]
      );
    }

    if (isDemo) {
      isDemoInitialized = true;
    } else {
      isInitialized = true;
    }
    return true;
  } catch (err: any) {
    console.error(`${isDemo ? "Demo" : "Production"} database initialization error:`, err.message || err);
    throw err;
  }
}

export const DEFAULT_PACKAGES = [
  {
    id: "pkg_trial",
    nama: "Uji Coba Gratis",
    harga: 0,
    durasi: 30,
    satuan: "hari",
    batas: 100,
    fitur: ["Semua fitur lengkap", "Hingga 100 transaksi", "1 akun usaha", "Laporan laba rugi"],
    aktif: true,
  },
  {
    id: "pkg_6bulan",
    nama: "Langganan 6 Bulan",
    harga: 24000,
    durasi: 6,
    satuan: "bulan",
    batas: 0,
    fitur: [
      "Semua fitur lengkap",
      "Transaksi tidak terbatas",
      "Pisah keuangan pribadi & usaha",
      "Download laporan PDF",
      "Helpdesk email prioritas",
      "Chat bot 24 jam",
    ],
    aktif: true,
  },
];

export const DEFAULT_FAQ = [
  { q: "Bagaimana cara membuat akun?", a: "Klik Daftar Gratis, isi nama, email, password, nama usaha, dan jenis usaha. Akun baru mendapatkan uji coba gratis selama 30 hari." },
  { q: "Bagaimana cara mencatat transaksi?", a: "Masuk ke dashboard, pilih Tambah Transaksi, pilih pemasukan atau pengeluaran, isi tanggal, nominal, kategori, akun keuangan, lalu simpan transaksi." },
  { q: "Bagaimana cara upload foto bukti transaksi?", a: "Pada form Tambah Transaksi, pilih Upload Bukti Transaksi kemudian pilih foto nota atau struk dari perangkat." },
  { q: "Bagaimana cara mengambil foto dari kamera?", a: "Pilih Ambil Foto dari Kamera. Browser akan meminta izin untuk menggunakan kamera perangkat." },
  { q: "Bagaimana cara memisahkan keuangan usaha dan pribadi?", a: "Setiap transaksi memiliki pilihan Keuangan Usaha atau Keuangan Pribadi. Transaksi pribadi tidak masuk ke dalam laporan laba rugi usaha." },
  { q: "Bagaimana cara melihat laporan laba rugi?", a: "Buka menu Laporan Laba Rugi, pilih bulan dan tahun, kemudian sistem akan menghitung laporan berdasarkan transaksi keuangan usaha." },
  { q: "Bagaimana cara download laporan?", a: "Buka Laporan Laba Rugi kemudian gunakan tombol Download PDF atau fitur cetak browser untuk menyimpan laporan sebagai PDF." },
  { q: "Bagaimana cara kerja masa uji coba?", a: "Setiap akun baru mendapatkan Uji Coba Gratis 30 Hari dengan semua fitur terbuka." },
  { q: "Bagaimana cara berlangganan?", a: "Pilih Paket Langganan, pilih paket yang tersedia, kemudian ikuti proses konfirmasi pembayaran." },
  { q: "Bagaimana cara pembayarannya?", a: "Pembayaran dilakukan secara manual melalui WhatsApp admin. Pilih paket, klik Bayar melalui WhatsApp, lalu lakukan pembayaran dan konfirmasi bersama admin. Langganan diaktifkan setelah pembayaran diterima." }
];

export const DEFAULT_CONTENT = {
  tagline: "Catat keuangan usaha, pahami untung ruginya.",
  sub: "SMARTA UMKM membantu pelaku usaha dagang dan jasa mencatat transaksi harian, memisahkan keuangan usaha dan pribadi, serta membaca laporan laba rugi dengan bahasa yang mudah dipahami.",
  tentang: "SMARTA UMKM adalah platform pencatatan keuangan sederhana untuk UMKM Indonesia — pembukuan rapi, laporan otomatis, tanpa istilah akuntansi yang membingungkan.",
  wa: "0895635159345",
  about_title: "Tentang SMARTA UMKM",
  about: "SMARTA UMKM adalah platform pencatatan keuangan sederhana yang membantu UMKM mencatat transaksi, memisahkan keuangan usaha dan pribadi, serta memahami kondisi keuangan usaha.",
  visi: "Menjadi pendamping keuangan digital yang paling mudah digunakan oleh pelaku UMKM di Indonesia.",
  misi: "Menyediakan pembukuan sederhana, laporan laba rugi otomatis, dan edukasi keuangan yang membumi bagi usaha dagang dan jasa.",
  email: "smartaumkm@gmail.com",
  faq: DEFAULT_FAQ,
};

export const INCOME_CATS = ["Penjualan Barang", "Penjualan Jasa", "Pendapatan Lainnya", "Modal", "Lainnya"];
export const EXPENSE_CATS = ["Pembelian Barang", "Bahan Baku", "Gaji Karyawan", "Sewa Tempat", "Listrik & Air", "Transportasi", "Operasional", "Lainnya"];
