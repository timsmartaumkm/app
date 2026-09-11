import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
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

export function getDbConfig() {
  const host = process.env["DB_HOST"];
  const portStr = process.env["DB_PORT"];
  const user = process.env["DB_USER"];
  const password = process.env["DB_PASSWORD"];
  const database = process.env["DB_NAME"];

  const missing: string[] = [];
  if (!host) missing.push("DB_HOST");
  if (!portStr) missing.push("DB_PORT");
  if (!user) missing.push("DB_USER");
  if (password === undefined) missing.push("DB_PASSWORD");
  if (!database) missing.push("DB_NAME");

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
let isInitialized = false;

export function getPool(): Pool {
  if (!pool) {
    const config = getDbConfig();
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
  params: any[] = []
): Promise<T> {
  const p = getPool();
  const [results] = await p.execute<T>(sql, params);
  return results;
}

/**
 * Initializes database, tables, and demo seed data if needed.
 */
export async function initDatabase(): Promise<boolean> {
  if (isInitialized) return true;

  try {
    // Validate config exists
    getDbConfig();

    const db = getPool();

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

    // 2. Seed default data if users table is empty
    const [rows] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) as cnt FROM users");
    const count = (rows[0] as any)?.cnt || 0;

    if (count === 0) {
      await seedDatabase(db);
    }

    isInitialized = true;
    return true;
  } catch (err: any) {
    console.error("Database initialization error:", err.message || err);
    throw err;
  }
}

const DEFAULT_PACKAGES = [
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

const DEFAULT_FAQ = [
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

const DEFAULT_CONTENT = {
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

const INCOME_CATS = ["Penjualan Barang", "Penjualan Jasa", "Pendapatan Lainnya", "Modal", "Lainnya"];
const EXPENSE_CATS = ["Pembelian Barang", "Bahan Baku", "Gaji Karyawan", "Sewa Tempat", "Listrik & Air", "Transportasi", "Operasional", "Lainnya"];

async function seedDatabase(db: Pool) {
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const subEnd = new Date(now.getTime() + 150 * 24 * 60 * 60 * 1000);

  const demoPwHash = await bcrypt.hash("demo123", 10);
  const adminPwHash = await bcrypt.hash("admin123", 10);

  const demoId = "usr_demo_" + Math.random().toString(36).slice(2, 7);
  const adminId = "usr_admin_" + Math.random().toString(36).slice(2, 7);

  // 1. Insert users
  await db.execute(
    `INSERT INTO users (id, nama, email, password_hash, role, aktif, nama_usaha, jenis_usaha, plan, trial_start, trial_end)
     VALUES (?, ?, ?, ?, 'user', TRUE, ?, 'Dagang', 'pkg_trial', ?, ?)`,
    [demoId, "Bu Sum", "demo@smartaumkm.id", demoPwHash, "Toko Sembako Makmur Jaya", now, trialEnd]
  );

  await db.execute(
    `INSERT INTO users (id, nama, email, password_hash, role, aktif, nama_usaha, jenis_usaha, plan, trial_start, trial_end, sub_status_manual, sub_end)
     VALUES (?, ?, ?, ?, 'admin', TRUE, ?, 'Jasa', 'pkg_6bulan', ?, ?, 'active', ?)`,
    [adminId, "Admin SMARTA", "admin@smartaumkm.id", adminPwHash, "SMARTA UMKM", now, trialEnd, subEnd]
  );

  // 2. Business profiles
  await db.execute(
    `INSERT INTO business_profiles (id, user_id, nama_usaha, jenis_usaha, pemilik, email, hp, alamat)
     VALUES (?, ?, ?, 'Dagang', 'Bu Sum', 'busum@email.com', '0812-3456-7890', 'Jl. Pasar Baru No. 12, Surakarta')`,
    ["bp_" + demoId, demoId, "Toko Sembako Makmur Jaya"]
  );

  await db.execute(
    `INSERT INTO business_profiles (id, user_id, nama_usaha, jenis_usaha, pemilik, email, hp, alamat)
     VALUES (?, ?, ?, 'Jasa', 'Admin SMARTA', 'admin@smartaumkm.id', '0800-1234-5678', 'Surakarta, Jawa Tengah')`,
    ["bp_" + adminId, adminId, "SMARTA UMKM"]
  );

  // 3. User settings
  await db.execute(`INSERT INTO user_settings (user_id, reminder_on, reminder_time, monthly_report_notif) VALUES (?, TRUE, '20:00', TRUE)`, [demoId]);
  await db.execute(`INSERT INTO user_settings (user_id, reminder_on, reminder_time, monthly_report_notif) VALUES (?, TRUE, '20:00', TRUE)`, [adminId]);

  // 4. Default categories for both users
  for (const uid of [demoId, adminId]) {
    for (const cat of INCOME_CATS) {
      await db.execute(`INSERT INTO categories (id, user_id, nama, jenis) VALUES (?, ?, ?, 'pemasukan')`, [
        "cat_" + Math.random().toString(36).slice(2, 9),
        uid,
        cat,
      ]);
    }
    for (const cat of EXPENSE_CATS) {
      await db.execute(`INSERT INTO categories (id, user_id, nama, jenis) VALUES (?, ?, ?, 'pengeluaran')`, [
        "cat_" + Math.random().toString(36).slice(2, 9),
        uid,
        cat,
      ]);
    }
  }

  // 5. Packages
  for (const pkg of DEFAULT_PACKAGES) {
    await db.execute(
      `INSERT INTO packages (id, nama, harga, durasi, satuan, batas, fitur, aktif) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [pkg.id, pkg.nama, pkg.harga, pkg.durasi, pkg.satuan, pkg.batas, JSON.stringify(pkg.fitur), pkg.aktif]
    );
  }

  // 6. Site Content
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

  // 7. Seed sample transactions for demo user
  const mkTx = (monthOffset: number, day: number, jenis: string, kategori: string, nominal: number, deskripsi: string, akun: string = "usaha") => {
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
    await db.execute(
      `INSERT INTO transactions (id, user_id, tanggal, jenis, kategori, nominal, akun_keuangan, deskripsi, bukti, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t
    );
  }
}
