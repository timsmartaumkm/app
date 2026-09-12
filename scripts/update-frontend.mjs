import fs from "fs";
import path from "path";

const htmlPath = path.resolve("./public/smarta.html");
let html = fs.readFileSync(htmlPath, "utf-8");

// 1. Add API client and updated load/bootstrap functions
const apiCode = `
/* ==========================================================================
   API CLIENT & BACKEND INTEGRATION
   ========================================================================== */
const API = {
  getToken(){ return localStorage.getItem("smarta_token") || sessionStorage.getItem("smarta_token"); },
  setToken(t){
    if(t){ localStorage.setItem("smarta_token", t); sessionStorage.setItem("smarta_token", t); }
    else { localStorage.removeItem("smarta_token"); sessionStorage.removeItem("smarta_token"); }
  },
  async request(path, opts = {}){
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const token = this.getToken();
    if(token) headers["Authorization"] = "Bearer " + token;
    try {
      const res = await fetch(path, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || ("Request failed with status " + res.status));
      return data;
    } catch(err) {
      console.warn("API request error on " + path + ":", err);
      throw err;
    }
  },
  get(p){ return this.request(p, { method: "GET" }); },
  post(p, b){ return this.request(p, { method: "POST", body: JSON.stringify(b) }); },
  put(p, b){ return this.request(p, { method: "PUT", body: JSON.stringify(b) }); },
  del(p){ return this.request(p, { method: "DELETE" }); },
  async uploadFile(dataUrl, fileName){
    return this.post("/api/upload", { dataUrl, fileName });
  }
};

async function bootstrapApp(){
  try {
    const data = await API.get("/api/bootstrap");
    if(data){
      if(data.content) DB.content = Object.assign({}, DEFAULT_CONTENT, data.content);
      if(Array.isArray(data.packages) && data.packages.length > 0) DB.packages = data.packages;
      if(data.user){
        DB.session = { userId: data.user.id, at: Date.now() };
        DB.users = [data.user];
        if(Array.isArray(data.adminUsers) && data.adminUsers.length > 0) DB.users = data.adminUsers;
        if(data.businessProfile) DB.businessProfiles[data.user.id] = data.businessProfile;
        if(data.settings) DB.settings[data.user.id] = data.settings;
        if(Array.isArray(data.categories)) DB.categories[data.user.id] = data.categories;
        if(Array.isArray(data.transactions)) DB.transactions = data.transactions;
        if(Array.isArray(data.notifications)) DB.notifications[data.user.id] = data.notifications;
        if(Array.isArray(data.paymentRequests)) DB.paymentRequests = data.paymentRequests;
        if(Array.isArray(data.allPaymentRequests)) DB.paymentRequests = data.allPaymentRequests;
        if(Array.isArray(data.reports)) DB.reports = data.reports;
      } else {
        DB.session = null;
      }
    }
  } catch(e) {
    console.warn("Bootstrap fallback to local cache:", e);
  }
  migrateDB();
  migrateBarang();
  save();
}
`;

// Insert API client before DataStore
html = html.replace('const DataStore = {', apiCode + '\nconst DataStore = {');

// Update DataStore implementation
const newDataStore = `const DataStore = {
  listTransactions(userId){ return DB.transactions.filter(t=>t.userId===userId); },
  async createTransaction(tx){
    try {
      const res = await API.post("/api/transactions", tx);
      if(res && res.transaction){
        const idx = DB.transactions.findIndex(t => t.id === tx.id);
        if(idx !== -1) DB.transactions.splice(idx, 1);
        DB.transactions.unshift(res.transaction);
        save();
        return res.transaction;
      }
    } catch(e){
      console.warn("API createTransaction fallback to local:", e);
    }
    DB.transactions.unshift(tx); save(); return tx;
  },
  async updateTransaction(id, patch){
    try {
      await API.put("/api/transactions/" + id, patch);
    } catch(e){
      console.warn("API updateTransaction fallback to local:", e);
    }
    const t = DB.transactions.find(x=>x.id===id); if(t) Object.assign(t,patch); save(); return t;
  },
  async deleteTransaction(id){
    try {
      await API.del("/api/transactions/" + id);
    } catch(e){
      console.warn("API deleteTransaction fallback to local:", e);
    }
    DB.transactions = DB.transactions.filter(t=>t.id!==id); save();
  },
  exportTransactions(userId){ return this.listTransactions(userId).map(toTransactionDTO); }
};`;

html = html.replace(/const DataStore = \{[\s\S]*?exportTransactions\(userId\)\{ return this\.listTransactions\(userId\)\.map\(toTransactionDTO\); \}\n\};/, newDataStore);

