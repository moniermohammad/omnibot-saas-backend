require("dotenv").config();
const prisma = require("../../config/prisma");
const jwt = require("jsonwebtoken");

const { activeSockets } = require("../../botMemory");

// 🌟 STRATEGI BEBAS HARDCODE: Ambil variabel murni dari berkas .env
const JWT_SECRET = process.env.JWT_SECRET;
const MASTER_BOT_NUMBER = process.env.MASTER_BOT_NUMBER; // 👈 Diambil dinamis dari .env

const crypto = require("crypto");

/**
 * MIDDLEWARE CHECKPOINT INTERN: Memastikan server memiliki konfigurasi .env yang sah
 */
function checkEnvConfig(res) {
  if (!JWT_SECRET || !MASTER_BOT_NUMBER) {
    console.error("🚨 KESALAHAN KONFIGURASI: Variabel JWT_SECRET atau MASTER_BOT_NUMBER belum ada di berkas .env!");
    res.status(500).json({
      success: false,
      message: "🚨 Gangguan konfigurasi sistem keamanan pada server lokal.",
    });
    return false;
  }
  return true;
}

/**
 * ENDPOINT 1: Meminta Kode Token Verifikasi Login via WhatsApp
 * POST /api/auth/request-token
 */
// async function requestLoginToken(req, res) {
//   if (!checkEnvConfig(res)) return; // Validasi .env

//   try {
//     const { phoneNumber } = req.body;
//     if (!phoneNumber) {
//       return res.status(400).json({ success: false, message: "⚠️ Nomor handphone wajib diisi!" });
//     }

//     let cleanPhone = phoneNumber.replace(/[^0-9]/g, "");

//     if (cleanPhone.startsWith("0")) {
//       cleanPhone = "62" + cleanPhone.substring(1);
//     }

//     // Cari user berdasarkan nomor HP di database PostgreSQL
//     const user = await prisma.user.findUnique({
//       where: { phoneNumber: cleanPhone },
//       include: { tenant: true },
//     });

//     if (!user) {
//       return res.status(404).json({ success: false, message: "❌ Nomor HP Anda belum terdaftar di sistem bisnis mana pun." });
//     }

//     if (user.tenant.status === "EXPIRED") {
//       return res.status(403).json({ success: false, message: "🔒 Akun ditangguhkan. Masa aktif langganan bisnis Anda telah habis." });
//     }

//     // Acak 6 digit angka token secara acak (Random OTP Generator)
//     const rawToken = Math.floor(100000 + Math.random() * 900000).toString();

//     // Setel waktu kedaluwarsa token 5 menit dari sekarang
//     const expiryTime = new Date();
//     expiryTime.setMinutes(expiryTime.getMinutes() + 5);

//     // 🌟 PERBAIKAN: Diubah dari id menjadi userId sesuai schema prisma baru
//     await prisma.user.update({
//       where: { userId: user.userId },
//       data: {
//         loginToken: rawToken,
//         tokenExpiry: expiryTime,
//       },
//     });

//     // 🌟 AMBIL INSTANCE: Membaca pointer dinamis berdasarkan nomor murni dari file .env
//     const masterSock = activeSockets["MASTER_SYSTEM"] || activeSockets[MASTER_BOT_NUMBER];

//     if (!masterSock) {
//       console.error(`🚨 Gagal mengirim WA: Perangkat Master Bot (+${MASTER_BOT_NUMBER}) belum online!`);
//       return res.status(500).json({ success: false, message: "⚠️ Server gagal menghubungkan layanan WhatsApp Bot Utama. Coba sesaat lagi." });
//     }

//     const targetJid = `${cleanPhone}@s.whatsapp.net`;
//     const waMessageText =
//       `🔐 *KODE VERIFIKASI LOGIN (OTP)* 🔐\n\n` +
//       `Halo *${user.name}*,\n` +
//       `Berikut adalah kode token verifikasi untuk masuk ke Aplikasi Mobile CRM Anda:\n\n` +
//       `👉   *${rawToken}*   👈\n\n` +
//       `⚠️ *Jangan bagikan kode ini kepada siapa pun!* Kode token ini otomatis hangus dalam waktu 5 menit.`;

