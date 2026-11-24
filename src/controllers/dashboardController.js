// src/controllers/dashboardController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Controller utama untuk mengumpulkan semua metrik data ringkasan dasbor overview
 */
async function getDashboardOverviewData(req, res) {
  try {
    // 1. Ambil tenantId dan activeSockets RAM dari request
    const currentTenantId = req.user?.tenantId;
    const safeActiveSockets = global.activeSockets || {};

    if (!currentTenantId) {
      return res.status(401).json({
        success: false,
        message: "🚨 Sesi tidak valid atau tenant ID tidak teridentifikasi."
      });
    }

    // 2. QUERY 1: Ambil data Tenant untuk menghitung sisa masa aktif langganan SaaS
    const tenantInfo = await prisma.tenant.findUnique({
      where: { tenantId: currentTenantId },
      select: {
        status: true,
        tenantCode: true, // <-- Tambahkan ini
        subscriptionEnd: true,
        businessName: true,
      }
    });

    if (!tenantInfo) {
      return res.status(404).json({
        success: false,
        message: "❌ Profil bisnis perusahaan (Tenant) tidak terdaftar di sistem."
      });
    }

    // Perhitungan sisa hari murni kalender (Bebas Bug Jam/Timezone)
    const now = new Date();
    const expiryDate = new Date(tenantInfo.subscriptionEnd);

    const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const end = Date.UTC(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());

    const timeDiff = end - start;
    let daysLeft = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) daysLeft = 0;

    // 3. LOGIKA SOCKET RAM: Cek status WhatsApp milik tenant
    const socket = safeActiveSockets[currentTenantId] || null;
    let waStatus = "OFFLINE";
    let botNumber = "Unknown";

    if (socket && socket.user && socket.user.id) {
      waStatus = "ONLINE";
      botNumber = socket.user.id.split(":")[0];
    } else {
      const dbBot = await prisma.whatsappAuth.findFirst({
        where: { tenantId: currentTenantId }
      });

      if (dbBot) {
        if (dbBot.status === "CONNECTED") waStatus = "RECONNECTING";
        else if (dbBot.status === "WAITING_SCAN") waStatus = "WAITING_SCAN";
        botNumber = dbBot.phoneNumber || "Unknown";
      }
    }

    // 4. QUERY PARALEL: Hitung metrik KPI, 5 Prospek Terbaru, dan Performa Tim Sales
    const [
      chatbotCount,
      leadsCount,
      assignedLeadsCount,
      activeSalesCount,
      recentLeads,
      salesTeam
    ] = await Promise.all([
      prisma.aiBotSubject.count({
        where: { botConfig: { tenantId: currentTenantId } }
      }),
      prisma.lead.count({
        where: { tenantId: currentTenantId }
      }),
      prisma.lead.count({
        where: { tenantId: currentTenantId, status: "ASSIGNED" }
      }),
      prisma.user.count({
        where: { tenantId: currentTenantId, role: "SALES" }
      }),
      prisma.lead.findMany({
        where: { tenantId: currentTenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          sales: { select: { name: true } }
        }
      }),
      prisma.user.findMany({
        where: { tenantId: currentTenantId, role: "SALES" },
        select: {
          userId: true,
          name: true,
          _count: { select: { leads: true } }
        },
        orderBy: {
          leads: { _count: "desc" }
        }
      })
    ]);

    // Hitung rasio konversi prospek yang selesai diteruskan ke sales (%)
    const conversionRate =
      leadsCount > 0 ? Math.round((assignedLeadsCount / leadsCount) * 100) : 0;

    // 5. RETURN RESPONS TERPUSAT
    return res.status(200).json({
      success: true,
      tenant: {
        businessName: tenantInfo.businessName,
        tenantCode: tenantInfo.tenantCode,
        status: daysLeft > 0 || tenantInfo.status === "ACTIVE" ? tenantInfo.status : "EXPIRED",
        daysLeft: daysLeft
      },
      whatsapp: {
        status: waStatus,
        botNumber: botNumber
      },
      metrics: {
        totalChatbots: chatbotCount,
        totalLeads: leadsCount,
        activeSalesCount: activeSalesCount,
        conversionRate: conversionRate
      },
      recentLeads: recentLeads,
      salesPerformance: salesTeam.map((s) => ({
        id: s.userId,
        name: s.name,
        leadsCount: s._count.leads
      }))
    });

  } catch (error) {
    console.error("🚨 Gagal menghimpun data ringkasan dasbor terpusat:", error);
    return res.status(500).json({
      success: false,
      message: "🚨 Terjadi kendala internal server saat memuat data dasbor."
    });
  }
}