// Replace doLogin, loginDemo, doRegister, confirmLogout
const authBlockRegex = /function doLogin\(e\)[\s\S]*?function confirmLogout\(\)\{[\s\S]*?\}[\s\S]*?function enterApp/;

const newAuthBlock = `async function doLogin(e){
  if(e) e.preventDefault();
  const email = val("li_email"), pass = val("li_pass");
  let ok = setErr("li_email", !email?"Email wajib diisi.":(!isEmail(email)?"Format email tidak valid.":""));
  ok = setErr("li_pass", !pass?"Password wajib diisi.":"") && ok;
  if(!ok) return false;

  try {
    const res = await API.post("/api/auth/login", { email, password: pass });
    if(res.token){
      API.setToken(res.token);
      await bootstrapApp();
      enterApp();
      toast("Selamat datang kembali, " + (res.user ? res.user.nama : "Pengguna") + "!");
      return true;
    }
  } catch(err){
    setErr("li_pass", err.message || "Email atau password salah.");
    toast(err.message || "Email atau password salah.", "error");
    return false;
  }
}
async function loginDemo(){
  try {
    const res = await API.post("/api/auth/login", { email: "demo@smartaumkm.id", password: "demo123" });
    if(res.token){
      API.setToken(res.token);
      await bootstrapApp();
      enterApp();
      toast("Masuk sebagai akun demo.", "info");
    }
  } catch(err){
    toast("Gagal masuk demo: " + err.message, "error");
  }
}
async function doRegister(e){
  if(e) e.preventDefault();
  const nama=val("rg_nama"), email=val("rg_email"), p1=val("rg_pass"), p2=val("rg_pass2"), usaha=val("rg_usaha"), jenis=val("rg_jenis");
  let ok = setErr("rg_nama", !nama?"Nama wajib diisi.":(nama.length<3?"Nama minimal 3 karakter.":""));
  ok = setErr("rg_email", !email?"Email wajib diisi.":(!isEmail(email)?"Format email tidak valid.":"")) && ok;
  ok = setErr("rg_pass", !p1?"Password wajib diisi.":(p1.length<6?"Password minimal 6 karakter.":"")) && ok;
  ok = setErr("rg_pass2", !p2?"Konfirmasi password wajib diisi.":(p1!==p2?"Konfirmasi password tidak sama.":"")) && ok;
  ok = setErr("rg_usaha", !usaha?"Nama usaha wajib diisi.":"") && ok;
  ok = setErr("rg_jenis", !jenis?"Pilih jenis usaha.":"") && ok;
  if(!ok) return false;

  try {
    const res = await API.post("/api/auth/register", {
      nama,
      email,
      password: p1,
      namaUsaha: usaha,
      jenisUsaha: normJenis(jenis)
    });
    if(res.token){
      API.setToken(res.token);
      await bootstrapApp();
      ["rg_nama","rg_email","rg_pass","rg_pass2","rg_usaha","rg_jenis"].forEach(i=>{const el=document.getElementById(i); if(el) el.value="";});
      enterApp();
      toast("Pendaftaran berhasil. Uji Coba Gratis 30 Hari Anda dimulai hari ini.");
      return true;
    }
  } catch(err){
    setErr("rg_email", err.message);
    toast(err.message, "error");
    return false;
  }
}
function confirmLogout(){
  confirmDialog("Keluar dari akun?","Anda akan kembali ke halaman beranda.",()=>{
    API.setToken(null);
    DB.session=null;
    save();
    showLanding();
    toast("Anda telah keluar.","info");
  },"Ya, Keluar");
}
function enterApp`;

html = html.replace(authBlockRegex, newAuthBlock);