//     // Tembak pesan WhatsApp langsung dari server
//     await masterSock.sendMessage(targetJid, { text: waMessageText });

//     return res.status(200).json({
//       success: true,
//       message: "📩 Kode token verifikasi login berhasil dikirim ke nomor WhatsApp Anda. Silakan periksa chat Anda!",
//     });
//   } catch (error) {
//     console.error("🚨 Eror Request Token Controller:", error);
//     return res.status(500).json({ success: false, message: "⚠️ Gangguan server internal laptop saat memproses kode token." });
//   }
// }


async function requestLoginToken(req, res) {
  if (!checkEnvConfig(res)) return; // Validasi .env

  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: "⚠️ Nomor handphone wajib diisi!" });
    }

    let cleanPhone = phoneNumber.replace(/[^0-9]/g, "");

    if (cleanPhone.startsWith("0")) {
      cleanPhone = "62" + cleanPhone.substring(1);
    }

    // Validasi panjang minimal nomor HP standar
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ success: false, message: "⚠️ Format nomor handphone tidak valid!" });
    }

    // Cari user berdasarkan nomor HP di database PostgreSQL
    const user = await prisma.user.findUnique({
      where: { phoneNumber: cleanPhone },
      include: { tenant: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "❌ Nomor HP Anda belum terdaftar di sistem bisnis mana pun.",
      });
    }

    // 1. Blokir jika akun user/sales dinonaktifkan oleh Owner (isActive: false)
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "⛔ Akun Anda sedang dinonaktifkan oleh Owner bisnis Anda. Hubungi Owner untuk mengaktifkan kembali.",
      });
    }

    // 2. Cek masa aktif langganan: OWNER/ADMIN tetap boleh masuk untuk perpanjangan, hanya SALES yang diblokir
    const isTenantExpired =
      user.tenant.status === "EXPIRED" ||
      (user.tenant.subscriptionEnd && new Date() > new Date(user.tenant.subscriptionEnd));

    if (isTenantExpired && user.role === "SALES") {
      return res.status(403).json({
        success: false,
        message: "🔒 Masa aktif paket bisnis Anda telah berakhir. Silakan hubungi Owner untuk melakukan perpanjangan paket.",
      });
    }

    // 3. Proteksi Rate Limit / Cooldown 60 detik (Anti-Spam Master Bot)
    // Karena masa berlaku token 5 menit, jika sisa waktu > 4 menit berarti belum 60 detik sejak request terakhir
    if (user.tokenExpiry) {
      const timeRemaining = new Date(user.tokenExpiry).getTime() - Date.now();
      const cooldownThreshold = 4 * 60 * 1000; // 4 menit dalam milidetik

      if (timeRemaining > cooldownThreshold) {
        const waitSeconds = Math.ceil((timeRemaining - cooldownThreshold) / 1000);
        return res.status(429).json({
          success: false,
          message: `⏳ Kode OTP baru saja dikirim. Silakan tunggu ${waitSeconds} detik sebelum meminta kode ulang.`,
          retryAfter: waitSeconds, // Opsional: bisa dipakai UI untuk timer hitung mundur otomatis
        });
      }
    }

    // 4. Cek koneksi Master Bot terlebih dahulu sebelum update database
    const masterSock = activeSockets["MASTER_SYSTEM"] || activeSockets[MASTER_BOT_NUMBER];

    if (!masterSock) {
      console.error(`🚨 Gagal mengirim WA: Perangkat Master Bot (+${MASTER_BOT_NUMBER}) belum online!`);
      return res.status(500).json({
        success: false,
        message: "⚠️ Server gagal menghubungkan layanan WhatsApp Bot Utama. Coba sesaat lagi.",
      });
    }

    const targetJid = `${cleanPhone}@s.whatsapp.net`;

    // 5. Pastikan nomor tujuan benar-benar terdaftar di WhatsApp
    const [waCheck] = await masterSock.onWhatsApp(targetJid);
    if (!waCheck || !waCheck.exists) {
      return res.status(400).json({
        success: false,
        message: "❌ Nomor ini tidak terdaftar di WhatsApp aktif.",
      });
    }

    // 6. Acak 6 digit angka token menggunakan modul crypto (Cryptographically Secure)
    const rawToken = crypto.randomInt(100000, 1000000).toString();

    // Setel waktu kedaluwarsa token 5 menit dari sekarang
    const expiryTime = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        loginToken: rawToken,
        tokenExpiry: expiryTime,
      },
    });

    const waMessageText =
      `🔐 *KODE VERIFIKASI LOGIN (OTP)* 🔐\n\n` +
      `Halo *${user.name}*,\n` +
      `Berikut adalah kode token verifikasi untuk masuk ke Aplikasi CRM Anda:\n\n` +
      `👉   *${rawToken}*   👈\n\n` +
      `⚠️ *Jangan bagikan kode ini kepada siapa pun!* Kode token ini otomatis hangus dalam waktu 5 menit.`;

    // Tembak pesan WhatsApp langsung dari server
    await masterSock.sendMessage(targetJid, { text: waMessageText });

    return res.status(200).json({
      success: true,
      message: "📩 Kode token verifikasi login berhasil dikirim ke nomor WhatsApp Anda. Silakan periksa chat Anda!",
      retryAfter: 60, // Info ke frontend bahwa tombol kirim ulang dikunci 60 detik
    });
  } catch (error) {
    console.error("🚨 Eror Request Token Controller:", error);
    return res.status(500).json({
      success: false,
      message: "⚠️ Gangguan server internal saat memproses kode token.",
    });
  }
}

