# rest_crm_bot_api

// hapus semua tabel
//--npx prisma db push --force-reset
// Menghubungkan ulang skema
//--npx prisma db push
// Memperbarui kode Prisma Client
//--npx prisma generate
// jalanan seed
//--node prisma/seed.js

# 1. Simpan perubahan Anda ke staging area

git add .

# 2. Buat catatan perubahan (commit)

git commit -m "fitur: update seeder data untuk model product dan quotation"

# 3. Tarik kode terbaru dari server dengan rebase (Sesuai pertanyaan Anda)

git pull origin main --rebase

# 4. Kirim kode lokal yang sudah rapi ke server

git push origin main
