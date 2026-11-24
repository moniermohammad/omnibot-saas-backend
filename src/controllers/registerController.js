// src/controllers/authController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { registerTenantService } = require("../services/registerService");
/**
 * Controller POST /api/auth/register
 */
const executeRegister = async (req, res) => {
  try {
    const { businessName, ownerName, ownerPhone, businessType } = req.body;

    // Panggil Service dengan Parameter Eksplisit
    const registrationResult = await registerTenantService({
      businessName,
      ownerName,
      ownerPhone,
      businessType,
    });

    return res.status(201).json({
      success: true,
      message: "🎉 Registrasi berhasil! Silakan masuk menggunakan nomor HP yang didaftarkan.",
      data: registrationResult,
    });
  } catch (error) {
    console.error("🚨 Error di Register Controller:", error);

    // Tangkap Custom Error (400, 409, dll) dari Service
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "⚠️ Terjadi kesalahan internal pada server backend.",
    });
  }
};


const renewTenantSubscription = async (req, res) => {
  try {
    const currentTenantId = req.user?.tenantId;
    const currentUserRole = req.user?.role?.toUpperCase();

    // 🔒 Proteksi Hak Akses: Hanya OWNER atau ADMIN perusahaan yang boleh memperpanjang paket
    if (currentUserRole !== "OWNER" && currentUserRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "⛔ Akses ditolak. Hanya Owner atau Admin yang dapat memperpanjang paket langganan."
      });
    }

    // Hitung tanggal 30 hari ke depan sejak hari ini (November 2026)
    const activeUntil = new Date();
    activeUntil.setDate(activeUntil.getDate() + 30);

    // Perbarui status dan masa aktif tenant di PostgreSQL via Prisma
    const updatedTenant = await prisma.tenant.update({
      where: { tenantId: currentTenantId },
      data: {
        status: "ACTIVE", // Mengubah dari FREE_TRIAL / EXPIRED menjadi ACTIVE
        subscriptionEnd: activeUntil
      }
    });

    return res.status(200).json({
      success: true,
      message: `🎉 Selamat! Langganan untuk "${updatedTenant.businessName}" berhasil diperpanjang 30 hari ke depan.`,
      data: {
        status: updatedTenant.status,
        subscriptionEnd: updatedTenant.subscriptionEnd
      }
    });
  } catch (error) {
    console.error("🚨 Gagal memperpanjang langganan tenant:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan pada server saat memproses perpanjangan paket."
    });
  }
};

module.exports = {
  executeRegister, renewTenantSubscription,
};
