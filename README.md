# Keuangan Mandiri V2.1 · Vercel + Neon

Aplikasi pengelolaan keuangan pribadi, dibangun ulang **tanpa Google Apps Script, Google Sheets, atau Excel**. Tampilan responsif untuk HP dan laptop.

**Teknologi:** FastAPI (Python 3.12), HTML/CSS/JavaScript murni, SQLAlchemy, Neon PostgreSQL, Vercel. Tidak ada proses `npm build`, container, atau `uvicorn start` di Vercel. File `app.py` terdeteksi otomatis oleh Vercel.

## PERBAIKAN V2.1 (28 Oktober 2026)

- Memperbaiki **500 FUNCTION_INVOCATION_FAILED** saat `app.py` diimpor di Vercel: folder `public/assets` dapat tidak tersedia di filesystem Python Function sebab `public/` dilayani oleh CDN Vercel. Sekarang FastAPI **tidak mewajibkan folder tersebut saat import**.
- Route `/` aman saat file `public/index.html` tidak ada di filesystem serverless: mengarahkan ke `/index.html` di CDN.
- Tambah `/health` untuk memeriksa proses FastAPI dan `/health/db` untuk memeriksa koneksi Neon + tabel (tidak menampilkan password atau connection string). Kalau `/health/db` error, rincian kegagalan ada di **Vercel Runtime Logs**.
- Tetap menggunakan **nama tabel dan kolom lama**. Memakai Neon project yang sudah dibuat sebelumnya; **tidak perlu hapus database atau jalankan SQL ulang**.
- Tes backend lokal dengan simulasi filesystem Vercel tanpa `public/` tersedia.

### Cara UPDATE REPO LAMA lewat HP / Termux (yang sudah pernah berhasil git push)

1. Download `keuangan-mandiri-v2.1-vercel-neon.zip` dari chat ini ke folder **Download** Android.
2. Buka Termux. Kode berikut **menimpa file aplikasi di folder lama**, tidak menghapus folder `.git`, data lokal lain, atau tabel Neon:

```sh
cd ~/keuangan-mandiri-neon
unzip -o ~/storage/downloads/keuangan-mandiri-v2.1-vercel-neon.zip -d .
git status
git add app.py database.py models.py requirements.txt .python-version README.md .gitignore .env.example public tests tools
# Jika ada file baru lain dari ZIP, tambahkan juga secara sadar; jangan git add file .env.
git commit -m "Fix Vercel runtime static files - V2.1"
git push origin main
```

Jika file ZIP disimpan dengan nama lain, sesuaikan nama file di perintah `unzip`. Jika `cd` gagal, jalankan `ls ~` untuk mencari folder repo. Jika `git status` mengatakan *not a git repository*, berarti sedang di folder yang salah, jangan `git init` acak.

3. Vercel → **Deployments**: pastikan deployment **Production** menggunakan commit `Fix Vercel runtime static files - V2.1`. Jangan pilih deployment lama untuk Redeploy.
4. Buka `/health` → harus JSON `status: ok`. Lanjut `/health/db` → harus JSON `database: connected` jika Neon siap. Baru coba login.

**Jangan hapus Neon atau mengganti `DATABASE_URL` jika sudah benar**, karena data keuangan yang pernah tersimpan di Neon bisa tetap digunakan. Pastikan tidak ada kredensial `.env` yang ikut di-commit.

---

## Fitur

- Login pribadi (1 pemilik), cookie `HttpOnly`, proteksi CSRF, pembatasan percobaan login.
- Dashboard saldo semua akun, pemasukan/pengeluaran, arus kas, grafik 6 bulan.
- Transaksi pemasukan, pengeluaran, transfer rekening, edit dan hapus.
- Akun tunai/bank/e-wallet/tabungan; saldo dihitung dari ledger, arsip akun.
- Kategori pemasukan/pengeluaran, arsip kategori.
- Budget per kategori/bulan, indikator penggunaan budget.
- Target keuangan dan riwayat total setoran (catatan progres, tidak mendebit saldo).
- Hutang/piutang dan pembayaran yang otomatis menambah transaksi kas.
- Transaksi berulang (mingguan, bulanan, tahunan).
- Laporan per bulan, trend, kategori pengeluaran.
- Backup JSON (tanpa Excel).

