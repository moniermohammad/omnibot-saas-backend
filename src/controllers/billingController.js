const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
// const { getSocketByTenant, connectToWhatsApp } = require('../services/NAMA_FILE_ASLI_ANDA');
// const { activeSockets: memorySockets } = require("../../botMemory");
// const fs = require("fs");
// const path = require("path");

const { activeSockets: memorySockets } = require("../../botMemory");


// 1. Mengambil pengaturan harga & daftar durasi paket
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


// 6. (Untuk Panel Super Admin) Mengambil ringkasan Tenant/Admin/Sales & status koneksi WA
async function getTenantWaMonitor(req, res) {
  try {
    const tenants = await prisma.tenant.findMany({
      where: {
        NOT: [
          { waNumber: "MASTER_SYSTEM" },
          { businessName: { contains: "MASTER", mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        users: {
          where: { isActive: true },
          select: {
            userId: true,
            name: true,
            phoneNumber: true,
            role: true,
          },
        },
        whatsappAuths: {
          where: { key: "creds" },
          select: { authId: true },
          take: 1,
        },
        transactions: {
          where: { status: "PAID" },
          orderBy: { paidAt: "desc" },
          select: {
            orderId: true,
            salesQuota: true,
            months: true,
            amount: true,
            paidAt: true,
          },
        },
      },
    });

    let totalAdmins = 0;
    let totalSales = 0;
    const now = new Date();

    const data = tenants.map((t) => {
      const admins = t.users.filter(
        (u) => u.role === "OWNER" || u.role === "ADMIN"
      );
      const sales = t.users.filter((u) => u.role === "SALES");

      totalAdmins += admins.length;
      totalSales += sales.length;

      const ownerUser = admins[0] || t.users[0] || null;
      const ownerPhone = ownerUser?.phoneNumber || null;

      // Hitung sisa hari sewa & cek apakah sudah expired
      const subEnd = new Date(t.subscriptionEnd);
      const diffMs = subEnd.getTime() - now.getTime();
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const effectiveStatus =
        daysLeft <= 0 && t.status !== "SUSPENDED" ? "EXPIRED" : t.status;

      // Hitung total nilai sewa yang sudah dibayarkan tenant ini
      const totalPaidAmount = t.transactions.reduce(
        (sum, trx) => sum + Number(trx.amount || 0),
        0
      );

      // ✅ Cek langsung ke socket Baileys aktif menggunakan getSocketByTenant
           // ✅ Ambil socket aktif langsung dari memorySockets (botMemory.js)
      const socket =
        memorySockets instanceof Map
          ? memorySockets.get(t.tenantId)
          : memorySockets?.[t.tenantId];

      const isOnline = Boolean(
        socket && (socket.user?.id || socket.ws?.readyState === 1)
      );

      const hasScannedBefore =
        t.whatsappAuths.length > 0 || (t.waNumber && t.waNumber !== "PENDING");

      let waStatus = "UNSCANNED";
      if (isOnline) {
        waStatus = "CONNECTED";
      } else if (hasScannedBefore) {
        waStatus = "DISCONNECTED";
      }


      return {
        id: t.tenantId,
        tenantCode: t.tenantCode,
        businessName: t.businessName,
        ownerName: ownerUser?.name || "Owner",
        waNumber: ownerPhone,
        botNumber: t.waNumber !== "PENDING" ? t.waNumber : null,
        waStatus,
        lastActivityAt: t.subscriptionStart,
        adminCount: admins.length,
        salesCount: sales.length,
        subscriptionStatus: effectiveStatus,
        maxSales: t.maxSales,
        subscriptionStart: t.subscriptionStart,
        subscriptionEnd: t.subscriptionEnd,
        daysLeft,
        paidCount: t.transactions.length,
        totalPaidAmount,
        paidHistory: t.transactions,
      };
    });

    return res.status(200).json({
      success: true,
      summary: {
        totalTenants: tenants.length,
        totalAdmins,
        totalSales,
      },
      data,
    });
  } catch (error) {
    console.error("🚨 Gagal memuat monitor tenant WA:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal memuat data monitor tenant.",
    });
  }
}


// 7. (Untuk Panel Super Admin) Paksa Reconnect Sesi WhatsApp Tenant
async function forceReconnectTenant(req, res) {
  try {
    const { tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { tenantId },
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant tidak ditemukan.",
      });
    }

    // Panggil fungsi restart/reconnect bot WA di service Anda
    // Contoh: await whatsappService.connectToWhatsApp(tenantId);
    if (typeof global.restartTenantBot === "function") {
      await global.restartTenantBot(tenantId);
    }

    return res.status(200).json({
      success: true,
      message: `Perintah reconnect untuk ${tenant.businessName} berhasil dijalankan.`,
    });
  } catch (error) {
    console.error("🚨 Gagal melakukan force reconnect:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal melakukan reconnect perangkat tenant.",
    });
  }
}

