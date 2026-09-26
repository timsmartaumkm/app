> **Admin implementation update (2026-09-26)**
> The current frontend is `public/smarta.html`, with APIs in `lib/api-handler.ts`. The original standalone documentation below is historical.
>
> Admin user subscription changes, account activation/deactivation, user deletion, package creation/editing/toggling, and content/FAQ changes now persist through authenticated APIs. User deletion cascades to related database records; uploaded files are not removed by this action. Disabled packages remain visible to admins. Failed saves show errors instead of reporting success.
>
> Payment verification uses a database transaction, accepts only pending requests, and activates the selected package for its configured duration (months are 30 days). Rejections require a reason. Dashboard user transaction totals use backend aggregates.
> User subscription cancellation now calls `DELETE /api/subscription`, immediately ends the active paid period, restores the trial package/status calculation, records an in-app notification, and preserves the approved payment as financial history.
>
> Validation: `node scripts/test-admin.mjs` runs mocked API regression checks and frontend failure checks without connecting to a database. Live database/browser acceptance testing is still required.

> **Browser/OS notifications:** Web Push is implemented with VAPID, per-device subscriptions, a service worker, and a cron-protected reminder endpoint. The existing page timer remains as a fallback on devices that have not subscribed. HTTPS (or localhost) and browser permission are required.

## Web Push deployment

1. Run `npm run push:keys` once. Add the resulting `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` to the Hostinger application environment. Keep this key pair stable; replacing it requires every device to subscribe again.
2. Generate a long random `CRON_SECRET` and add it to the Hostinger environment. Do not put it in source control or a URL query string.
3. Deploy and restart the application. `initDatabase()` automatically creates `push_subscriptions` and `push_deliveries`.
4. In hPanel, create a Custom cron job every five minutes. Replace the domain and secret below with the production values:

```sh
curl --fail --silent --show-error --request POST --header "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR_DOMAIN/api/internal/push-reminders
```

The endpoint evaluates reminder times in `Asia/Jakarta`, ignores users who already recorded a transaction that day, removes expired browser subscriptions, and deduplicates each user's daily reminder. It returns counters for checked users, successful sends, failures, and expired subscriptions. Concurrent cron calls are serialized with a MySQL advisory lock.

Users subscribe or unsubscribe the current device from **Setelan > Notifikasi Pengingat > Notifikasi OS**. iPhone and iPad users must first install the site with **Add to Home Screen**; `public/manifest.webmanifest` provides the required standalone web-app metadata.

Validation: `npm run test:push`, `node scripts/test-admin.mjs`, `tsc --noEmit`, and `npm run build`. The mocked push test does not contact a real browser push service, so a production-device acceptance test is still required after the environment variables are configured.

# SMARTA UMKM — MVP HANDOFF DOCUMENTATION

> **Production handoff note**
> SMARTA UMKM saat ini merupakan MVP/frontend product yang dapat digunakan untuk demonstrasi dan pengujian alur aplikasi. Beberapa komponen masih menggunakan localStorage dan payment simulation. Sebelum digunakan sebagai produk production, aplikasi perlu diintegrasikan dengan backend, database, production authentication, secure file storage, payment gateway, hosting, custom domain, HTTPS, dan security layer.

Lokasi kode aplikasi: **`public/app/smarta-umkm.html`** (standalone: HTML + CSS + JavaScript, tanpa dependency, tanpa API key).
Route `/` (`src/routes/index.tsx`) hanya menyajikan file tersebut.

Akun demo (dibuat otomatis saat pertama kali dibuka):

| Peran | Email | Password |
| --- | --- | --- |
| User | demo@smartaumkm.id | demo123 |
| Admin | admin@smartaumkm.id | admin123 |

---

## 1. Deskripsi produk

Aplikasi pencatatan keuangan sederhana untuk UMKM dagang & jasa: mencatat transaksi harian, memisahkan keuangan usaha dan pribadi, serta menampilkan laporan laba rugi otomatis beserta interpretasinya dalam bahasa yang mudah dipahami.

## 2. Fitur utama

- Landing page (fitur, harga, cara pakai, FAQ, tentang kami) + chat bot 24 jam (satu widget saja).
- Auth: register, login, logout, session, role user/admin.
- Transaksi: tambah, edit, hapus, detail, cari, filter, kategori, upload/kamera bukti.
- Keuangan usaha vs pribadi (saldo terpisah).
- Laporan: laba rugi, bulanan, tahunan, arsip laporan, grafik, download PDF/print.
- Langganan: trial 15 hari, paket Rp 51.000 / 6 bulan, simulasi pembayaran + upload bukti.
- Admin: dashboard, manajemen user (aktif/nonaktif), CRUD paket, manajemen konten & FAQ, verifikasi permintaan pembayaran (approve/reject).
- Notifikasi, reminder harian, setelan profil usaha & password.

## 3. Authentication

Standalone: kredensial dicek di browser, sesi disimpan pada `DB.session` (localStorage). **Bukan authentication production.** Titik ganti: `doLogin()`, `doRegister()`, `confirmLogout()`, `currentUser()` — ditandai `// TODO: REPLACE WITH PRODUCTION AUTH`.

## 4. Data model

Namespace localStorage: `smarta_v1`. Struktur `DB`:

