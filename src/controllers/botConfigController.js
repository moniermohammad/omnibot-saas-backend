const prisma = require("../../config/prisma");
const { connectToWhatsApp } = require("../whatsapp/connection");
const { activeSockets: memorySockets } = require("../../botMemory");
const fs = require("fs");
const path = require("path");
const {
  fetchBotMenuConfiguration,
  checkBotConnectionStatus,
  autoStartActiveBots,
  deleteAuthValue,
} = require("../services/botService");

// Helper aman untuk selalu mengambil sumber socket yang sama di seluruh aplikasi
function getSocketByTenant(tenantId) {
  const store = global.activeSockets || memorySockets || {};
  return store[tenantId] || null;
}

async function checkBotStatus(req, res) {
  const currentTenantId = req.user?.tenantId;
  const role = req.user?.role?.toLowerCase();

  try {
    let targetTenantId = currentTenantId;
    if ((role === "owner" || role === "admin") && req.query.tenantId) {
      targetTenantId = req.query.tenantId;
    }

    if (!targetTenantId) {
      return res.status(400).json({
        success: false,
        message: "⚠️ Identifikasi Tenant ID tidak ditemukan.",
      });
    }

    // 🌟 PERBAIKAN 1: Ambil socket langsung dari global.activeSockets
    const socket = getSocketByTenant(targetTenantId);

    // 1. JALUR UTAMA (RAM): Cek apakah socket aktif & user sudah terautentikasi
    if (socket && socket.user) {
      const rawId = socket.user.id || "";
      // const botNumber = rawId.split(":").replace(/[^0-9]/g, "");
      const botNumber = rawId.split(":")[0].replace(/[^0-9]/g, "");

      return res.status(200).json({
        success: true,
        status: "ONLINE", // Frontend membaca ini untuk mengubah tombol jadi hijau
        tenantId: targetTenantId,
        botNumber: botNumber,
        message: `Bot WhatsApp untuk Tenant [${targetTenantId}] aktif dan siap digunakan.`,
      });
    }

    // 2. JALUR CADANGAN: Cek riwayat aslinya di PostgreSQL via botService
    const dbStatus = await checkBotConnectionStatus(targetTenantId);

    if (dbStatus && (dbStatus.status === "CONNECTED" || dbStatus.status === "ACTIVE")) {
      connectToWhatsApp(targetTenantId).catch((err) => {
        console.error(`🚨 Gagal auto-reconnect bot untuk tenant [${targetTenantId}]:`, err);
      });

      return res.status(200).json({
        success: true,
        status: "RECONNECTING",
        tenantId: targetTenantId,
        botNumber: dbStatus.phoneNumber || "Unknown",
        message: "Bot terdaftar di database, namun sedang mencoba menyambungkan ulang ke WhatsApp.",
      });
    }

    // 3. JALUR WAITING_SCAN: Sesi ada di database tapi butuh scan ulang
    if (dbStatus && dbStatus.status === "WAITING_SCAN") {
      const currentQr = global.lastTenantQr ? global.lastTenantQr[targetTenantId] : null;

      return res.status(200).json({
        success: true,
        status: "WAITING_SCAN",
        tenantId: targetTenantId,
        qrCode: currentQr,
        message: "Sesi bot ditemukan, silakan lakukan pemindaian QR Code pada aplikasi.",
      });
    }

    // 4. JALUR OFFLINE: Tenant baru atau sesi 401 habis dihapus bersih
    const currentQr = global.lastTenantQr ? global.lastTenantQr[targetTenantId] : null;

    connectToWhatsApp(targetTenantId).catch((err) => {
      console.error(`🚨 Gagal menginisialisasi awal soket untuk tenant ${targetTenantId}:`, err);
    });

    return res.status(200).json({
      success: true,
      status: "WAITING_SCAN",
      tenantId: targetTenantId,
      qrCode: currentQr,
      message: "Mesin bot baru saja diaktifkan. Silakan hit kembali dalam beberapa detik jika QR belum muncul.",
    });
  } catch (error) {
    console.error("🚨 Gagal memeriksa status bot tenant berdasarkan hak akses:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan internal saat memeriksa status koneksi bot.",
    });
  }
}