// Replace saveTx and txDelete
const saveTxRegex = /function saveTx\(e\)\{[\s\S]*?go\("beranda"\); return true;\s*\}/;
const newSaveTx = `async function saveTx(e){
  if(e) e.preventDefault();
  const u = currentUser();
  const jenis=val("tx_jenis"), tanggal=val("tx_tanggal"), nominal=val("tx_nominal"),
        kategori=val("tx_kategori"), akun=val("tx_akun"), desk=val("tx_deskripsi");
  let ok = setErr("tx_tanggal", !tanggal?"Tanggal wajib diisi.":(tanggal>todayISO()?"Tanggal tidak boleh di masa depan.":""));
  const num = Number(nominal);
  ok = setErr("tx_nominal", !nominal?"Nominal wajib diisi.":(!isFinite(num)||num<=0?"Nominal harus lebih dari 0.":(num>1e12?"Nominal terlalu besar.":""))) && ok;
  ok = setErr("tx_kategori", !kategori?"Kategori wajib dipilih.":"") && ok;
  ok = setErr("tx_akun", !akun?"Akun keuangan wajib dipilih.":"") && ok;
  ok = setErr("tx_deskripsi", desk.length>140?"Deskripsi maksimal 140 karakter.":"") && ok;
  if(!ok){ toast("Periksa kembali data yang belum sesuai.","error"); return false; }

  let proofUrl = uiState.buktiData;
  if(proofUrl && proofUrl.startsWith("data:image/")){
    try {
      const up = await API.uploadFile(proofUrl, "tx_" + Date.now());
      if(up && up.url) proofUrl = up.url;
    } catch(err){
      console.warn("Upload bukti gagal, menyimpan data:", err);
    }
  }

  if(uiState.editingTx){
    const patch = {jenis,tanggal,nominal:num,kategori,akunKeuangan:akun,deskripsi:desk||kategori,bukti:proofUrl||null};
    await DataStore.updateTransaction(uiState.editingTx, patch);
    uiState.editingTx=null; uiState.buktiData=null;
    toast("Transaksi berhasil diperbarui."); go("riwayat"); return true;
  }
  if(subStatus(u)==="expired"){ toast("Masa uji coba telah berakhir. Berlangganan untuk mencatat transaksi baru.","error"); return false; }
  if(subStatus(u)==="trial" && myTx().length>=100){ toast("Batas 100 transaksi masa uji coba tercapai.","error"); return false; }
  
  const newTx = {
    id: uid("trx"),
    userId: u.id,
    tanggal,
    jenis,
    kategori,
    nominal: num,
    akunKeuangan: akun,
    deskripsi: desk||kategori,
    bukti: proofUrl||null,
    createdAt: new Date().toISOString()
  };
  await DataStore.createTransaction(newTx);
  uiState.buktiData=null;
  toast("Transaksi berhasil disimpan.");
  uiState.period = ym(tanggal);
  go("beranda"); return true;
}`;

html = html.replace(saveTxRegex, newSaveTx);

// Replace txDelete
const txDelRegex = /function txDelete\(id\)\{[\s\S]*?\},"Ya, Hapus"\);\s*\}/;
const newTxDel = `function txDelete(id){
  const t = myTx().find(x=>x.id===id); if(!t) return;
  confirmDialog("Hapus transaksi?", \`"\${t.deskripsi||t.kategori}" sebesar \${rp(t.nominal)} akan dihapus permanen.\`, async ()=>{
    await DataStore.deleteTransaction(id);
    toast("Transaksi berhasil dihapus."); go(route);
  },"Ya, Hapus");
}`;

html = html.replace(txDelRegex, newTxDel);

// Replace catSave and catDelete
const catSaveRegex = /function catSave\(jenis,id\)\{[\s\S]*?go\("kategori"\); return true;\s*\}/;
const newCatSave = `async function catSave(jenis,id){
  const nama = val("cat_nama");
  if(!setErr("cat_nama", !nama?"Nama kategori wajib diisi.":(nama.length<3?"Minimal 3 karakter.":
      (myCats().some(c=>c.nama.toLowerCase()===nama.toLowerCase() && c.id!==id)?"Kategori sudah ada.":"")))) return false;
  const u=currentUser();
  if(id){ const c=DB.categories[u.id].find(x=>x.id===id); const old=c.nama; c.nama=nama;
    DB.transactions.forEach(t=>{ if(t.userId===u.id && t.kategori===old) t.kategori=nama; });
    save(); toast("Kategori berhasil diperbarui."); }
  else {
    try {
      const res = await API.post("/api/categories", { nama, jenis });
      if(res && res.category){
        DB.categories[u.id].push(res.category);
        save(); closeModal(); go("kategori");
        toast("Kategori berhasil ditambahkan.");
        return true;
      }
    } catch(e){}
    DB.categories[u.id].push({id:uid("cat"),nama,jenis}); toast("Kategori berhasil ditambahkan.");
  }
  save(); closeModal(); go("kategori"); return true;
}`;

html = html.replace(catSaveRegex, newCatSave);

