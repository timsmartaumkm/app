-- ==============================================================================
-- SMARTA UMKM — Initial Schema & Seed SQL
-- ==============================================================================

-- 1. Create Tables
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

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  nama VARCHAR(255) NOT NULL,
  jenis ENUM('pemasukan', 'pengeluaran') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS user_settings (
  user_id VARCHAR(64) PRIMARY KEY,
  reminder_on BOOLEAN DEFAULT TRUE,
  reminder_time VARCHAR(8) DEFAULT '20:00',
  monthly_report_notif BOOLEAN DEFAULT TRUE,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  periode VARCHAR(32) NOT NULL,
  data JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. System Default Packages
INSERT IGNORE INTO packages (id, nama, harga, durasi, satuan, batas, fitur, aktif) VALUES
('pkg_trial', 'Uji Coba Gratis', 0.00, 30, 'hari', 100, '["Semua fitur lengkap", "Hingga 100 transaksi", "1 akun usaha", "Laporan laba rugi"]', 1),
('pkg_6bulan', 'Langganan 6 Bulan', 24000.00, 6, 'bulan', 0, '["Semua fitur lengkap", "Transaksi tidak terbatas", "Pisah keuangan pribadi & usaha", "Download laporan PDF", "Helpdesk email prioritas", "Chat bot 24 jam"]', 1);

-- 3. System Default Site Content
INSERT IGNORE INTO site_content (id, tagline, sub, tentang, wa, about_title, about, visi, misi, email, faq) VALUES
('default', 'Catat keuangan usaha, pahami untung ruginya.', 'SMARTA UMKM membantu pelaku usaha dagang dan jasa mencatat transaksi harian, memisahkan keuangan usaha dan pribadi, serta membaca laporan laba rugi dengan bahasa yang mudah dipahami.', 'SMARTA UMKM adalah platform pencatatan keuangan sederhana untuk UMKM Indonesia — pembukuan rapi, laporan otomatis, tanpa istilah akuntansi yang membingungkan.', '0882000625630', 'Tentang SMARTA UMKM', 'SMARTA UMKM adalah platform pencatatan keuangan sederhana yang membantu UMKM mencatat transaksi, memisahkan keuangan usaha dan pribadi, serta memahami kondisi keuangan usaha.', 'Menjadi pendamping keuangan digital yang paling mudah digunakan oleh pelaku UMKM di Indonesia.', 'Menyediakan pembukuan sederhana, laporan laba rugi otomatis, dan edukasi keuangan yang membumi bagi usaha dagang dan jasa.', 'smartaumkm@gmail.com', '[]');

-- 4. Demo & Admin Seed Accounts
-- Demo user: demo@smartaumkm.id / demo123 (bcrypt hash: $2a$10$yFf6rE9/Xy4qJ3zJ5p2lXe1mQv9T6oJkFw0c7aZ9e1r2t3y4u5i6o)
-- Admin user: admin@smartaumkm.id / admin123 (bcrypt hash: $2a$10$lU7u0P9Kx1qJ3zJ5p2lXe1mQv9T6oJkFw0c7aZ9e1r2t3y4u5i6o)
-- (To seed with dynamic bcrypt hashes, run `npm run seed` or `node scripts/seed.mjs`)