/**
 * 3. REST API: Memutuskan Koneksi (Logout) Bot WhatsApp Klien secara Paksa
 */
async function disconnectBot(req, res) {
  // Mengambil tenantId dari query params (?tenantId=...), body, atau fallback ke req.user
  const tenantId = req.query?.tenantId || req.body?.tenantId || req.user?.tenantId;

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: "⚠️ Identifikasi Tenant ID tidak ditemukan.",
    });
  }

  try {
    // 1. Cek apakah tenant ada di database
    const tenantData = await prisma.tenant.findUnique({
      where: { tenantId },
      select: { businessName: true },
    });

    if (!tenantData) {
      return res.status(404).json({
        success: false,
        message: "⚠️ Data Tenant tidak ditemukan di database.",
      });
    }

    const namaBisnis = tenantData.businessName;
    const socket = getSocketByTenant(tenantId);

    // 2. Putuskan socket Baileys aktif di RAM & lepas semua listener-nya
    if (socket) {
      console.log(`🔌 Memutuskan koneksi bot untuk Tenant: [${namaBisnis}] (${tenantId})...`);
      try {
        await socket.logout();
      } catch (err) {
        console.log(`ℹ️ Logout Baileys selesai/ditutup paksa untuk [${namaBisnis}]:`, err.message);
      } finally {
        // Wajib lepas listener agar Baileys tidak menulis ulang creds ke DB saat tertutup
        if (socket.ev) {
          socket.ev.removeAllListeners();
        }
        try {
          socket.end(undefined);
        } catch (_) {}
      }
    }

    // 3. Bersihkan referensi socket & QR dari memori global
    if (global.activeSockets && global.activeSockets[tenantId]) {
      delete global.activeSockets[tenantId];
    }
    if (global.lastTenantQr && global.lastTenantQr[tenantId]) {
      delete global.lastTenantQr[tenantId];
    }

    // 4. Hapus SELURUH baris milik tenantId di tabel whatsapp_auths & reset waNumber di tenants
    await prisma.$transaction([
      prisma.whatsappAuth.deleteMany({
        where: { tenantId },
      }),
      prisma.tenant.update({
        where: { tenantId },
        data: { waNumber: "PENDING" },
      }),
    ]);

    // 5. Kirim event real-time ke frontend via Socket.io
    if (global.io) {
      global.io.to(tenantId).emit("wa-status-changed", {
        status: "OFFLINE",
        tenantId,
      });
    }

    return res.status(200).json({
      success: true,
      status: "OFFLINE",
      tenantId,
      message: `🎉 Sukses! Sesi WhatsApp untuk [${namaBisnis}] telah berhasil diputuskan dan dibersihkan total dari database.`,
    });
  } catch (error) {
    console.error("🚨 Gagal memutuskan koneksi bot tenant:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan internal saat mencoba memutuskan koneksi bot.",
    });
  }
}

/**
 * METHOD: GET
 * URL: /api/bot/bot-getBotQrCode
 */
