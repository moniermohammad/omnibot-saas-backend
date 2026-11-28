// src/controllers/salesController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { SAAS_PLANS } = require('../config/saasPlans');

/**
 * Controller untuk menambahkan Anggota Sales baru oleh Owner/Admin
 */
async function addSalesByOwner(req, res) {
  try {
    const { name, phoneNumber } = req.body;
    const ownerTenantId = req.user?.tenantId;
    const ownerRole = req.user?.role?.toUpperCase();

    // 1. Validasi sesi & hak akses
    if (!ownerTenantId) {
      return res.status(401).json({
        success: false,
        message: "Sesi tidak valid. Silakan login ulang.",
      });
    }

    if (ownerRole !== "OWNER" && ownerRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Akses ditolak. Hanya Owner atau Admin yang dapat menambah anggota sales.",
      });
    }

    // 2. Validasi & normalisasi nomor WhatsApp (08xxx -> 628xxx)
    const rawPhone = String(phoneNumber || "").replace(/[^0-9]/g, "");
    const cleanPhoneNumber = rawPhone.startsWith("0")
      ? "62" + rawPhone.slice(1)
      : rawPhone;

    if (!name || !name.trim() || cleanPhoneNumber.length < 9) {
      return res.status(400).json({
        success: false,
        message: "Nama lengkap dan nomor WhatsApp aktif sales wajib diisi dengan benar.",
      });
    }

    // 3. Cek apakah nomor WhatsApp sudah terdaftar di sistem (sebagai Owner maupun Sales lain)
    const existingUser = await prisma.user.findUnique({
      where: { phoneNumber: cleanPhoneNumber },
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: `Nomor WhatsApp ${cleanPhoneNumber} sudah terdaftar di sistem. Gunakan nomor lain.`,
      });
    }

    // 4. Cek batas kuota dinamis (maxSales) milik tenant dari database
    const tenantData = await prisma.tenant.findUnique({
      where: { tenantId: ownerTenantId },
      select: { maxSales: true, status: true, businessName: true },
    });

    const maxAllowedSales = tenantData?.maxSales || 2;

    const currentActiveSalesCount = await prisma.user.count({
      where: {
        tenantId: ownerTenantId,
        role: "SALES",
        isActive: true,
      },
    });

    if (currentActiveSalesCount >= maxAllowedSales) {
      return res.status(403).json({
        success: false,
        message: `🚫 Kuota Penuh (${currentActiveSalesCount}/${maxAllowedSales} Sales)! Silakan tambah kuota akun sales di menu Kelola Paket.`,
      });
    }

    // 5. Simpan akun sales baru ke PostgreSQL
    const newSales = await prisma.user.create({
      data: {
        tenantId: ownerTenantId,
        name: name.trim(),
        phoneNumber: cleanPhoneNumber,
        role: "SALES",
        isActive: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: `🎉 Sales "${newSales.name}" berhasil didaftarkan ke dalam tim Anda.`,
      data: newSales,
    });
  } catch (error) {
    console.error("🚨 Gagal menyimpan sales baru:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan internal pada server.",
    });
  }
}
/**
 * Controller untuk mengambil daftar nama sales khusus di tenant ini (Untuk Dropdown Frontend)
 */
// src/controllers/salesController.js

// async function getTenantSalesList(req, res) {
//   try {
//     // Pastikan req.user.tenantId di bawah ini berhasil diekstrak dari JWT Token terbaru Anda
//     const currentTenantId = req.user?.tenantId; 

//     const salesMembers = await prisma.user.findMany({
//       where: {
//         tenantId: currentTenantId,
//         role: "SALES",
//         isActive: true // 🌟 PASTIKAN HURUF KAPITAL SEMUA (S-A-L-E-S)
//         // isActive
//       },
//       select: {
//         userId: true,
//         name: true,
//         phoneNumber: true
//       },
//       orderBy: {
//         name: 'asc'
//       }
//     });