// 8. Putuskan Koneksi WA Total & Suspend Tenant (Mengikuti pola bersih disconnectBot)
async function suspendTenant(req, res) {
  try {
    const { tenantId } = req.params;

    const tenantData = await prisma.tenant.findUnique({
      where: { tenantId },
      select: { businessName: true },
    });

    if (!tenantData) {
      return res.status(404).json({
        success: false,
        message: "⚠️ Data Tenant tidak ditemukan.",
      });
    }

    const namaBisnis = tenantData.businessName;
    const socket =
      memorySockets instanceof Map
        ? memorySockets.get(tenantId)
        : memorySockets?.[tenantId] || global.activeSockets?.[tenantId];

    // 1. Putuskan socket Baileys aktif & lepas semua listener agar tidak menulis ulang creds/auto-reconnect
    if (socket) {
      console.log(`⛔ [Super Admin] Memutuskan & menangguhkan Tenant: [${namaBisnis}] (${tenantId})...`);
      try {
        await socket.logout();
      } catch (err) {
        console.log(`ℹ️ Logout Baileys ditutup paksa untuk [${namaBisnis}]:`, err.message);
      } finally {
        if (socket.ev) {
          socket.ev.removeAllListeners();
        }
        try {
          socket.end(undefined);
        } catch (_) {}
      }
    }

    // 2. Bersihkan referensi socket & QR dari memori global
    if (memorySockets instanceof Map) {
      memorySockets.delete(tenantId);
    } else if (memorySockets?.[tenantId]) {
      delete memorySockets[tenantId];
    }
    if (global.activeSockets?.[tenantId]) {
      delete global.activeSockets[tenantId];
    }
    if (global.lastTenantQr?.[tenantId]) {
      delete global.lastTenantQr[tenantId];
    }

    // 3. Hapus seluruh creds di whatsapp_auths, reset waNumber, dan ubah status menjadi SUSPENDED
    await prisma.$transaction([
      prisma.whatsappAuth.deleteMany({
        where: { tenantId },
      }),
      prisma.tenant.update({
        where: { tenantId },
        data: {
          status: "SUSPENDED",
          waNumber: "PENDING",
        },
      }),
    ]);

    // 4. Kirim event real-time ke dashboard tenant jika sedang terbuka
    if (global.io) {
      global.io.to(tenantId).emit("wa-status-changed", {
        status: "OFFLINE",
        tenantId,
      });
    }

    return res.status(200).json({
      success: true,
      message: `⛔ Layanan & koneksi WA untuk [${namaBisnis}] telah diputuskan total (SUSPENDED).`,
    });
  } catch (error) {
    console.error("🚨 Gagal memutuskan layanan tenant:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Gagal memutuskan layanan tenant.",
    });
  }
}





module.exports = {
  getBillingPlans,
  createCheckoutTransaction,
  approveTransaction,
  getAllTransactions,
  rejectTransaction,
  getTenantWaMonitor,
  forceReconnectTenant,
  suspendTenant
};