async function getBotQrCode(req, res) {
  const { tenantId } = req.user;

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: "⚠️ Identifikasi Tenant ID tidak ditemukan di dalam token JWT.",
    });
  }

  try {
    const tenantData = await prisma.tenant.findUnique({
      where: { tenantId: tenantId },
      select: { businessName: true },
    });
    const namaBisnis = tenantData?.businessName || "Bisnis Anda";

    // 🌟 PERBAIKAN 3: Gunakan tenantId (bukan targetTenantId)
    const socket = getSocketByTenant(tenantId);

    // 2. KONDISI A: Jika bot terdeteksi ONLINE di RAM & sudah terverifikasi login oleh WhatsApp
    if (socket && socket.user?.id) {
      return res.status(200).json({
        success: true,
        status: "ONLINE",
        tenantId: tenantId,
        tenantName: namaBisnis,
        message: `Bot WhatsApp untuk [${namaBisnis}] sudah dalam keadaan aktif terhubung.`,
      });
    }

    // 3. KONDISI B: Jika belum ada socket berjalan, bangunkan mesin Baileys di background
    if (!socket) {
      console.log(`ℹ️ [REST API] Membangunkan mesin Baileys berbasis Database untuk Tenant Baru: [${namaBisnis}]`);
      connectToWhatsApp(tenantId);
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }

    // 4. AMBIL STRING QR DARI CACHE GLOBAL MEMORY
    const currentRawQr = global.lastTenantQr && global.lastTenantQr[tenantId] ? global.lastTenantQr[tenantId] : null;

    // 5. KONDISI C: Jika mesin sudah jalan tapi string QR belum keluar
    if (!currentRawQr) {
      return res.status(200).json({
        success: true,
        status: "OFFLINE_INITIALIZING",
        tenantId: tenantId,
        tenantName: namaBisnis,
        message: "Mesin bot telah menyala. QR Code sedang dipersiapkan oleh server WhatsApp. Silakan hit kembali dalam 3 detik.",
      });
    }

    // 6. KONDISI D: QR CODE SUKSES DITEMUKAN (60 DETIK)
    const durationSeconds = 60;
    const expiredAt = Date.now() + durationSeconds * 1000;

    return res.status(200).json({
      success: true,
      status: "QR_READY",
      tenantId: tenantId,
      tenantName: namaBisnis,
      qrCodeString: currentRawQr,
      validDurationSeconds: durationSeconds,
      expiredAt: expiredAt,
      message: `Silakan pindai QR Code untuk [${namaBisnis}]. QR ini akan kedaluwarsa dalam 60 detik.`,
    });
  } catch (error) {
    console.error("🚨 Gagal mengambil data QR Code via REST API:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan internal pada server saat memuat QR Code bot.",
    });
  }
}


async function getBotConfiguration(req, res) {
  const { tenantId } = req.user; // Diambil aman dari token JWT login klien

  try {
    // Panggil fungsi penelusuran struktur menu dari service terpisah
    const botConfigData = await fetchBotMenuConfiguration(tenantId);

    // Kembalikan data lengkap yang sudah divalidasi langsung ke Flutter
    return res.status(200).json({
      success: true,
      data: botConfigData,
    });
  } catch (error) {
    console.error("🚨 Gagal mengambil data konfigurasi dashboard bot:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan internal saat memuat struktur menu bot.",
    });
  }
}

/**
 * REST API: Mengambil Daftar Grup WhatsApp yang Diikuti Bot
 */
async function getWhatsAppGroups(req, res) {
  // Ambil tenantId dari params (:tenantId), query, atau token JWT
  const targetTenantId = req.params.tenantId || req.query.tenantId || req.user?.tenantId;

  if (!targetTenantId) {
    return res.status(400).json({
      success: false,
      message: "⚠️ Identifikasi Tenant ID tidak ditemukan.",
    });
  }

  try {
    // Ambil socket aktif dari RAM menggunakan helper yang sudah kamu buat
    const socket = getSocketByTenant(targetTenantId);

    // ✅ Kembalikan status 200 dengan array kosong agar console browser bersih saat bot offline
    if (!socket || !socket.user) {
      return res.status(200).json({
        success: true,
        connected: false,
        data: [],
        message: "Bot WhatsApp belum terhubung (OFFLINE).",
      });
    }

    // Tarik seluruh grup yang diikuti nomor bot via Baileys
    const groupsData = await socket.groupFetchAllParticipating();

    // Ubah format objek Baileys menjadi array yang rapi untuk dropdown frontend
    const groupList = Object.values(groupsData)
      .map((group) => ({
        id: group.id,       // Format: "120363048291029384@g.us"
        name: group.subject // Nama grup WhatsApp
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Urutkan A-Z

    return res.status(200).json({
      success: true,
      connected: true,
      data: groupList,
    });
  } catch (error) {
    console.error(`🚨 Gagal mengambil daftar grup WA untuk tenant [${targetTenantId}]:`, error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan internal saat mengambil daftar grup dari WhatsApp.",
    });
  }
}


module.exports = {
  checkBotStatus,
  disconnectBot,
  getBotQrCode,
  getWhatsAppGroups, // <-- Wajib ada di sini
};

// module.exports = { getWhatsAppGroups };