**Penting:** Ini basis data BARU. Data lama di Google Sheets **tidak hilang dan tidak otomatis muncul** di aplikasi baru. Untuk memindahkan data lama, perlu migrasi satu kali, dibuat terpisah agar data lama tidak tertimpa atau dobel. Jangan hapus Apps Script/Sheets lama sebelum migrasi selesai diverifikasi.

## 1. Siapkan database Neon

1. Masuk ke dashboard Neon lalu buat project PostgreSQL baru bernama misalnya `keuangan-mandiri`. Gunakan database terpisah dari proyek website lain.
2. Pada halaman **Connect** pilih `Connection string` dan nyalakan **Pooled connection**.
3. Salin URI koneksi, contohnya (dummy):

   ```text
   postgresql://user:password@ep-example-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Simpan untuk nilai `DATABASE_URL` di Vercel. Gunakan yang benar-benar ditampilkan Neon, bukan contoh dummy. **Jangan unggah ke GitHub.**
5. Tabel, akun default `Tunai`, dan kategori dasar akan otomatis dibuat setelah akses pertama ke API yang terautentikasi atau pada login pertama. Tidak perlu import SQL manual.

## 2. Upload source ke GitHub

1. Ekstrak berkas ZIP. Untuk repo lama, gunakan `Felix-rg/keuangan-mandiri` (tidak perlu buat baru).
2. Upload **seluruh isi ZIP** ke root repository, bukan ZIP itu sendiri. Pastikan di root repo ada `app.py`, `database.py`, `models.py`, `requirements.txt`, `.python-version`, dan folder `public/`.
3. File `.env` jangan pernah diunggah; `.gitignore` sudah melindunginya.

Alternatif lewat Terminal / Termux pada folder project:

```bash
git init
git add .
git commit -m "Keuangan Mandiri - Neon PostgreSQL"
git branch -M main
git remote add origin https://github.com/USERNAME/keuangan-mandiri-neon.git
git push -u origin main
```

Jika `remote origin already exists`, gunakan `git remote set-url origin <alamat-repo>` alih-alih `git remote add`. Jika GitHub meminta password, gunakan autentikasi yang didukung GitHub (bukan password akun GitHub biasa).

## 3. Hubungkan GitHub → Vercel

1. Vercel → **Add New** → **Project** → import repo baru.
2. **Framework preset**: biarkan otomatis mendeteksi FastAPI. **Root directory**: `/` (root repo).
3. **Build Command, Output Directory, Install Command**: biarkan default/kosong; jangan isi `uvicorn app:app` di Vercel.
4. Project Settings → **Environment Variables**, tambahkan:

| Nama | Nilai |
| --- | --- |
| `DATABASE_URL` | URI Neon PostgreSQL **Pooled**, `?sslmode=require` |
| `APP_USERNAME` | `owner` atau username pribadi |
| `APP_PASSWORD` | password kuat dan unik, minimal disarankan 14 karakter |
| `SESSION_SECRET` | teks acak panjang minimal 32 karakter |
| `APP_ENV` | `production` |

Tips buat secret lewat Python/Termux/PowerShell:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy hasilnya ke `SESSION_SECRET` (jangan copy perintahnya). Alternatif password disimpan menggunakan `APP_PASSWORD_HASH` PBKDF2, lihat `tools/hash_password.py`.

5. Klik **Deploy**. Kalau variabel baru ditambah setelah deploy, **Deployments → Redeploy deployment terbaru**. Jika source di GitHub berubah, pastikan deployment Production memakai commit paling baru, bukan redeploy commit lama.
6. Buka URL domain `*.vercel.app`, login sesuai env. Awal-awal data kosong selain akun `Tunai` dan kategori bawaan. Lalu coba input pemasukan/pengeluaran dan refresh browser untuk memastikan data tersimpan di Neon.
7. Di Neon → **SQL Editor**, cek muncul tabel seperti `accounts`, `transactions`, `budgets`, `debts`, dll.

### Jika gagal

| Masalah | Solusi |
| --- | --- |
| 503 saat login | `DATABASE_URL`, `SESSION_SECRET`, dan `APP_PASSWORD` belum benar atau Neon tidak bisa dihubungi. |
| `/health` sukses, `/health/db` 503 | Backend hidup tetapi Neon belum terhubung / belum diinisialisasi. Periksa Runtime Logs. |
| `public/assets directory does not exist` | Seharusnya sudah diperbaiki di V2.1; pastikan commit terbaru benar-benar ter-deploy. |
| `psycopg` gagal install | Cek Python 3.12 dan `requirements.txt` benar di root; lihat Vercel Build Logs. |
| Login gagal padahal password benar | Cocokkan username dan password Environment Variables lalu **redeploy**. |
| Halaman 404 | Pastikan `app.py` dan folder `public` ada di root, tidak mengubah Root Directory di Vercel. |
| Neon gagal koneksi | Pastikan URI tepat seperti di halaman Connect, database benar, ada `sslmode=require`, dan password koneksi belum direset. |
| Lambat pada akses pertama setelah lama tidak dipakai | Neon/Vercel dapat mengalami cold start; setelah aktif, permintaan selanjutnya biasanya lebih cepat, tetapi tidak bisa dijamin selalu instan. |

**Region:** pilih lokasi Vercel function sedekat mungkin dengan region database Neon untuk mengurangi latensi. Pengaturan di dashboard tergantung plan.

## 4. Uji di laptop (opsional)

Buat `.env` lokal dari `.env.example`, isi akun Neon dan secret pribadi, lalu:

```bash
python -m pip install -r requirements.txt
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Buka `http://127.0.0.1:8000`.

