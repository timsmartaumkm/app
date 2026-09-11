import { promises as fs } from "node:fs";
import path from "node:path";
import { query, initDatabase } from "./db";
import { hashPassword, verifyPassword, signToken, getAuthUserFromRequest } from "./auth";
import type { RowDataPacket } from "mysql2/promise";

function getTargetUploadDir(isDemoUpload: boolean): string {
  if (isDemoUpload) {
    const customDemoDir = process.env["UPLOAD_DEMO_DIR"];
    if (customDemoDir) {
      return path.isAbsolute(customDemoDir) ? customDemoDir : path.resolve(process.cwd(), customDemoDir);
    }
    const customBaseDir = process.env["UPLOAD_DIR"];
    if (customBaseDir) {
      const base = path.isAbsolute(customBaseDir) ? customBaseDir : path.resolve(process.cwd(), customBaseDir);
      return path.join(base, "demo");
    }
    return path.resolve(process.cwd(), "public/uploads/demo");
  }

  const customDir = process.env["UPLOAD_DIR"];
  if (customDir) {
    return path.isAbsolute(customDir) ? customDir : path.resolve(process.cwd(), customDir);
  }
  return path.resolve(process.cwd(), "public/uploads");
}

interface UserRow extends RowDataPacket {
  id: string;
  nama: string;
  email: string;
  password_hash: string;
  role: "user" | "admin";
  aktif: number | boolean;
  nama_usaha: string | null;
  jenis_usaha: string | null;
  plan: string;
  trial_start: Date | string;
  trial_end: Date | string;
  sub_status_manual: string | null;
  sub_start: Date | string | null;
  sub_end: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  txCount?: number;
}

interface BusinessProfileRow extends RowDataPacket {
  id: string;
  user_id: string;
  nama_usaha: string | null;
  jenis_usaha: string | null;
  pemilik: string | null;
  email: string | null;
  hp: string | null;
  alamat: string | null;
  npwp: string | null;
}

interface TransactionRow extends RowDataPacket {
  id: string;
  user_id: string;
  tanggal: Date | string;
  jenis: "pemasukan" | "pengeluaran";
  kategori: string;
  nominal: number | string;
  akun_keuangan: "usaha" | "pribadi";
  deskripsi: string | null;
  bukti: string | null;
  created_at: Date | string;
}

interface CategoryRow extends RowDataPacket {
  id: string;
  user_id: string;
  nama: string;
  jenis: "pemasukan" | "pengeluaran";
}

interface PackageRow extends RowDataPacket {
  id: string;
  nama: string;
  harga: number | string;
  durasi: number;
  satuan: string;
  batas: number;
  fitur: string | any[];
  aktif: number | boolean;
}

interface PaymentRequestRow extends RowDataPacket {
  id: string;
  user_id: string;
  package_id: string;
  amount: number | string;
  method: string;
  proof: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  submitted_at: Date | string;
  verified_at: Date | string | null;
  userNama?: string;
  userEmail?: string;
  userNamaUsaha?: string;
}

interface NotificationRow extends RowDataPacket {
  id: string;
  user_id: string;
  tag: string | null;
  judul: string;
  isi: string;
  is_read: number | boolean;
  created_at: Date | string;
}

interface SettingRow extends RowDataPacket {
  user_id: string;
  reminder_on: number | boolean;
  reminder_time: string;
  monthly_report_notif: number | boolean;
}

interface SiteContentRow extends RowDataPacket {
  id: string;
  tagline: string | null;
  sub: string | null;
  tentang: string | null;
  wa: string | null;
  about_title: string | null;
  about: string | null;
  visi: string | null;
  misi: string | null;
  email: string | null;
  faq: string | any[] | null;
}

interface ReportRow extends RowDataPacket {
  id: string;
  user_id: string;
  periode: string;
  data: string | any;
}