module.exports = {
  getDashboardOverviewData
};


// // src/controllers/dashboardController.js
// const { PrismaClient } = require('@prisma/client');
// const prisma = new PrismaClient();

// /**
//  * Controller utama untuk mengumpulkan semua metrik data ringkasan dasbor overview
//  */
// async function getDashboardOverviewData(req, res) {
//   try {
//     // 1. Ambil tenantId dan activeSockets RAM dari request (Dipasok oleh middleware auth & WhatsApp engine Anda)
//     const currentTenantId = req.user?.tenantId;
//     const safeActiveSockets = global.activeSockets || {}; // Mengakses RAM socket Baileys jika didefinisikan global

//     if (!currentTenantId) {
//       return res.status(401).json({
//         success: false,
//         message: "🚨 Sesi tidak valid atau tenant ID tidak teridentifikasi."
//       });
//     }

//     // 2. QUERY 1: Ambil data Tenant untuk menghitung sisa masa aktif langganan SaaS
//     const tenantInfo = await prisma.tenant.findUnique({
//       where: { tenantId: currentTenantId },
//       select: {
//         status: true,
//         subscriptionEnd: true,
//         businessName: true
//       }
//     });

//     if (!tenantInfo) {
//       return res.status(404).json({
//         success: false,
//         message: "❌ Profil bisnis perusahaan (Tenant) tidak terdaftar di sistem."
//       });
//     }

//     // 🌟 PERBAIKAN MUTLAK: Perhitungan sisa hari murni kalender (Bebas Bug Jam/Timezone)
//     const now = new Date();
//     const expiryDate = new Date(tenantInfo.subscriptionEnd);

//     // Set kedua tanggal ke jam 00:00:00 UTC agar selisihnya murni hitungan hari kalender
//     const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
//     const end = Date.UTC(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());

//     const timeDiff = end - start;
//     let daysLeft = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    
//     if (daysLeft < 0) daysLeft = 0; // Kunci di angka 0 jika sudah kedaluwarsa

//     // 3. LOGIKA SOCKET RAM: Cek status WhatsApp seperti pada fungsi checkBotStatus Anda sebelumnya
//     const socket = safeActiveSockets[currentTenantId] || null;
//     let waStatus = "OFFLINE";
//     let botNumber = "Unknown";

//     if (socket && socket.user && socket.user.id) {
//       waStatus = "ONLINE";
//       botNumber = socket.user.id.split(":")[0];
//     } else {
//       // Jalur cadangan: Jika di RAM tidak ada, periksa status historis terakhir di DB
//       const dbBot = await prisma.whatsappAuth.findFirst({
//         where: { tenantId: currentTenantId }
//       });
      
//       if (dbBot) {
//         if (dbBot.status === "CONNECTED") waStatus = "RECONNECTING";
//         else if (dbBot.status === "WAITING_SCAN") waStatus = "WAITING_SCAN";
//         botNumber = dbBot.phoneNumber || "Unknown";
//       }
//     }

//     // 4. QUERY 2: Hitung total engine chatbot yang terdaftar di tenant ini
//     const chatbotCount = await prisma.aiBotConfig.count({
//       where: { tenantId: currentTenantId }
//     });

//     // 5. QUERY 3: Hitung total Leads CRM yang masuk ke dalam tenant ini
//     const leadsCount = await prisma.lead.count({
//       where: { tenantId: currentTenantId }
//     });

//     // 6. RETURN RESPONS TERPUSAT: Kirim seluruh metrik agregasi dalam 1 paket data JSON
//     return res.status(200).json({
//       success: true,
//       tenant: {
//         businessName: tenantInfo.businessName,
//         // 🌟 KUNCI SYNC: Jika sisa hari tersedia ATAU status DB adalah ACTIVE, maka kirim ACTIVE ke UI!
//         status: daysLeft > 0 || tenantInfo.status === "ACTIVE" ? tenantInfo.status : "EXPIRED",
//         daysLeft: daysLeft
//       },
//       whatsapp: {
//         status: waStatus,
//         botNumber: botNumber
//       },
//       metrics: {
//         totalChatbots: chatbotCount,
//         totalLeads: leadsCount
//       }
//     });

//   } catch (error) {
//     console.error("🚨 Gagal menghimpun data ringkasan dasbor terpusat:", error);
//     return res.status(500).json({
//       success: false,
//       message: "🚨 Terjadi kendala internal server saat memuat data dasbor."
//     });
//   }
// }

// module.exports = {
//   getDashboardOverviewData
// };