**Catatan cookie:** saat uji lokal menggunakan `http://`, **jangan** isi `APP_ENV=production` dalam `.env` karena cookie secure hanya dapat dipakai lewat HTTPS. Ganti `APP_ENV=development` selama pengujian lokal. Di Vercel gunakan `production`.

Untuk test dengan SQLite sementara di komputer pengembang saja:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q tests/
```

SQLite **tidak dipakai** di Vercel; test sengaja memakai SQLite agar tidak menyentuh database Neon milikmu.

## 5. Aturan penting pengelolaan data

- **Tidak ada kredensial di GitHub**. Semua password, token, dan URI database ada di Environment Variables.
- Satu akun login milik pemilik aplikasi. Tidak cocok untuk multiuser dengan data terpisah tanpa perubahan autentikasi dan skema.
- **Saldo** = saldo awal + pemasukan − pengeluaran − transfer keluar + transfer masuk. Transfer bukan pendapatan.
- **Setoran target** hanya catatan progres; gunakan transfer atau transaksi terpisah bila benar-benar memindahkan uang.
- **Pembayaran hutang/piutang** otomatis membuat mutasi kas. Jangan input manual transaksi yang sama, supaya tidak dobel.
- **Berulang** diproses ketika login/buka dashboard atau tekan tombol "Proses sekarang". Tidak berjalan secara cron jika aplikasi tidak dibuka. Cek jadwal yang tertunda, setiap pemrosesan dibatasi 24 kejadian per jadwal.
- Riwayat transaksi bulan pilihan ditampilkan maksimal **400 terbaru**. Ringkasan, saldo, dan anggaran tetap dihitung dari data penuh di database.
- Backup **JSON** bisa diunduh lewat Pengaturan. Simpan salinan backup di tempat privat. **Belum tersedia restore otomatis**; jangan menganggap download JSON saja cukup jika belum pernah memverifikasi cadangan secara manual.
- Versi awal melakukan `create_all()` untuk database baru. Perubahan skema ke depan perlu migrasi database terencana, misalnya Alembic, bukan menghapus tabel.

### Struktur folder

```text
keuangan-mandiri-neon/
├── app.py                 # FastAPI + otentikasi + route transaksi
├── database.py            # Engine Neon + bootstrap schema
├── models.py              # PostgreSQL models
├── public/
│   ├── index.html
│   └── assets/
│       ├── app.js
│       ├── styles.css
│       └── icon.svg
├── tools/hash_password.py # opsional membuat hash password
├── tests/test_app.py
├── requirements.txt
├── requirements-dev.txt
├── .python-version
├── .gitignore
└── .env.example
```

## Catatan implementasi

Desain dibuat untuk satu pemilik, tanpa library frontend pihak ketiga, dengan server-side autentikasi. Server menyimpan integer rupiah (`BIGINT`) sehingga tidak memakai floating-point untuk saldo. API menggunakan SQLAlchemy dan Postgres Neon Pooled URI. Ini versi siap dicoba dan telah dilengkapi tes lokal; uji deployment dan data riil di Neon/Vercel tetap perlu dilakukan pada akunmu.
# management-keuangan