```
User             { id, nama, email, password, role, aktif, createdAt,
                   trialStart, trialEnd, plan, subStatusManual, subStart, subEnd }
BusinessProfile  { namaUsaha, jenisUsaha, pemilik, email, hp, alamat }   // per userId
Transaction      { id, userId, tanggal, jenis, kategori, nominal,
                   akunKeuangan, deskripsi, bukti, createdAt }
Category         { id, nama, jenis }                                     // per userId
Report           { id, userId, periode, ... }                            // arsip laporan
Subscription     // pada User: plan + subStatusManual + subStart/subEnd
PaymentRequest   { id, userId, packageId, amount, method, proof,
                   submittedAt, status, adminNote, verifiedAt }
Notification     { id, judul, isi, ts, read }                            // per userId
FAQ              { q, a }                                                // DB.content.faq
Content          { tagline, sub, tentang, about, visi, misi, email, wa, faq }
```

Skema kanonik untuk backend (adapter sudah tersedia: `toTransactionDTO()` / `fromTransactionDTO()`):

```
Transaction DTO { id, userId, date, type (income|expense), category, amount,
                  financialType (business|personal), description, proof, createdAt }
```

Semua akses data melewati `save()` / `load()` dan `DataStore` — cukup ganti tiga hal itu untuk pindah ke API.

## 5. Transaction logic

`jenis` = `pemasukan` | `pengeluaran`. Validasi: tanggal (tidak boleh masa depan), nominal > 0, kategori wajib, deskripsi, file gambar maks. 2 MB.

## 6. Financial separation

`akunKeuangan` = `usaha` (business) | `pribadi` (personal). `profitLoss()` **hanya** membaca transaksi `usaha`, sehingga transaksi pribadi tidak pernah masuk laporan laba rugi usaha. Saldo pribadi ditampilkan terpisah pada halaman Keuangan Pribadi.

## 7. Report logic

Semua angka dihitung dari transaksi aktual (tidak ada angka hard-coded):
`Total Pemasukan = Σ pemasukan usaha`, `Total Pengeluaran = Σ pengeluaran usaha`, `Laba Bersih = Pemasukan − Pengeluaran`, `Margin = Laba / Pendapatan × 100`.
Grafik (`monthlySeries()` + `barChart()`) dan interpretasi (`interpret()`) memakai data yang sama. Cetak/PDF memuat: SMARTA UMKM, nama usaha, periode, pendapatan, beban, laba/rugi, interpretasi.

## 8. Trial logic

`TRIAL_DAYS = 15`. `trialEnd = trialStart + 15 hari`; `trialLeft()` menghitung sisa hari; trial berakhir → status `expired` (form tambah transaksi dinonaktifkan).

## 9. Subscription logic

Status: `trial` | `active` | `expired` | `pending` | `rejected` (lihat `subscriptionState()`).
Paket: Uji Coba Gratis (15 hari) dan Langganan 6 Bulan Rp 51.000. Approve admin → `activatePaidSub()` menetapkan `subStart`/`subEnd` (6 × 30 hari) dan status `active`. Setelah `subEnd` terlewati → `expired`.

## 10. Payment simulation

User memilih paket → mengunggah bukti transfer → `PaymentRequest.status = pending` → admin approve/reject (reject wajib mengisi alasan, user mendapat notifikasi). Tidak ada payment gateway nyata dan tidak ada API key. Titik ganti: `submitPayment()` — `// TODO: REPLACE PAYMENT SIMULATION WITH PAYMENT GATEWAY`; webhook gateway cukup memanggil `activatePaidSub()`, UI langganan tidak berubah.

## 11. Bagian yang masih menggunakan localStorage

Seluruh data: users, session, profil usaha, transaksi, kategori, laporan/arsip, notifikasi, setelan, paket, konten & FAQ, payment request, dan foto bukti (base64).

## 12. Bagian yang perlu backend/database

`save()`, `load()`, `DataStore`, autentikasi, perhitungan agregat multi-user, manajemen user/paket/konten oleh admin, dan riwayat audit approve/reject pembayaran.

## 13. Bagian yang perlu payment gateway

Pembuatan invoice/transaksi pembayaran, halaman/redirect pembayaran, verifikasi otomatis via webhook, serta pembaruan status langganan (menggantikan approve manual admin).

## 14. File upload/storage

Bukti transaksi dan bukti pembayaran masih base64 di localStorage (maks. 2 MB, validasi tipe & ukuran sudah ada). Untuk produksi: unggah ke object storage (mis. S3/Supabase Storage) dan simpan URL pada field `bukti`/`proof` (`// TODO: CONNECT FILE STORAGE`).

## 15. Hosting

Versi standalone dapat dijalankan sebagai static hosting (file `public/app/smarta-umkm.html`). Untuk produksi diperlukan hosting dengan HTTPS beserta backend API-nya (`// TODO: DEPLOY TO PRODUCTION HOSTING`).

## 16. Domain

Belum menggunakan custom domain. Setelah production siap: pasang custom domain + sertifikat HTTPS dan perbarui URL pada konten/email.

## 17. Security yang perlu ditambahkan sebelum production

- Hashing password (bcrypt/argon2) dan authentication server-side (session/JWT).
- Otorisasi role di server (user tidak boleh mengakses endpoint admin).
- Validasi ulang seluruh input di server + rate limiting pada login/register.
- Row-level security agar setiap user hanya mengakses datanya sendiri.
- Secure file storage (signed URL, pemeriksaan tipe/ukuran di server, anti-malware).
- HTTPS wajib, security headers/CSP, proteksi CSRF & XSS.
- Verifikasi webhook payment gateway (signature) dan audit log transaksi keuangan.
- Backup berkala serta kebijakan privasi & retensi data.