//     return res.status(200).json({
//       success: true,
//       data: salesMembers
//     });
//   } catch (error) {
//     console.error("Error fetching sales list:", error);
//     return res.status(500).json({ success: false, message: "Gagal memuat daftar sales." });
//   }
// }

async function getTenantSalesList(req, res) {
  try {
    const { tenantId } = req.user;
    const includeInactive = req.query.includeInactive === "true";

    const [tenant, salesList] = await Promise.all([
      prisma.tenant.findUnique({
        where: { tenantId },
        select: { maxSales: true },
      }),
      prisma.user.findMany({
        where: {
          tenantId,
          role: "SALES",
          ...(includeInactive ? {} : { isActive: true }),
        },
        select: {
          userId: true,
          name: true,
          phoneNumber: true,
          isActive: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return res.status(200).json({
      success: true,
      maxSales: tenant?.maxSales ?? 1,
      data: salesList,
    });
  } catch (error) {
    console.error("Gagal memuat daftar sales:", error);
    return res.status(500).json({ success: false, message: "Gagal memuat daftar tim sales." });
  }
}

async function toggleSalesStatus(req, res) {
  try {
    const { tenantId } = req.user;
    const { userId } = req.params;

    const [tenant, targetUser, activeCount] = await Promise.all([
      prisma.tenant.findUnique({
        where: { tenantId },
        select: { maxSales: true },
      }),
      prisma.user.findFirst({
        where: { userId, tenantId, role: "SALES" },
      }),
      prisma.user.count({
        where: { tenantId, role: "SALES", isActive: true },
      }),
    ]);

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "Agen sales tidak ditemukan." });
    }

    const nextStatus = !targetUser.isActive;
    const maxSales = tenant?.maxSales ?? 1;

    if (nextStatus && activeCount >= maxSales) {
      return res.status(400).json({
        success: false,
        message: `Kuota paket Anda maksimal ${maxSales} Sales aktif. Nonaktifkan salah satu sales terlebih dahulu sebelum mengaktifkan ${targetUser.name}.`,
      });
    }

    await prisma.user.update({
      where: { userId },
      data: { isActive: nextStatus },
    });

    return res.status(200).json({
      success: true,
      message: `${targetUser.name} sekarang ${nextStatus ? "AKTIF" : "NONAKTIF"}.`,
    });
  } catch (error) {
    console.error("Gagal mengubah status sales:", error);
    return res.status(500).json({ success: false, message: "Gagal mengubah status agen sales." });
  }
}


/**
 * Controller untuk menghapus anggota sales berdasarkan userId
 */
async function deleteSales(req, res) {
  try {
    const { id } = req.params; // Mengambil userId dari URL parameter
    const ownerTenantId = req.user?.tenantId;
    const ownerRole = req.user?.role?.toUpperCase();

    // 🔒 Proteksi Hak Akses: Hanya OWNER atau ADMIN yang boleh menghapus tim
    if (ownerRole !== "OWNER" && ownerRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "⛔ Akses ditolak. Hanya Owner atau Admin yang dapat menghapus sales."
      });
    }

    // 🛡️ Pastikan sales yang dihapus berada di bawah perusahaan (tenantId) Owner yang sama
    const salesData = await prisma.user.findUnique({
      where: { userId: id }
    });

    if (!salesData || salesData.tenantId !== ownerTenantId) {
      return res.status(404).json({
        success: false,
        message: "❌ Data sales tidak ditemukan atau tidak berada di perusahaan Anda."
      });
    }

    // Eksekusi penghapusan di database PostgreSQL via Prisma
    await prisma.user.delete({
      where: { userId: id }
    });

    return res.status(200).json({
      success: true,
      message: `🎉 Akun sales bernama "${salesData.name}" sukses dihapus.`
    });

  } catch (error) {
    console.error("🚨 Gagal menghapus sales:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi gangguan internal pada server saat mencoba menghapus data sales."
    });
  }
}

// Tambahkan ke module.exports di baris paling bawah file Anda
module.exports = { 
  addSalesByOwner, 
  getTenantSalesList,
  deleteSales, // 🌟 Daftarkan fungsi baru di sini
  toggleSalesStatus
};