function jsonResponse(data: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function uid(p = "id") {
  return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDateString(val: any): string {
  if (!val) return "";
  if (typeof val === "string") return val.slice(0, 10);
  if (val instanceof Date) {
    const year = val.getFullYear();
    const month = String(val.getMonth() + 1).padStart(2, "0");
    const day = String(val.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(val).slice(0, 10);
}

export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/")) {
    return null;
  }

  const method = request.method;

  try {
    const authUser = getAuthUserFromRequest(request);
    const isDemo = Boolean(authUser?.isDemo);

    // Ensure database initialized for current context
    await initDatabase(isDemo);

    /* ----------------------------------------------------
       AUTH ENDPOINTS
       ---------------------------------------------------- */
    // POST /api/auth/register
    if (pathname === "/api/auth/register" && method === "POST") {
      const body = await request.json();
      const { nama, email, password, namaUsaha, jenisUsaha } = body;

      if (!nama || !email || !password || !namaUsaha) {
        return jsonResponse({ error: "Semua kolom wajib diisi." }, 400);
      }

      const cleanEmail = String(email).toLowerCase().trim();
      const existing = await query<UserRow[]>("SELECT id FROM users WHERE email = ?", [cleanEmail], false);
      if (existing.length > 0) {
        return jsonResponse({ error: "Email sudah terdaftar." }, 400);
      }

      const userId = uid("usr");
      const pwHash = await hashPassword(password);
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await query(
        `INSERT INTO users (id, nama, email, password_hash, role, aktif, nama_usaha, jenis_usaha, plan, trial_start, trial_end)
         VALUES (?, ?, ?, ?, 'user', TRUE, ?, ?, 'pkg_trial', ?, ?)`,
        [userId, nama, cleanEmail, pwHash, namaUsaha, jenisUsaha || "Dagang", now, trialEnd],
        false
      );

      // Create business profile
      await query(
        `INSERT INTO business_profiles (id, user_id, nama_usaha, jenis_usaha, pemilik, email, hp, alamat)
         VALUES (?, ?, ?, ?, ?, ?, '', '')`,
        ["bp_" + userId, userId, namaUsaha, jenisUsaha || "Dagang", nama, cleanEmail],
        false
      );

      // Create user settings
      await query(`INSERT INTO user_settings (user_id, reminder_on, reminder_time, monthly_report_notif) VALUES (?, TRUE, '20:00', TRUE)`, [userId], false);

      // Create default categories
      const INCOME_CATS = ["Penjualan Barang", "Penjualan Jasa", "Pendapatan Lainnya", "Modal", "Lainnya"];
      const EXPENSE_CATS = ["Pembelian Barang", "Bahan Baku", "Gaji Karyawan", "Sewa Tempat", "Listrik & Air", "Transportasi", "Operasional", "Lainnya"];

      for (const cat of INCOME_CATS) {
        await query(`INSERT INTO categories (id, user_id, nama, jenis) VALUES (?, ?, ?, 'pemasukan')`, [uid("cat"), userId, cat], false);
      }
      for (const cat of EXPENSE_CATS) {
        await query(`INSERT INTO categories (id, user_id, nama, jenis) VALUES (?, ?, ?, 'pengeluaran')`, [uid("cat"), userId, cat], false);
      }

      // Initial notification
      await query(
        `INSERT INTO notifications (id, user_id, tag, judul, isi) VALUES (?, ?, 'welcome', 'Uji Coba Gratis 30 Hari dimulai', 'Semua fitur terbuka selama 30 hari.')`,
        [uid("ntf"), userId],
        false
      );

      const token = signToken({ userId, email: cleanEmail, role: "user", isDemo: false });
      const user = {
        id: userId,
        nama,
        email: cleanEmail,
        role: "user",
        aktif: true,
        namaUsaha,
        jenisUsaha: jenisUsaha || "Dagang",
        plan: "pkg_trial",
        trialStart: now.toISOString(),
        trialEnd: trialEnd.toISOString(),
        subStatusManual: null,
        subEnd: null,
      };

      return jsonResponse({ success: true, token, user });
    }

    // POST /api/auth/login
    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await request.json();
      const { email, password } = body;

      const cleanEmail = String(email || "").toLowerCase().trim();
      const isDemoLogin = cleanEmail === "demo@smartaumkm.id";

      await initDatabase(isDemoLogin);
      const rows = await query<UserRow[]>("SELECT * FROM users WHERE email = ?", [cleanEmail], isDemoLogin);

      if (rows.length === 0) {
        return jsonResponse({ error: "Email atau password salah." }, 401);
      }

      const u = rows[0]!;
      if (!u.aktif) {
        return jsonResponse({ error: "Akun Anda dinonaktifkan. Hubungi admin." }, 403);
      }

      const isValid = await verifyPassword(password, u.password_hash);
      if (!isValid) {
        return jsonResponse({ error: "Email atau password salah." }, 401);
      }

      const token = signToken({ userId: u.id, email: u.email, role: u.role, isDemo: isDemoLogin });
      const user = {
        id: u.id,
        nama: u.nama,
        email: u.email,
        role: u.role,
        aktif: Boolean(u.aktif),
        namaUsaha: u.nama_usaha,
        jenisUsaha: u.jenis_usaha,
        plan: u.plan,
        trialStart: u.trial_start ? new Date(u.trial_start).toISOString() : null,
        trialEnd: u.trial_end ? new Date(u.trial_end).toISOString() : null,
        subStatusManual: u.sub_status_manual,
        subStart: u.sub_start ? new Date(u.sub_start).toISOString() : null,
        subEnd: u.sub_end ? new Date(u.sub_end).toISOString() : null,
      };

      return jsonResponse({ success: true, token, user });
    }

    // GET /api/auth/me
    if (pathname === "/api/auth/me" && method === "GET") {
      if (!authUser) return jsonResponse({ user: null });

      const rows = await query<UserRow[]>("SELECT * FROM users WHERE id = ?", [authUser.userId], isDemo);
      if (rows.length === 0) return jsonResponse({ user: null });

      const u = rows[0]!;
      const user = {
        id: u.id,
        nama: u.nama,
        email: u.email,
        role: u.role,
        aktif: Boolean(u.aktif),
        namaUsaha: u.nama_usaha,
        jenisUsaha: u.jenis_usaha,
        plan: u.plan,
        trialStart: u.trial_start ? new Date(u.trial_start).toISOString() : null,
        trialEnd: u.trial_end ? new Date(u.trial_end).toISOString() : null,
        subStatusManual: u.sub_status_manual,
        subStart: u.sub_start ? new Date(u.sub_start).toISOString() : null,
        subEnd: u.sub_end ? new Date(u.sub_end).toISOString() : null,
      };

      return jsonResponse({ user });
    }

    // PUT /api/auth/password
    if (pathname === "/api/auth/password" && method === "PUT") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);

      const body = await request.json();
      const { currentPassword, newPassword } = body;

      const rows = await query<UserRow[]>("SELECT password_hash FROM users WHERE id = ?", [authUser.userId], isDemo);
      if (rows.length === 0) return jsonResponse({ error: "User tidak ditemukan." }, 404);

      const isValid = await verifyPassword(currentPassword, rows[0]!.password_hash);
      if (!isValid) return jsonResponse({ error: "Password saat ini salah." }, 400);

      const newHash = await hashPassword(newPassword);
      await query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, authUser.userId], isDemo);

      return jsonResponse({ success: true, message: "Password berhasil diperbarui." });
    }

    /* ----------------------------------------------------
       BOOTSTRAP / FULL SYNC ENDPOINT
       ---------------------------------------------------- */
    if (pathname === "/api/bootstrap" && method === "GET") {
      // 1. Content and packages
      const contentRows = await query<SiteContentRow[]>("SELECT * FROM site_content LIMIT 1", [], isDemo);
      const rawContent = contentRows[0];
      const content = {
        tagline: rawContent?.tagline || "",
        sub: rawContent?.sub || "",
        tentang: rawContent?.tentang || "",
        wa: rawContent?.wa || "",
        aboutTitle: rawContent?.about_title || "",
        about: rawContent?.about || "",
        visi: rawContent?.visi || "",
        misi: rawContent?.misi || "",
        email: rawContent?.email || "",
        faq: typeof rawContent?.faq === "string" ? JSON.parse(rawContent.faq) : (rawContent?.faq || []),
      };

      const packageRows = await query<PackageRow[]>("SELECT * FROM packages WHERE aktif = TRUE", [], isDemo);
      const packages = packageRows.map((p) => ({
        id: p.id,
        nama: p.nama,
        harga: Number(p.harga),
        durasi: Number(p.durasi),
        satuan: p.satuan,
        batas: Number(p.batas),
        fitur: typeof p.fitur === "string" ? JSON.parse(p.fitur) : p.fitur,
        aktif: Boolean(p.aktif),
      }));

      if (!authUser) {
        return jsonResponse({ user: null, content, packages });
      }

      // Fetch user info
      const uRows = await query<UserRow[]>("SELECT * FROM users WHERE id = ?", [authUser.userId], isDemo);
      if (uRows.length === 0) {
        return jsonResponse({ user: null, content, packages });
      }

      const u = uRows[0]!;
      const user = {
        id: u.id,
        nama: u.nama,
        email: u.email,
        role: u.role,
        aktif: Boolean(u.aktif),
        namaUsaha: u.nama_usaha,
        jenisUsaha: u.jenis_usaha,
        plan: u.plan,
        trialStart: u.trial_start ? new Date(u.trial_start).toISOString() : null,
        trialEnd: u.trial_end ? new Date(u.trial_end).toISOString() : null,
        subStatusManual: u.sub_status_manual,
        subStart: u.sub_start ? new Date(u.sub_start).toISOString() : null,
        subEnd: u.sub_end ? new Date(u.sub_end).toISOString() : null,
      };

      // Profile
      const pRows = await query<BusinessProfileRow[]>("SELECT * FROM business_profiles WHERE user_id = ?", [u.id], isDemo);
      const prof = pRows[0];
      const businessProfile = {
        namaUsaha: prof?.nama_usaha || u.nama_usaha || "",
        jenisUsaha: prof?.jenis_usaha || u.jenis_usaha || "Dagang",
        pemilik: prof?.pemilik || u.nama || "",
        email: prof?.email || u.email || "",
        hp: prof?.hp || "",
        alamat: prof?.alamat || "",
        npwp: prof?.npwp || "",
      };

      // Settings
      const sRows = await query<SettingRow[]>("SELECT * FROM user_settings WHERE user_id = ?", [u.id], isDemo);
      const s = sRows[0];
      const settings = {
        reminderOn: s?.reminder_on !== undefined ? Boolean(s.reminder_on) : true,
        reminderTime: s?.reminder_time || "20:00",
        monthlyReportNotif: s?.monthly_report_notif !== undefined ? Boolean(s.monthly_report_notif) : true,
      };

      // Categories
      const catRows = await query<CategoryRow[]>("SELECT * FROM categories WHERE user_id = ?", [u.id], isDemo);
      const categories = catRows.map((c) => ({
        id: c.id,
        nama: c.nama,
        jenis: c.jenis,
      }));

      // Transactions
      const txRows = await query<TransactionRow[]>(
        "SELECT * FROM transactions WHERE user_id = ? ORDER BY tanggal DESC, created_at DESC",
        [u.id],
        isDemo
      );
      const transactions = txRows.map((t) => ({
        id: t.id,
        userId: t.user_id,
        tanggal: formatDateString(t.tanggal),
        jenis: t.jenis,
        kategori: t.kategori,
        nominal: Number(t.nominal),
        akunKeuangan: t.akun_keuangan,
        deskripsi: t.deskripsi || "",
        bukti: t.bukti || null,
        createdAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
      }));

      // Notifications
      const notifRows = await query<NotificationRow[]>(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
        [u.id],
        isDemo
      );
      const notifications = notifRows.map((n) => ({
        id: n.id,
        tag: n.tag,
        judul: n.judul,
        isi: n.isi,
        ts: n.created_at ? new Date(n.created_at).getTime() : Date.now(),
        read: Boolean(n.is_read),
      }));

      // Payment Requests
      const prRows = await query<PaymentRequestRow[]>(
        "SELECT * FROM payment_requests WHERE user_id = ? ORDER BY submitted_at DESC",
        [u.id],
        isDemo
      );
      const paymentRequests = prRows.map((p) => ({
        id: p.id,
        userId: p.user_id,
        packageId: p.package_id,
        amount: Number(p.amount),
        method: p.method,
        proof: p.proof,
        status: p.status,
        adminNote: p.admin_note,
        submittedAt: p.submitted_at ? new Date(p.submitted_at).toISOString() : new Date().toISOString(),
        verifiedAt: p.verified_at ? new Date(p.verified_at).toISOString() : null,
      }));

      // Reports
      const reportRows = await query<ReportRow[]>("SELECT * FROM reports WHERE user_id = ?", [u.id], isDemo);
      const reports = reportRows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        periode: r.periode,
        data: typeof r.data === "string" ? JSON.parse(r.data) : r.data,
      }));

      // If admin, include all users & all payment requests
      let adminUsers: any[] = [];
      let allPaymentRequests: any[] = [];
      if (u.role === "admin") {
        const allURows = await query<UserRow[]>(
          `SELECT u.*, COUNT(t.id) as txCount 
           FROM users u 
           LEFT JOIN transactions t ON u.id = t.user_id 
           GROUP BY u.id 
           ORDER BY u.created_at DESC`,
          [],
          isDemo
        );
        adminUsers = allURows.map((row) => ({
          id: row.id,
          nama: row.nama,
          email: row.email,
          role: row.role,
          aktif: Boolean(row.aktif),
          namaUsaha: row.nama_usaha,
          jenisUsaha: row.jenis_usaha,
          plan: row.plan,
          trialStart: row.trial_start ? new Date(row.trial_start).toISOString() : null,
          trialEnd: row.trial_end ? new Date(row.trial_end).toISOString() : null,
          subStatusManual: row.sub_status_manual,
          subEnd: row.sub_end ? new Date(row.sub_end).toISOString() : null,
          txCount: Number(row.txCount || 0),
        }));

        const allPRows = await query<PaymentRequestRow[]>(
          `SELECT pr.*, u.nama as userNama, u.email as userEmail, u.nama_usaha as userNamaUsaha 
           FROM payment_requests pr 
           JOIN users u ON pr.user_id = u.id 
           ORDER BY pr.submitted_at DESC`,
          [],
          isDemo
        );
        allPaymentRequests = allPRows.map((p) => ({
          id: p.id,
          userId: p.user_id,
          userName: p.userNama,
          userEmail: p.userEmail,
          userBusiness: p.userNamaUsaha,
          packageId: p.package_id,
          amount: Number(p.amount),
          method: p.method,
          proof: p.proof,
          status: p.status,
          adminNote: p.admin_note,
          submittedAt: p.submitted_at ? new Date(p.submitted_at).toISOString() : new Date().toISOString(),
          verifiedAt: p.verified_at ? new Date(p.verified_at).toISOString() : null,
        }));
      }

      return jsonResponse({
        user,
        businessProfile,
        settings,
        categories,
        transactions,
        notifications,
        paymentRequests,
        reports,
        packages,
        content,
        adminUsers,
        allPaymentRequests,
      });
    }

    /* ----------------------------------------------------
       TRANSACTIONS ENDPOINTS
       ---------------------------------------------------- */
    if (pathname === "/api/transactions" && method === "GET") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const rows = await query<TransactionRow[]>(
        "SELECT * FROM transactions WHERE user_id = ? ORDER BY tanggal DESC, created_at DESC",
        [authUser.userId],
        isDemo
      );
      return jsonResponse(
        rows.map((t) => ({
          id: t.id,
          userId: t.user_id,
          tanggal: formatDateString(t.tanggal),
          jenis: t.jenis,
          kategori: t.kategori,
          nominal: Number(t.nominal),
          akunKeuangan: t.akun_keuangan,
          deskripsi: t.deskripsi || "",
          bukti: t.bukti || null,
          createdAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
        }))
      );
    }

    if (pathname === "/api/transactions" && method === "POST") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const { tanggal, jenis, kategori, nominal, akunKeuangan, deskripsi, bukti } = body;

      if (!tanggal || !jenis || !kategori || !nominal) {
        return jsonResponse({ error: "Data transaksi tidak lengkap." }, 400);
      }

      const txId = uid("trx");
      await query(
        `INSERT INTO transactions (id, user_id, tanggal, jenis, kategori, nominal, akun_keuangan, deskripsi, bukti)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txId,
          authUser.userId,
          tanggal,
          jenis,
          kategori,
          Number(nominal),
          akunKeuangan || "usaha",
          deskripsi || "",
          bukti || null,
        ],
        isDemo
      );

      return jsonResponse({
        success: true,
        transaction: {
          id: txId,
          userId: authUser.userId,
          tanggal,
          jenis,
          kategori,
          nominal: Number(nominal),
          akunKeuangan: akunKeuangan || "usaha",
          deskripsi: deskripsi || "",
          bukti: bukti || null,
          createdAt: new Date().toISOString(),
        },
      });
    }

    if (pathname.startsWith("/api/transactions/") && method === "PUT") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const txId = pathname.replace("/api/transactions/", "");
      const body = await request.json();
      const { tanggal, jenis, kategori, nominal, akunKeuangan, deskripsi, bukti } = body;

      await query(
        `UPDATE transactions SET 
           tanggal = COALESCE(?, tanggal),
           jenis = COALESCE(?, jenis),
           kategori = COALESCE(?, kategori),
           nominal = COALESCE(?, nominal),
           akun_keuangan = COALESCE(?, akun_keuangan),
           deskripsi = COALESCE(?, deskripsi),
           bukti = COALESCE(?, bukti)
         WHERE id = ? AND user_id = ?`,
        [tanggal, jenis, kategori, nominal !== undefined ? Number(nominal) : null, akunKeuangan, deskripsi, bukti, txId, authUser.userId],
        isDemo
      );

      return jsonResponse({ success: true, id: txId });
    }

    if (pathname.startsWith("/api/transactions/") && method === "DELETE") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const txId = pathname.replace("/api/transactions/", "");
      await query("DELETE FROM transactions WHERE id = ? AND user_id = ?", [txId, authUser.userId], isDemo);
      return jsonResponse({ success: true });
    }

    /* ----------------------------------------------------
       CATEGORIES ENDPOINTS
       ---------------------------------------------------- */
    if (pathname === "/api/categories" && method === "GET") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const rows = await query<CategoryRow[]>("SELECT * FROM categories WHERE user_id = ?", [authUser.userId], isDemo);
      return jsonResponse(rows.map((r) => ({ id: r.id, nama: r.nama, jenis: r.jenis })));
    }

    if (pathname === "/api/categories" && method === "POST") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const { nama, jenis } = body;

      if (!nama || !jenis) return jsonResponse({ error: "Nama dan jenis kategori wajib diisi." }, 400);

      const catId = uid("cat");
      await query("INSERT INTO categories (id, user_id, nama, jenis) VALUES (?, ?, ?, ?)", [
        catId,
        authUser.userId,
        nama,
        jenis,
      ], isDemo);

      return jsonResponse({ success: true, category: { id: catId, nama, jenis } });
    }

    if (pathname.startsWith("/api/categories/") && method === "DELETE") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const catId = pathname.replace("/api/categories/", "");
      await query("DELETE FROM categories WHERE id = ? AND user_id = ?", [catId, authUser.userId], isDemo);
      return jsonResponse({ success: true });
    }

    /* ----------------------------------------------------
       PROFILE & SETTINGS ENDPOINTS
       ---------------------------------------------------- */
    if (pathname === "/api/profile" && method === "PUT") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const { namaUsaha, jenisUsaha, pemilik, email, hp, alamat, npwp } = body;

      await query(
        `INSERT INTO business_profiles (id, user_id, nama_usaha, jenis_usaha, pemilik, email, hp, alamat, npwp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           nama_usaha = VALUES(nama_usaha),
           jenis_usaha = VALUES(jenis_usaha),
           pemilik = VALUES(pemilik),
           email = VALUES(email),
           hp = VALUES(hp),
           alamat = VALUES(alamat),
           npwp = VALUES(npwp)`,
        ["bp_" + authUser.userId, authUser.userId, namaUsaha, jenisUsaha, pemilik, email, hp, alamat, npwp],
        isDemo
      );

      if (namaUsaha || jenisUsaha) {
        await query("UPDATE users SET nama_usaha = COALESCE(?, nama_usaha), jenis_usaha = COALESCE(?, jenis_usaha) WHERE id = ?", [
          namaUsaha,
          jenisUsaha,
          authUser.userId,
        ], isDemo);
      }

      return jsonResponse({ success: true });
    }

    if (pathname === "/api/settings" && method === "PUT") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const { reminderOn, reminderTime, monthlyReportNotif } = body;

      await query(
        `INSERT INTO user_settings (user_id, reminder_on, reminder_time, monthly_report_notif)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           reminder_on = VALUES(reminder_on),
           reminder_time = VALUES(reminder_time),
           monthly_report_notif = VALUES(monthly_report_notif)`,
        [authUser.userId, reminderOn, reminderTime, monthlyReportNotif],
        isDemo
      );

      return jsonResponse({ success: true });
    }

    /* ----------------------------------------------------
       NOTIFICATIONS ENDPOINTS
       ---------------------------------------------------- */
    if (pathname === "/api/notifications/read-all" && method === "POST") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      await query("UPDATE notifications SET is_read = TRUE WHERE user_id = ?", [authUser.userId], isDemo);
      return jsonResponse({ success: true });
    }

    if (pathname === "/api/notifications" && method === "DELETE") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      await query("DELETE FROM notifications WHERE user_id = ?", [authUser.userId], isDemo);
      return jsonResponse({ success: true });
    }

    /* ----------------------------------------------------
       FILE UPLOAD (LOCAL FILE STORAGE - SEPARATE DEMO/PROD)
       ---------------------------------------------------- */
    if (pathname === "/api/upload" && method === "POST") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);

      const isDemoUpload = Boolean(authUser?.isDemo);
      const targetDir = getTargetUploadDir(isDemoUpload);
      const publicUrlPrefix = isDemoUpload ? "/uploads/demo/" : "/uploads/";

      await fs.mkdir(targetDir, { recursive: true });

      const contentType = request.headers.get("content-type") || "";

      // Support base64 JSON payload (convenient from camera / FileReader)
      if (contentType.includes("application/json")) {
        const body = await request.json();
        const { dataUrl, fileName } = body;

        if (!dataUrl) return jsonResponse({ error: "dataUrl tidak valid." }, 400);

        const match = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!match) return jsonResponse({ error: "Format base64 tidak valid." }, 400);

        const mime = match[1] || "image/jpeg";
        const base64Data = match[2]!;
        const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        const cleanName = (fileName || "upload").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
        const finalFileName = `${Date.now()}_${cleanName}.${ext}`;
        const filePath = path.join(targetDir, finalFileName);

        const buffer = Buffer.from(base64Data, "base64");
        await fs.writeFile(filePath, buffer);

        const publicUrl = `${publicUrlPrefix}${finalFileName}`;
        return jsonResponse({ success: true, url: publicUrl, fileName: finalFileName });
      }

      // Support multipart form data
      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || typeof file === "string") {
          return jsonResponse({ error: "File tidak ditemukan dalam upload." }, 400);
        }

        const buffer = Buffer.from(await (file as Blob).arrayBuffer());
        const originalName = (file as File).name || "upload.jpg";
        const ext = path.extname(originalName) || ".jpg";
        const finalFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
        const filePath = path.join(targetDir, finalFileName);

        await fs.writeFile(filePath, buffer);

        const publicUrl = `${publicUrlPrefix}${finalFileName}`;
        return jsonResponse({ success: true, url: publicUrl, fileName: finalFileName });
      }

      return jsonResponse({ error: "Unsupported Content-Type." }, 400);
    }

    /* ----------------------------------------------------
       PAYMENTS & SUBSCRIPTION ENDPOINTS
       ---------------------------------------------------- */
    if (pathname === "/api/payments" && method === "POST") {
      if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const { packageId, amount, proof, method: payMethod } = body;

      const prId = uid("pr");
      await query(
        `INSERT INTO payment_requests (id, user_id, package_id, amount, method, proof, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [prId, authUser.userId, packageId, Number(amount || 0), payMethod || "transfer_manual", proof || null],
        isDemo
      );

      return jsonResponse({
        success: true,
        paymentRequest: {
          id: prId,
          userId: authUser.userId,
          packageId,
          amount: Number(amount || 0),
          method: payMethod || "transfer_manual",
          proof: proof || null,
          status: "pending",
          submittedAt: new Date().toISOString(),
        },
      });
    }

    /* ----------------------------------------------------
       ADMIN ENDPOINTS
       ---------------------------------------------------- */
    if (pathname.startsWith("/api/admin")) {
      if (!authUser || authUser.role !== "admin") {
        return jsonResponse({ error: "Akses ditolak: Hanya untuk administrator." }, 403);
      }

      // PUT /api/admin/users/:id/status
      if (pathname.startsWith("/api/admin/users/") && pathname.endsWith("/status") && method === "PUT") {
        const userId = pathname.replace("/api/admin/users/", "").replace("/status", "");
        const body = await request.json();
        const { aktif } = body;

        await query("UPDATE users SET aktif = ? WHERE id = ?", [Boolean(aktif), userId], isDemo);
        return jsonResponse({ success: true });
      }

      // PUT /api/admin/payments/:id/verify
      if (pathname.startsWith("/api/admin/payments/") && pathname.endsWith("/verify") && method === "PUT") {
        const prId = pathname.replace("/api/admin/payments/", "").replace("/verify", "");
        const body = await request.json();
        const { status, adminNote } = body;

        if (!["approved", "rejected"].includes(status)) {
          return jsonResponse({ error: "Status verifikasi tidak valid." }, 400);
        }

        const prRows = await query<PaymentRequestRow[]>("SELECT * FROM payment_requests WHERE id = ?", [prId], isDemo);
        if (prRows.length === 0) return jsonResponse({ error: "Data pembayaran tidak ditemukan." }, 404);

        const pr = prRows[0]!;
        const now = new Date();

        await query(
          "UPDATE payment_requests SET status = ?, admin_note = ?, verified_at = ? WHERE id = ?",
          [status, adminNote || "", now, prId],
          isDemo
        );

        // If approved, activate user subscription
        if (status === "approved") {
          const subStart = now;
          const subEnd = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 6 months
          await query(
            "UPDATE users SET sub_status_manual = 'active', sub_start = ?, sub_end = ? WHERE id = ?",
            [subStart, subEnd, pr.user_id],
            isDemo
          );

          await query(
            "INSERT INTO notifications (id, user_id, tag, judul, isi) VALUES (?, ?, 'sub_active', 'Langganan Aktif!', ?)",
            [uid("ntf"), pr.user_id, `Langganan paket berhasil diverifikasi. Aktif hingga ${subEnd.toISOString().slice(0, 10)}.`],
            isDemo
          );
        } else if (status === "rejected") {
          await query(
            "INSERT INTO notifications (id, user_id, tag, judul, isi) VALUES (?, ?, 'sub_rejected', 'Pembayaran Ditolak', ?)",
            [uid("ntf"), pr.user_id, adminNote ? `Alasan: ${adminNote}` : "Bukti transfer tidak sesuai."],
            isDemo
          );
        }

        return jsonResponse({ success: true, status });
      }

      // PUT /api/admin/content
      if (pathname === "/api/admin/content" && method === "PUT") {
        const body = await request.json();
        const { tagline, sub, tentang, wa, aboutTitle, about, visi, misi, email, faq } = body;

        await query(
          `UPDATE site_content SET 
             tagline = COALESCE(?, tagline),
             sub = COALESCE(?, sub),
             tentang = COALESCE(?, tentang),
             wa = COALESCE(?, wa),
             about_title = COALESCE(?, about_title),
             about = COALESCE(?, about),
             visi = COALESCE(?, visi),
             misi = COALESCE(?, misi),
             email = COALESCE(?, email),
             faq = COALESCE(?, faq)
           WHERE id = 'default'`,
          [tagline, sub, tentang, wa, aboutTitle, about, visi, misi, email, faq ? JSON.stringify(faq) : null],
          isDemo
        );

        return jsonResponse({ success: true });
      }

      // POST /api/admin/packages & PUT /api/admin/packages/:id
      if (pathname === "/api/admin/packages" && method === "POST") {
        const body = await request.json();
        const { id, nama, harga, durasi, satuan, batas, fitur, aktif } = body;
        const pkgId = id || uid("pkg");

        await query(
          `INSERT INTO packages (id, nama, harga, durasi, satuan, batas, fitur, aktif)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [pkgId, nama, Number(harga), Number(durasi), satuan || "bulan", Number(batas || 0), JSON.stringify(fitur || []), aktif !== false],
          isDemo
        );

        return jsonResponse({ success: true, id: pkgId });
      }

      if (pathname.startsWith("/api/admin/packages/") && method === "PUT") {
        const pkgId = pathname.replace("/api/admin/packages/", "");
        const body = await request.json();
        const { nama, harga, durasi, satuan, batas, fitur, aktif } = body;

        await query(
          `UPDATE packages SET 
             nama = COALESCE(?, nama),
             harga = COALESCE(?, harga),
             durasi = COALESCE(?, durasi),
             satuan = COALESCE(?, satuan),
             batas = COALESCE(?, batas),
             fitur = COALESCE(?, fitur),
             aktif = COALESCE(?, aktif)
           WHERE id = ?`,
          [nama, harga !== undefined ? Number(harga) : null, durasi !== undefined ? Number(durasi) : null, satuan, batas !== undefined ? Number(batas) : null, fitur ? JSON.stringify(fitur) : null, aktif !== undefined ? Boolean(aktif) : null, pkgId],
          isDemo
        );

        return jsonResponse({ success: true });
      }
    }

    return jsonResponse({ error: "Endpoint not found" }, 404);
  } catch (err: any) {
    console.error(`API Error on [${method}] ${pathname}:`, err);
    const errMsg = err?.message || String(err);
    const isConfigOrDbError =
      errMsg.includes("Missing required") ||
      errMsg.includes("ECONNREFUSED") ||
      errMsg.includes("ER_ACCESS_DENIED_ERROR") ||
      errMsg.includes("ENOTFOUND");

    const status = isConfigOrDbError ? 503 : 500;
    const userMessage = isConfigOrDbError
      ? `Konfigurasi database/server bermasalah: ${errMsg}`
      : "Terjadi kesalahan server internal.";

    return jsonResponse({ error: userMessage, message: errMsg }, status);
  }
}