// Replace catDelete
const catDelRegex = /function catDelete\(id\)\{[\s\S]*?\},"Ya, Hapus"\);\s*\}/;
const newCatDel = `function catDelete(id){
  const c = myCats().find(x=>x.id===id); if(!c) return;
  const used = myTx().filter(t=>t.kategori===c.nama).length;
  confirmDialog("Hapus kategori?", used? \`Kategori "\${c.nama}" masih digunakan \${used} transaksi. Transaksi tersebut akan dipindah ke kategori "Lainnya".\`
    : \`Kategori "\${c.nama}" akan dihapus.\`, async ()=>{
    const u=currentUser();
    try { await API.del("/api/categories/" + id); } catch(e){}
    DB.transactions.forEach(t=>{ if(t.userId===u.id && t.kategori===c.nama) t.kategori="Lainnya"; });
    DB.categories[u.id] = DB.categories[u.id].filter(x=>x.id!==id);
    save(); toast("Kategori berhasil dihapus."); go("kategori");
  },"Ya, Hapus");
}`;

html = html.replace(catDelRegex, newCatDel);

// Replace bizSave and pwSave
const bizSaveRegex = /function bizSave\(\)\{[\s\S]*?go\("setelan"\); return true;\s*\}/;
const newBizSave = `async function bizSave(){
  const nama=val("bz_nama"), email=val("bz_email"), pemilik=val("bz_pemilik"), hp=val("bz_hp"), alamat=val("bz_alamat"), npwp=val("bz_npwp");
  let ok = setErr("bz_nama", !nama?"Nama usaha wajib diisi.":(nama.length<3?"Minimal 3 karakter.":""));
  ok = setErr("bz_pemilik", !pemilik?"Nama pemilik wajib diisi.":"") && ok;
  ok = setErr("bz_email", !email?"Email wajib diisi.":(!isEmail(email)?"Format email tidak valid.":"")) && ok;
  ok = setErr("bz_hp", !hp?"Nomor HP wajib diisi.":(!/^[0-9+\-\\s()]{8,20}$/.test(hp) ? "Nomor HP tidak valid." : "")) && ok;
  ok = setErr("bz_jenis", !val("bz_jenis")?"Jenis usaha wajib dipilih.":"") && ok;
  ok = setErr("bz_alamat", !alamat?"Alamat wajib diisi.":(alamat.length>160?"Alamat maksimal 160 karakter.":"")) && ok;
  ok = setErr("bz_npwp", npwp && !/^[0-9.\\-\\s]{15,25}$/.test(npwp) ? "Format NPWP tidak valid." : "") && ok;
  if(!ok) return false;
  const u=currentUser();
  const jenisUsaha = normJenis(val("bz_jenis"));
  try {
    await API.put("/api/profile", { namaUsaha: nama, jenisUsaha, pemilik, email, hp, alamat, npwp });
  } catch(e){}
  DB.businessProfiles[u.id] = {namaUsaha:nama, jenisUsaha, pemilik, email, hp, alamat, npwp};
  u.namaUsaha = nama; u.jenisUsaha = jenisUsaha; save();
  closeModal(); toast("Profil usaha berhasil diperbarui."); go("setelan"); return true;
}`;

html = html.replace(bizSaveRegex, newBizSave);

// Replace pwSave
const pwSaveRegex = /function pwSave\(\)\{[\s\S]*?toast\("Password berhasil diubah\."\); return true;\s*\}/;
const newPwSave = `async function pwSave(){
  const u=currentUser(), o=val("pw_old"), n=val("pw_new"), n2=val("pw_new2");
  let ok = setErr("pw_old", !o?"Password lama wajib diisi.":"");
  ok = setErr("pw_new", !n?"Password baru wajib diisi.":(n.length<6?"Minimal 6 karakter.":"")) && ok;
  ok = setErr("pw_new2", n!==n2?"Konfirmasi tidak sama.":"") && ok;
  if(!ok) return false;
  try {
    await API.put("/api/auth/password", { currentPassword: o, newPassword: n });
    closeModal(); toast("Password berhasil diubah."); return true;
  } catch(err){
    setErr("pw_old", err.message || "Password lama salah.");
    toast(err.message || "Password lama salah.", "error");
    return false;
  }
}`;

html = html.replace(pwSaveRegex, newPwSave);

