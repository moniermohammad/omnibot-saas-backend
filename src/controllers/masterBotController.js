const prisma = require("../../config/prisma");
const { connectToWhatsApp } = require("../whatsapp/connection");
const { activeSockets: memorySockets } = require("../../botMemory");

function getMasterSocket() {
  const store = global.activeSockets || memorySockets || {};
  return store["MASTER_SYSTEM"] || null;
}

/**
 * METHOD: GET
 * URL: /api/superadmin/master-bot/qr
 */
async function getMasterBotQrCode(req, res) {
  const tenantId = "MASTER_SYSTEM";

  try {
    // 1. Pastikan baris MASTER_SYSTEM tersedia di tabel tenants (untuk Foreign Key WhatsappAuth)
    await prisma.tenant.upsert({
      where: { tenantId: tenantId },
      update: {},
      create: {
        tenantId: tenantId,
        businessName: "MASTER SYSTEM BOT",
        businessType: "SYSTEM_MASTER",
        status: "ACTIVE",
        tenantType: "SYSTEM",
        subscriptionEnd: new Date("2099-12-31T23:59:59.000Z"),
      },
    });

    const socket = getMasterSocket();

    // 2. Jika Master Bot sudah ONLINE (nomor apa pun yang di-scan)
    if (socket && socket.user?.id) {
      const rawId = socket.user.id || "";
      const connectedPhone = rawId.split(":")[0].replace(/[^0-9]/g, "");

      // Simpan nomor aktif yang ter-scan ke kolom waNumber di tabel tenants
      await prisma.tenant
        .update({
          where: { tenantId: tenantId },
          data: { waNumber: connectedPhone },
        })
        .catch(() => {});

      return res.status(200).json({
        success: true,
        status: "ONLINE",
        connectedPhone: connectedPhone,
        message: `Master Bot Utama (+${connectedPhone}) aktif terhubung dan siap mengirim OTP.`,
      });
    }

    // 3. Jika belum online, bangunkan mesin Baileys untuk MASTER_SYSTEM
    if (!socket) {
      console.log(
        `ℹ️ [SUPERADMIN API] Membangunkan mesin Baileys untuk Master Bot Utama...`,
      );
      connectToWhatsApp(tenantId).catch((err) => {
        console.error(`🚨 Gagal membangunkan socket Master Bot:`, err);
      });
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }

    // 4. Ambil string QR dari cache
    const currentRawQr =
      global.lastTenantQr && global.lastTenantQr[tenantId]
        ? global.lastTenantQr[tenantId]
        : null;

    if (!currentRawQr) {
      return res.status(200).json({
        success: true,
        status: "OFFLINE_INITIALIZING",
        message:
          "Mesin Master Bot sedang dipersiapkan. Silakan muat ulang dalam 3 detik.",
      });
    }

    // 5. QR Code siap di-scan
    return res.status(200).json({
      success: true,
      status: "QR_READY",
      qrCodeString: currentRawQr,
      validDurationSeconds: 60,
      expiredAt: Date.now() + 60 * 1000,
      message: "Silakan pindai QR Code menggunakan WhatsApp Master Bot Anda.",
    });
  } catch (error) {
    console.error("🚨 Gagal mengambil QR Code Master Bot:", error);
    return res.status(500).json({
      success: false,
      message:
        "🚨 Terjadi gangguan internal pada server saat memuat QR Code Master Bot.",
    });
  }
}

/**
 * METHOD: POST
 * URL: /api/superadmin/master-bot/disconnect
 */
async function disconnectMasterBot(req, res) {
  const tenantId = "MASTER_SYSTEM";

  try {
    const socket = getMasterSocket();

    if (socket) {
      try {
        await socket.logout();
      } catch (_) {}
      if (socket.ev) socket.ev.removeAllListeners();
      try {
        socket.end(undefined);
      } catch (_) {}
    }

    if (global.activeSockets && global.activeSockets[tenantId]) {
      delete global.activeSockets[tenantId];
    }
    if (global.lastTenantQr && global.lastTenantQr[tenantId]) {
      delete global.lastTenantQr[tenantId];
    }

    await prisma.$transaction([
      prisma.whatsappAuth.deleteMany({ where: { tenantId } }),
      prisma.tenant.update({
        where: { tenantId },
        data: { waNumber: "PENDING" },
      }),
    ]);

    return res.status(200).json({
      success: true,
      status: "OFFLINE",
      message:
        "🎉 Sesi Master Bot berhasil diputuskan. Siap untuk scan nomor baru.",
    });
  } catch (error) {
    console.error("🚨 Gagal memutuskan koneksi Master Bot:", error);
    return res.status(500).json({
      success: false,
      message:
        "🚨 Terjadi gangguan internal saat memutuskan koneksi Master Bot.",
    });
  }
}

module.exports = {
  getMasterBotQrCode,
  disconnectMasterBot,
};
