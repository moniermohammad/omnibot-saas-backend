const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. Mengambil pengaturan harga & daftar durasi paket
// async function getBillingPlans(req, res) {
//   try {
//     const tenantId = req.user?.tenantId;

//     const [setting, plans, pendingTransaction] = await Promise.all([
//       prisma.billingSetting.findUnique({ where: { settingId: "DEFAULT_BILLING" } }),
//       prisma.subscriptionPlan.findMany({
//         where: { isActive: true },
//         orderBy: { sortOrder: "asc" },
//       }),
//       tenantId
//         ? prisma.paymentTransaction.findFirst({
//             where: { tenantId, status: "PENDING" },
//             orderBy: { createdAt: "desc" },
//           })
//         : null,
//     ]);

//     return res.status(200).json({
//       success: true,
//       pendingTransaction, // <-- Dikirim langsung ke BillingModal
//       setting: setting || {
//         pricePerSales: 75000,
//         bankName: "BCA a.n. Mohammad Munir",
//         bankAccount: "8820941765",
//         qrisImageUrl: "/qris-pembayaran.png",
//         adminWaNumber: "628558836680",
//       },
//       plans:
//         plans.length > 0
//           ? plans
//           : [
//               { planId: "1M", name: "1 Bulan", months: 1, discount: 0, badge: null },
//               { planId: "3M", name: "3 Bulan", months: 3, discount: 0.1, badge: "HEMAT 10%" },
//               { planId: "1Y", name: "1 Tahun", months: 12, discount: 0.2, badge: "HEMAT 20%" },
//             ],
//     });
//   } catch (error) {
//     console.error("🚨 Gagal memuat paket billing:", error);
//     return res.status(500).json({ success: false, message: "Gagal memuat data paket." });
//   }
// }

async function getBillingPlans(req, res) {
  try {
    const tenantId = req.user?.tenantId;

    const [setting, plans, pendingTransaction, activeSalesCount, tenantInfo] =
      await Promise.all([
        prisma.billingSetting.findUnique({ where: { settingId: "DEFAULT_BILLING" } }),
        prisma.subscriptionPlan.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        }),
        tenantId
          ? prisma.paymentTransaction.findFirst({
              where: { tenantId, status: "PENDING" },
              orderBy: { createdAt: "desc" },
            })
          : null,
        // ✅ Hitung jumlah akun SALES yang aktif secara real-time di database
        tenantId
          ? prisma.user.count({
              where: {
                tenantId,
                role: "SALES",
                isActive: true,
              },
            })
          : 0,
        // ✅ Ambil tenantCode & businessName terbaru agar tidak kosong saat konfirmasi WA
        tenantId
          ? prisma.tenant.findUnique({
              where: { tenantId },
              select: {
                tenantId: true,
                tenantCode: true,
                businessName: true,
                maxSales: true,
              },
            })
          : null,
      ]);

    return res.status(200).json({
      success: true,
      pendingTransaction,
      activeSalesCount, // <-- Dikirim ke BillingModal agar angka "Sales aktif saat ini" akurat
      tenant: tenantInfo, // <-- Memastikan tenantCode (OB-MTR-xxxx) selalu terisi di pesan invoice WA
      setting: setting || {
        pricePerSales: 85000,
        bankName: "BCA a.n. Mohammad Munir",
        bankAccount: "8820941765",
        qrisImageUrl: "/qris-pembayaran.png",
        adminWaNumber: "628558836680",
      },
      plans:
        plans.length > 0
          ? plans
          : [
              { planId: "1M", name: "1 Bulan", months: 1, discount: 0, badge: null },
              { planId: "3M", name: "3 Bulan", months: 3, discount: 0.1, badge: "HEMAT 10%" },
              { planId: "1Y", name: "1 Tahun", months: 12, discount: 0.2, badge: "HEMAT 20%" },
            ],
    });
  } catch (error) {
    console.error("🚨 Gagal memuat paket billing:", error);
    return res.status(500).json({ success: false, message: "Gagal memuat data paket." });
  }
}