/**
 * ENDPOINT 2: Validasi Token dari HP Klien & Penerbitan Sesi JWT Permanen
 * POST /api/auth/verify-token
 */
async function verifyLoginToken(req, res) {
  if (!checkEnvConfig(res)) return; // Validasi .env

  try {
    const { phoneNumber, tokenCode } = req.body;

    if (!phoneNumber || !tokenCode) {
      return res.status(400).json({ success: false, message: "⚠️ Nomor handphone dan kode token verifikasi wajib diisi!" });
    }

    let cleanPhone = phoneNumber.replace(/[^0-9]/g, "");

    if (cleanPhone.startsWith("0")) {
      cleanPhone = "62" + cleanPhone.substring(1);
    }

    const cleanToken = (tokenCode || "").toString().trim();

    const user = await prisma.user.findUnique({
      where: { phoneNumber: cleanPhone },
      include: { tenant: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "❌ Nomor HP Anda belum terdaftar di sistem kami." });
    }

    // 1. Blokir jika akun user/sales dinonaktifkan oleh Owner (isActive: false)
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "⛔ Akun Anda sedang dinonaktifkan oleh Owner bisnis Anda. Hubungi Owner untuk mengaktifkan kembali.",
      });
    }

    // 2. Jika tenant EXPIRED, blokir hanya untuk role SALES (OWNER tetap boleh masuk untuk perpanjangan)
    const now = new Date();
    const isTenantExpired =
      user.tenant.status === "EXPIRED" ||
      (user.tenant.subscriptionEnd && now > new Date(user.tenant.subscriptionEnd));

    if (isTenantExpired && user.role === "SALES") {
      return res.status(403).json({
        success: false,
        message: "🔒 Masa aktif paket bisnis Anda telah berakhir. Silakan hubungi Owner untuk melakukan perpanjangan paket.",
      });
    }

    if (!user.loginToken) {
      return res.status(401).json({ success: false, message: "❌ Sesi login tidak ditemukan atau Anda belum meminta kode baru." });
    }

    if (now > user.tokenExpiry) {
      return res.status(410).json({ success: false, message: "⏰ Maaf, kode token verifikasi Anda sudah kedaluwarsa. Silakan minta kode baru." });
    }

    if (user.loginToken !== cleanToken) {
      return res.status(401).json({ success: false, message: "❌ Kode token verifikasi yang Anda masukkan salah. Periksa kembali chat WA Anda." });
    }

    // JIKA LOLOS: Bersihkan kolom token di database (Sekali Pakai)
    await prisma.user.update({
      where: { userId: user.userId },
      data: { loginToken: null, tokenExpiry: null },
    });

    // Terbitkan Token Sesi JWT Asli
    const sessionJwtToken = jwt.sign(
      { userId: user.userId, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      success: true,
      message: "🎉 Verifikasi sukses! Selamat datang kembali.",
      token: sessionJwtToken,
      user: {
        id: user.userId,
        tenantId: user.tenantId,
        businessName: user.tenant.businessName,
        name: user.name,
        phoneNumber: user.phoneNumber,
        role: user.role,
        token: sessionJwtToken,
      },
    });
  } catch (error) {
    console.error("🚨 Eror Verify Token Controller:", error);
    return res.status(500).json({ success: false, message: "⚠️ Gangguan sistem verifikasi server database." });
  }
}

