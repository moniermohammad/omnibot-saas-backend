// src/controllers/salesController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/tenant/settings — Ambil Data Tenant & Daftar User di Dalamnya
async function getTenantSettings(req, res) {
  const { userId, tenantId } = req.user;

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { tenantId },
      select: {
        tenantId: true,
        tenantCode: true,
        businessName: true,
        businessType: true,
        address: true,
        recoveryEmail: true,
        waNumber: true,
        status: true,
        tenantType: true,
        maxSales: true,
        subscriptionEnd: true,
        users: {
          select: {
            userId: true,
            name: true,
            phoneNumber: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Data bisnis tidak ditemukan.',
      });
    }

    const currentUser = tenant.users.find((u) => u.userId === userId) || null;

    return res.status(200).json({
      success: true,
      data: {
        user: currentUser,
        tenant,
      },
    });
  } catch (error) {
    console.error('🚨 Error getTenantSettings:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat data pengaturan bisnis.',
    });
  }
}

// PUT /api/tenant/update — Update Profil Bisnis, Nama Owner & Email Pemulihan
async function updateTenantProfile(req, res) {
  const { userId, tenantId, role } = req.user;
  const { businessName, businessType, address, ownerName, recoveryEmail } = req.body;

  if (role?.toUpperCase() !== 'OWNER' && role?.toUpperCase() !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: '⛔ Hanya Owner atau Admin yang dapat mengubah profil bisnis.',
    });
  }

  if (!businessName || businessName.trim().length < 3) {
    return res.status(400).json({
      success: false,
      message: '⚠️ Nama bisnis minimal harus 3 karakter.',
    });
  }

  if (!ownerName || ownerName.trim().length < 3) {
    return res.status(400).json({
      success: false,
      message: '⚠️ Nama pemilik minimal harus 3 karakter.',
    });
  }

  try {
    const cleanEmail = recoveryEmail ? recoveryEmail.trim().toLowerCase() : null;
    if (cleanEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: '⚠️ Format email pemulihan tidak valid.',
        });
      }

      // Pastikan email pemulihan belum dipakai oleh workspace tenant lain
      const existingTenant = await prisma.tenant.findFirst({
        where: { recoveryEmail: cleanEmail, NOT: { tenantId } },
      });
      if (existingTenant) {
        return res.status(400).json({
          success: false,
          message: '⚠️ Email pemulihan ini sudah terdaftar di workspace lain.',
        });
      }
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { userId },
        data: { name: ownerName.trim() },
      }),
      prisma.tenant.update({
        where: { tenantId },
        data: {
          businessName: businessName.trim(),
          businessType: businessType ? businessType.trim() : null,
          address: address ? address.trim() : null,
          recoveryEmail: cleanEmail,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: '✅ Profil bisnis & email pemulihan berhasil diperbarui!',
    });
  } catch (error) {
    console.error('🚨 Error updateTenantProfile:', error);
    return res.status(500).json({
      success: false,
      message: '🚨 Gagal menyimpan perubahan profil bisnis.',
    });
  }
}

// DELETE /api/tenant/delete — Hapus Permanen Workspace & Seluruh Data Tenant
// DELETE /api/tenant/delete — Hapus Permanen Workspace & Seluruh Data Tenant
async function deleteTenantAccount(req, res) {
  const { tenantId, role } = req.user;
  const { confirmBusinessName } = req.body;

  if (role?.toUpperCase() !== 'OWNER') {
    return res.status(403).json({
      success: false,
      message: '⛔ Hanya pemilik utama (Owner) yang dapat menghapus permanen workspace ini.',
    });
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { tenantId },
      select: { tenantId: true, businessName: true },
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Data bisnis tidak ditemukan.',
      });
    }

    if (!confirmBusinessName || confirmBusinessName.trim() !== tenant.businessName.trim()) {
      return res.status(400).json({
        success: false,
        message: `Konfirmasi gagal. Ketik "${tenant.businessName}" dengan tepat untuk menghapus permanen.`,
      });
    }

    // 1. Putuskan socket WhatsApp Baileys aktif di RAM
    const socket =
      typeof getSocketByTenant === 'function'
        ? getSocketByTenant(tenantId)
        : global.activeSockets?.[tenantId];

    if (socket) {
      try {
        await socket.logout();
      } catch (_) {}
      if (socket.ev) socket.ev.removeAllListeners();
      try {
        socket.end(undefined);
      } catch (_) {}
    }

    if (global.activeSockets?.[tenantId]) delete global.activeSockets[tenantId];
    if (global.lastTenantQr?.[tenantId]) delete global.lastTenantQr[tenantId];

    // 2. Hapus berurutan dari tabel anak terdalam agar bebas dari Foreign Key Constraint
    await prisma.$transaction([
      prisma.quotationItem.deleteMany({
        where: { quotation: { tenantId } },
      }),
      prisma.quotation.deleteMany({
        where: { tenantId },
      }),
      prisma.schedule.deleteMany({
        where: { tenantId },
      }),
      prisma.lead.deleteMany({
        where: { tenantId },
      }),
      prisma.leadQueue.deleteMany({
        where: { tenantId },
      }),
      prisma.product.deleteMany({
        where: { tenantId },
      }),
      prisma.whatsappAuth.deleteMany({
        where: { tenantId },
      }),
      prisma.paymentTransaction.deleteMany({
        where: { tenantId },
      }),
      prisma.tenant.delete({
        where: { tenantId },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: `🗑️ Seluruh data bisnis "${tenant.businessName}" beserta akun pengguna, leads, dan sesi WhatsApp telah dihapus permanen.`,
    });
  } catch (error) {
    console.error('🚨 Error deleteTenantAccount:', error);
    return res.status(500).json({
      success: false,
      message: `🚨 Gagal menghapus workspace: ${error.message}`,
    });
  }
}





module.exports = { 
  getTenantSettings, updateTenantProfile, deleteTenantAccount
};