// 2. Mencatat invoice pesanan baru (Siap untuk Manual maupun Midtrans nanti)
async function createCheckoutTransaction(req, res) {
  try {
    const tenantId = req.user?.tenantId || req.body.tenantId;
    const { salesQuota, planId, paymentMethod = "MANUAL" } = req.body;

    if (!tenantId || !salesQuota || salesQuota < 1) {
      return res.status(400).json({ success: false, message: "Data pesanan tidak valid." });
    }

    // 🛑 CEK APAKAH MASIH ADA INVOICE YANG TERTUNDA (PENDING)
    const existingPending = await prisma.paymentTransaction.findFirst({
      where: {
        tenantId,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: `Anda masih memiliki pengajuan pembayaran yang tertunda (${existingPending.orderId} - Rp ${Number(
          existingPending.amount
        ).toLocaleString("id-ID")}). Harap selesaikan atau tunggu konfirmasi admin sebelum membuat pengajuan baru.`,
      });
    }

    const setting = await prisma.billingSetting.findUnique({
      where: { settingId: "DEFAULT_BILLING" },
    });

    const pricePerSales = setting?.pricePerSales || 75000;

    let months = 1;
    let discount = 0;

    const dbPlan = await prisma.subscriptionPlan.findUnique({ where: { planId } }).catch(() => null);

    if (dbPlan) {
      months = dbPlan.months;
      discount = dbPlan.discount;
    } else if (planId === "3M") {
      months = 3;
      discount = 0.1;
    } else if (planId === "1Y") {
      months = 12;
      discount = 0.2;
    }

    const rawTotal = salesQuota * pricePerSales * months;
    const amount = Math.round(rawTotal * (1 - discount));
    const orderId = `INV-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    const transaction = await prisma.paymentTransaction.create({
      data: {
        orderId,
        tenantId,
        salesQuota: Number(salesQuota),
        months,
        amount,
        paymentMethod,
        status: "PENDING",
      },
      include: {
        tenant: {
          select: {
            tenantCode: true,
            businessName: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      tenantCode: transaction.tenant?.tenantCode || null,
      transaction,
    });
  } catch (error) {
    console.error("🚨 Gagal membuat transaksi billing:", error);
    return res.status(500).json({ success: false, message: "Gagal membuat invoice pembayaran." });
  }
}

// 3. Menyetujui pembayaran & menyesuaikan kuota akun sales otomatis
async function approveTransaction(req, res) {
  try {
    const { orderId } = req.params;

    const trx = await prisma.paymentTransaction.findUnique({
      where: { orderId },
      include: { tenant: true },
    });

    if (!trx) {
      return res.status(404).json({ success: false, message: "Nomor invoice tidak ditemukan." });
    }
    if (trx.status === "PAID") {
      return res.status(400).json({ success: false, message: "Invoice ini sudah dibayar sebelumnya." });
    }

    // Hitung masa aktif baru (lanjutkan dari subscriptionEnd jika belum expired, atau dari hari ini jika sudah expired)
    const now = new Date();
    const currentEnd = new Date(trx.tenant.subscriptionEnd);
    const baseDate = currentEnd > now ? currentEnd : now;
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + trx.months * 30);

    // Ambil seluruh akun sales milik tenant urut dari yang paling pertama dibuat
    const allSales = await prisma.user.findMany({
      where: { tenantId: trx.tenantId, role: "SALES" },
      orderBy: { createdAt: "asc" },
    });

    // Jalankan pembaruan status transaksi, kuota tenant, dan status aktif/nonaktif akun sales secara atomik
    await prisma.$transaction([
      prisma.paymentTransaction.update({
        where: { orderId },
        data: { status: "PAID", paidAt: now },
      }),
      prisma.tenant.update({
        where: { tenantId: trx.tenantId },
        data: {
          status: "ACTIVE",
          maxSales: trx.salesQuota,
          subscriptionEnd: newExpiry,
        },
      }),
      ...allSales.map((sales, index) =>
        prisma.user.update({
          where: { userId: sales.userId },
          data: { isActive: index < trx.salesQuota }, // Aktif hanya sejumlah kuota yang dibeli; sisanya nonaktif sementara
        })
      ),
    ]);

    return res.status(200).json({
      success: true,
      message: `Pembayaran ${orderId} disetujui! Paket aktif hingga ${newExpiry.toLocaleDateString("id-ID")} untuk maksimal ${trx.salesQuota} Sales.`,
    });
  } catch (error) {
    console.error("🚨 Gagal menyetujui pembayaran:", error);
    return res.status(500).json({ success: false, message: "Gagal memproses persetujuan pembayaran." });
  }
}

// 4. (Untuk Panel Super Admin) Mengambil riwayat semua transaksi pembayaran
async function getAllTransactions(req, res) {
  try {
    const transactions = await prisma.paymentTransaction.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        tenant: {
          select: { businessName: true, waNumber: true },
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error("🚨 Gagal memuat riwayat transaksi:", error);
    return res.status(500).json({ success: false, message: "Gagal memuat riwayat transaksi." });
  }
}

async function rejectTransaction(req, res) {
  try {
    // Jika verifikasi adminKey dilakukan di dalam controller (bukan middleware),
    // salin baris pengecekan req.headers['x-admin-key'] dari fungsi approveTransaction Anda ke sini.
    const { orderId } = req.params;
    const { reason } = req.body;

    const trx = await prisma.paymentTransaction.findUnique({
      where: { orderId },
    });

    if (!trx) {
      return res.status(404).json({
        success: false,
        message: 'Invoice tidak ditemukan.',
      });
    }

    if (trx.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Invoice ini sudah berstatus ${trx.status}, tidak dapat ditolak.`,
      });
    }

    await prisma.paymentTransaction.update({
      where: { orderId },
      data: {
        status: 'REJECTED',
      },
    });

    return res.status(200).json({
      success: true,
      message: `Invoice ${orderId} telah ditolak${reason ? ` (${reason})` : ''}.`,
    });
  } catch (error) {
    console.error('🚨 Gagal menolak pembayaran:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan internal saat menolak pembayaran.',
    });
  }
}


module.exports = {
  getBillingPlans,
  createCheckoutTransaction,
  approveTransaction,
  getAllTransactions,
  rejectTransaction
};
