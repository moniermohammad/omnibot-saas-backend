const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// =======================================================================
// 1. MIDDLEWARE UNTUK HUMAN USER (ADMIN / SALES VIA FLUTTER APP)
// =======================================================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error("🚨 BAHAYA: Variabel JWT_SECRET belum dikonfigurasi di file .env Anda!");
    return res.status(500).json({
      success: false,
      message: "🚨 Gangguan konfigurasi keamanan pada server lokal.",
    });
  }

  // A. Cek apakah header Authorization ada
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error_code: "TOKEN_MISSING",
      message: "🔒 Akses ditolak! Anda tidak menyertakan Token Otentikasi (Bearer Token) pada HTTP Header Authorization.",
    });
  }

  // B. Pastikan menggunakan format format 'Bearer <TOKEN>'
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({
      success: false,
      error_code: "TOKEN_FORMAT_INVALID",
      message: "Format Token salah! Penulisan token yang benar di Header adalah: Bearer <string_token_jwt_anda>",
    });
  }

  const token = parts[1];

  // C. Verifikasi validitas token JWT dengan pesan error super detail
  jwt.verify(token, jwtSecret, (err, decodedUser) => {
    if (err) {
      console.error("🔒 JWT Verification Error:", err.message);

      // Kasus 1: Token sudah kedaluwarsa (Expired)
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          error_code: "TOKEN_EXPIRED",
          message: "❌ Sesi Anda telah berakhir (Token Expired)! Silakan lakukan login ulang untuk mendapatkan token baru.",
          expired_at: err.expiredAt,
        });
      }

      // Kasus 2: Teks Token diubah-ubah / salah kunci secret / sisa database sebelum di-reset
      if (err.name === "JsonWebTokenError") {
        return res.status(403).json({
          success: false,
          error_code: "TOKEN_INVALID",
          message: "❌ Token tidak valid atau tanda tangan digital rusak! Token ini mungkin milik database sebelum di-reset atau JWT Secret salah.",
        });
      }

      // Kasus 3: Error JWT lainnya
      return res.status(403).json({
        success: false,
        error_code: "TOKEN_VERIFICATION_FAILED",
        message: `❌ Gagal memverifikasi token. Alasan: ${err.message}`,
      });
    }

    // Jika sukses, tempelkan profile ke req.user
    req.user = decodedUser;
    next();
  });
}

// =======================================================================
// 2. MIDDLEWARE UNTUK WHATSAPP BOT ENGINE / POSTMAN (VIA KEY BOT TENANT)
// =======================================================================
async function authenticateBotKey(req, res, next) {
  try {
    const botKey = req.headers["x-bot-tenant-key"];
    if (!botKey) {
      return res.status(401).json({
        success: false,
        message: "🔒 Akses ditolak! Header 'x-bot-tenant-key' tidak ditemukan di request.",
      });
    }

    // Cari Tenant berdasarkan field keyBotTenant di Database PostgreSQL
    const tenant = await prisma.tenant.findUnique({
      where: { keyBotTenant: botKey },
    });

    if (!tenant) {
      return res.status(403).json({
        success: false,
        message: "❌ Key Bot Tenant tidak valid atau tidak terdaftar!",
      });
    }

    // Proteksi status langganan SaaS
    if (tenant.status === "EXPIRED" || tenant.status === "SUSPENDED") {
      return res.status(402).json({
        success: false,
        message: "⚠️ Akses Bot ditangguhkan. Masa berlangganan Tenant ini telah habis.",
      });
    }

    // Tempelkan data tenant ke req.tenant & set req.user ke null
    req.tenant = tenant;
    req.user = null;
    next();
  } catch (error) {
    console.error("🚨 Error pada authenticateBotKey Middleware:", error);
    return res.status(500).json({
      success: false,
      message: "⚠️ Terjadi kesalahan internal server pada proses otentikasi Bot.",
    });
  }
}

// 🌟 Ekspor kedua fungsi middleware
module.exports = {
  authenticateToken,
  authenticateBotKey,
};

// const jwt = require("jsonwebtoken");
// const { PrismaClient } = require("@prisma/client");
// const prisma = new PrismaClient();

// // =======================================================================
// // 1. MIDDLEWARE UNTUK HUMAN USER (ADMIN / SALES VIA FLUTTER APP)
// // =======================================================================
// function authenticateToken(req, res, next) {
//   const authHeader = req.headers["authorization"];
//   const token = authHeader && authHeader.split(" ")[1]; // Mengambil token setelah kata 'Bearer'

//   const jwtSecret = process.env.JWT_SECRET;

//   if (!jwtSecret) {
//     console.error("🚨 BAHAYA: Variabel JWT_SECRET belum dikonfigurasi di file .env Anda!");
//     return res.status(500).json({
//       success: false,
//       message: "🚨 Gangguan konfigurasi keamanan pada server lokal.",
//     });
//   }

//   if (!token) {
//     return res.status(401).json({
//       success: false,
//       message: "🔒 Akses ditolak! Token otentikasi tidak ditemukan di header aplikasi.",
//     });
//   }

//   jwt.verify(token, jwtSecret, (err, decodedUser) => {
//     if (err) {
//       return res.status(403).json({
//         success: false,
//         message: "❌ Sesi Anda telah berakhir atau token tidak valid. Silakan login kembali.",
//       });
//     }

//     req.user = decodedUser;
//     next();
//   });
// }

// // =======================================================================
// // 2. MIDDLEWARE UNTUK WHATSAPP BOT ENGINE / POSTMAN (VIA KEY BOT TENANT)
// // =======================================================================
// async function authenticateBotKey(req, res, next) {
//   try {
//     const botKey = req.headers["x-bot-tenant-key"];

//     if (!botKey) {
//       return res.status(401).json({
//         success: false,
//         message: "🔒 Akses ditolak! Header 'x-bot-tenant-key' tidak ditemukan di request.",
//       });
//     }

//     // Cari Tenant berdasarkan field keyBotTenant di Database PostgreSQL
//     const tenant = await prisma.tenant.findUnique({
//       where: { keyBotTenant: botKey },
//     });

//     if (!tenant) {
//       return res.status(403).json({
//         success: false,
//         message: "❌ Key Bot Tenant tidak valid atau tidak terdaftar!",
//       });
//     }

//     // Proteksi status langganan SaaS
//     if (tenant.status === "EXPIRED" || tenant.status === "SUSPENDED") {
//       return res.status(402).json({
//         success: false,
//         message: "⚠️ Akses Bot ditangguhkan. Masa berlangganan Tenant ini telah habis.",
//       });
//     }

//     // Tempelkan data tenant ke req.tenant & set req.user ke null
//     req.tenant = tenant;
//     req.user = null;

//     next();
//   } catch (error) {
//     console.error("🚨 Error pada authenticateBotKey Middleware:", error);
//     return res.status(500).json({
//       success: false,
//       message: "⚠️ Terjadi kesalahan internal server pada proses otentikasi Bot.",
//     });
//   }
// }

// // 🌟 Ekspor kedua fungsi middleware
// module.exports = {
//   authenticateToken,
//   authenticateBotKey,
// };