// async function verifyLoginToken(req, res) {
//   if (!checkEnvConfig(res)) return; // Validasi .env

//   try {
//     const { phoneNumber, tokenCode } = req.body;

//     if (!phoneNumber || !tokenCode) {
//       return res.status(400).json({ success: false, message: "⚠️ Nomor handphone dan kode token verifikasi wajib diisi!" });
//     }

//     let cleanPhone = phoneNumber.replace(/[^0-9]/g, "");

//     if (cleanPhone.startsWith("0")) {
//       cleanPhone = "62" + cleanPhone.substring(1);
//     }

//     const cleanToken = (tokenCode || "").toString().trim();

//     const user = await prisma.user.findUnique({
//       where: { phoneNumber: cleanPhone },
//       include: { tenant: true },
//     });

//     if (!user) {
//       return res.status(404).json({ success: false, message: "❌ Nomor HP Anda belum terdaftar di sistem kami." });
//     }

//     if (!user.loginToken) {
//       return res.status(401).json({ success: false, message: "❌ Sesi login tidak ditemukan atau Anda belum meminta kode baru." });
//     }

//     const now = new Date();
//     if (now > user.tokenExpiry) {
//       return res.status(410).json({ success: false, message: "⏰ Maaf, kode token verifikasi Anda sudah kedaluwarsa. Silakan minta kode baru." });
//     }

//     if (user.loginToken !== cleanToken) {
//       return res.status(401).json({ success: false, message: "❌ Kode token verifikasi yang Anda masukkan salah. Periksa kembali chat WA Anda." });
//     }

//     // JIKA LOLOS: Bersihkan kolom token di database (Sekali Pakai)
//     // 🌟 PERBAIKAN: Diubah dari id menjadi userId
//     await prisma.user.update({
//       where: { userId: user.userId },
//       data: { loginToken: null, tokenExpiry: null },
//     });

//     // Terbitkan Token Sesi JWT Asli menggunakan variabel .env murni
//     const sessionJwtToken = jwt.sign({ userId: user.userId, tenantId: user.tenantId, role: user.role }, JWT_SECRET, { expiresIn: "30d" });

//     return res.status(200).json({
//       success: true,
//       message: "🎉 Verifikasi sukses! Selamat datang kembali.",
//       token: sessionJwtToken,
//       user: {
//         id: user.userId, // 🌟 PERBAIKAN: Sinkron dengan userId
//         tenantId: user.tenantId,
//         businessName: user.tenant.businessName,
//         name: user.name,
//         phoneNumber: user.phoneNumber,
//         role: user.role,
//         token: sessionJwtToken,
//       },
//     });
//   } catch (error) {
//     console.error("🚨 Eror Verify Token Controller:", error);
//     return res.status(500).json({ success: false, message: "⚠️ Gangguan sistem verifikasi server database." });
//   }
// }

module.exports = { requestLoginToken, verifyLoginToken };