// Replace submitPayment, approvePayment, rejectPaymentSave
const payRegex = /function submitPayment\(pkgId\)[\s\S]*?function rejectPaymentSave\(id\)\{[\s\S]*?return true;\s*\}/;
const newPay = `async function submitPayment(pkgId){
  const u=currentUser(), p=DB.packages.find(x=>x.id===pkgId); if(!p) return false;
  const pesan = waPesanLangganan(p);
  const link = waLink(pesan);
  if(!link){ toast("Nomor WhatsApp admin belum diatur.","error"); return false; }
  try {
    await API.post("/api/payments", { packageId: p.id, amount: p.harga, method: "WhatsApp (Manual)" });
  } catch(e){}
  DB.paymentRequests.unshift({ id:uid("pay"), userId:u.id, packageId:p.id, amount:p.harga,
    method:"WhatsApp (Manual)", proof:null, submittedAt:new Date().toISOString(),
    status:"pending", adminNote:"", verifiedAt:null });
  myNotifs().unshift({id:uid("ntf"),judul:"Permintaan langganan terkirim",
    isi:"Pengajuan "+p.nama+" sedang menunggu konfirmasi admin melalui WhatsApp.",ts:Date.now(),read:false});
  save(); closeModal();
  window.open(link, "_blank", "noopener");
  toast("Anda diarahkan ke WhatsApp admin. Status: Menunggu Verifikasi."); paintNotifDot(); go("paket"); return true;
}
function activatePaidSub(u,req){
  const p=DB.packages.find(x=>x.id===req.packageId);
  const start=new Date(), end=p&&p.satuan==="bulan" ? addDays(start,p.durasi*30) : addDays(start,(p?p.durasi:180));
  u.plan=req.packageId; u.subStatusManual="active"; u.subStart=start.toISOString(); u.subEnd=end.toISOString();
  if(!DB.notifications[u.id]) DB.notifications[u.id]=[];
  DB.notifications[u.id].unshift({id:uid("ntf"),judul:"Langganan aktif",
    isi:(p?p.nama:"Langganan")+" aktif sampai "+fmtDate(end.toISOString().slice(0,10))+".",ts:Date.now(),read:false});
}
function approvePayment(id){
  const req=DB.paymentRequests.find(r=>r.id===id); if(!req) return;
  const u=DB.users.find(x=>x.id===req.userId);
  confirmDialog("Setujui pembayaran ini?", (u?u.nama:"Pengguna")+" akan mendapatkan langganan aktif selama 6 bulan sejak hari ini.", async ()=>{
    try {
      await API.put("/api/admin/payments/" + id + "/verify", { status: "approved" });
    } catch(e){}
    req.status="approved"; req.verifiedAt=new Date().toISOString(); req.adminNote="";
    if(u) activatePaidSub(u,req);
    save(); toast("Pembayaran disetujui. Langganan aktif."); go("adminPembayaran");
  },"Ya, Setujui",false);
}
function rejectPayment(id){
  const req=DB.paymentRequests.find(r=>r.id===id); if(!req) return;
  modal(\`<h3>Tolak Pengajuan Pembayaran</h3>
    <div class="field mt8"><label for="rj_note">Alasan Penolakan</label>
      <textarea class="input" id="rj_note" rows="3" placeholder="Contoh: bukti pembayaran tidak jelas."></textarea>
      <div class="err-msg" id="e_rj_note"></div></div>
    <div class="modal-act"><button class="btn btn-outline" onclick="closeModal()">Batal</button>
    <button class="btn btn-danger" onclick="rejectPaymentSave('\${id}')">Tolak Pengajuan</button></div>\`);
}
async function rejectPaymentSave(id){
  const note=val("rj_note");
  if(!setErr("rj_note", !note?"Alasan penolakan wajib diisi.":"")) return false;
  const req=DB.paymentRequests.find(r=>r.id===id); if(!req) return false;
  try {
    await API.put("/api/admin/payments/" + id + "/verify", { status: "rejected", adminNote: note });
  } catch(e){}
  req.status="rejected"; req.adminNote=note; req.verifiedAt=new Date().toISOString();
  const u=DB.users.find(x=>x.id===req.userId);
  if(u){ if(!DB.notifications[u.id]) DB.notifications[u.id]=[];
    DB.notifications[u.id].unshift({id:uid("ntf"),judul:"Pengajuan pembayaran ditolak",isi:note,ts:Date.now(),read:false}); }
  save(); closeModal(); toast("Pengajuan pembayaran ditolak.","info"); go("adminPembayaran"); return true;
}`;

html = html.replace(payRegex, newPay);

// Replace boot function
const bootRegex = /function boot\(\)\{[\s\S]*?window\.SMARTA[\s\S]*?\}/;
const newBoot = `async function boot(){
  load();
  await bootstrapApp();
  renderLanding();
  if(currentUser()){ enterApp(); } else { showLanding(); }
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ closeModal(); closeSidebar(); } });
  window.SMARTA = Object.assign(window.SMARTA || {}, { DB, profitLoss, interpret, totals, monthlySeries,
    subStatus, subscriptionState, trialLeft, rp, save, go, toTransactionDTO, fromTransactionDTO, DataStore, API, bootstrapApp });
}`;

html = html.replace(bootRegex, newBoot);

fs.writeFileSync("./public/smarta.html", html, "utf-8");
console.log("Successfully updated public/smarta.html!");
