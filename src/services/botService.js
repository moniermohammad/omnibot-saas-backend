const prisma = require("../../config/prisma");
const { activeSockets } = require("../../botMemory"); // Pastikan path memori RAM socket Anda benar

/**
 * 1. Mengambil data sesi Baileys murni teks string dari PostgreSQL
 */
async function getAuthValue(tenantId, key) {
  try {
    const result = await prisma.whatsappAuth.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!result) return null;
    return result.value; // Mengembalikan string mentah murni ke adapter prismaAuth
  } catch (error) {
    console.error(`🚨 [Bot Service] Gagal mengambil key [${key}] untuk tenant [${tenantId}]:`, error);
    return null;
  }
}

/**
 * 2. Menyimpan atau memperbarui data sesi Baileys ke PostgreSQL
 */
async function saveAuthValue(tenantId, key, stringifiedValue) {
  try {
    await prisma.whatsappAuth.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: stringifiedValue },
      create: { tenantId, key, value: stringifiedValue },
    });
  } catch (error) {
    console.error(`🚨 [Bot Service] Gagal menyimpan key [${key}] untuk tenant [${tenantId}]:`, error);
  }
}

/**
 * 3. Menghapus data sesi Baileys dari PostgreSQL (misal saat logout)
 */
async function deleteAuthValue(tenantId, key) {
  try {
    await prisma.whatsappAuth.delete({
      where: { tenantId_key: { tenantId, key } },
    });
  } catch (_error) {
    // Diabaikan jika data memang sudah terhapus
  }
}

/**
 * 4. Mengecek Status Koneksi Bot untuk dikonsumsi API / Aplikasi Flutter
 */
// src/controllers/botConfigController.js (atau file service Anda)

async function checkBotConnectionStatus(tenantId) {
  try {
    // 1. Tarik data kredensial utama Baileys dari database postgres Anda
    const authSession = await prisma.whatsappAuth.findUnique({
      where: { 
        tenantId_key: { 
          tenantId, 
          key: "creds" 
        } 
      },
    });

    if (!authSession) {
      return { connected: false, status: "NOT_INITIALIZED", message: "Bot belum pernah di-scan QR." };
    }

    // 2. Gunakan import dinamis Baileys untuk me-revive tipe data buffer JSON
    const { BufferJSON } = await import("@whiskeysockets/baileys");
    const credsData = JSON.parse(authSession.value, BufferJSON.reviver);

    // Validasi apakah isi kredensial memiliki data profil WhatsApp yang sah
    if (credsData && credsData.me && credsData.me.id) {
      const detectedPhoneNumber = credsData.me.id.split(":")[0].replace(/[^0-9]/g, "");
      const detectedName = credsData.me.name || "WhatsApp Bot";

      // 🌟 KUNCI AMAN 1: Pastikan socket-nya juga sedang aktif hidup di dalam RAM server!
      const isLiveInRAM = activeSockets[tenantId] !== undefined;

      // 🌟 KUNCI AMAN 2: Lakukan sinkronisasi otomatis ke tabel Tenant jika waNumber masih kosong/PENDING
      try {
        const currentTenant = await prisma.tenant.findUnique({
          where: { tenantId },
          select: { waNumber: true }
        });

        if (currentTenant && (currentTenant.waNumber === "PENDING" || !currentTenant.waNumber)) {
          await prisma.tenant.update({
            where: { tenantId },
            data: { waNumber: detectedPhoneNumber }
          });
          console.log(`💾 [Auto-Sync] Kolom waNumber Tenant [${tenantId}] berhasil diisi otomatis dengan: ${detectedPhoneNumber}`);
        }
      } catch (dbErr) {
        console.error("🚨 Gagal melakukan sinkronisasi otomatis kolom waNumber:", dbErr);
      }

      // Jika ada di DB dan socket-nya aktif melayani pesan di RAM
      if (isLiveInRAM) {
        return {
          connected: true,
          status: "CONNECTED",
          phoneNumber: detectedPhoneNumber,
          name: detectedName,
          message: "Bot aktif dan terhubung (Online).",
        };
      } else {
        // Kasus: Sesi ada di DB, tapi koneksi ke WhatsApp terputus / server baru restart & belum dipicu
        return {
          connected: false,
          status: "DISCONNECTED",
          phoneNumber: detectedPhoneNumber,
          name: detectedName,
          message: "Sesi terdaftar, namun koneksi terputus. Silakan klik hubungkan kembali.",
        };
      }
    } else {
      return { connected: false, status: "WAITING_SCAN", message: "Menunggu pemindaian QR Code." };
    }
  } catch (error) {
    console.error(`🚨 [Bot Service] Gagal mengecek status bot untuk tenant [${tenantId}]:`, error);
    return { connected: false, status: "ERROR", message: "Terjadi kesalahan internal sistem." };
  }
}

// async function checkBotConnectionStatus(tenantId) {
//   try {
//     const authSession = await prisma.whatsappAuth.findUnique({
//       where: { tenantId_key: { tenantId, key: "creds" } },
//     });

//     if (!authSession) {
//       return { connected: false, status: "NOT_INITIALIZED", message: "Bot belum pernah di-scan QR." };
//     }

//     // 🌟 AMBIL AMAN DI DALAM FUNGSI: Menggunakan import dinamis agar lolos dari crash ESM
//     const { BufferJSON } = await import("@whiskeysockets/baileys");
//     const credsData = JSON.parse(authSession.value, BufferJSON.reviver);

//     if (credsData && credsData.me && credsData.me.id) {
//       return {
//         connected: true,
//         status: "CONNECTED",
//         phoneNumber: credsData.me.id.split(":")[0], // Mengambil nomor murni
//         name: credsData.me.name || "WhatsApp Bot",
//         message: "Bot aktif dan terhubung.",
//       };
//     } else {
//       return { connected: false, status: "WAITING_SCAN", message: "Menunggu pemindaian QR Code." };
//     }
//   } catch (error) {
//     console.error(`🚨 [Bot Service] Gagal mengecek status bot untuk tenant [${tenantId}]:`, error);
//     return { connected: false, status: "ERROR", message: "Terjadi kesalahan internal sistem." };
//   }
// }

/**
 * 5. Mengambil susunan chatbot dinamis (termasuk penelusuran rantai form input)
 * @param {String} tenantId - ID Tenant yang sedang mengakses aplikasi
 */
async function fetchBotMenuConfiguration(tenantId) {
  // Ambil welcome node milik tenant terlebih dahulu
  let welcomeNode = await prisma.botNode.findFirst({
    where: { tenantId: tenantId, nodeType: "WELCOME" },
    include: { options: true },
  });

  let targetTenantId = tenantId;
  const MASTER_TEMPLATE_ID = "MASTER-TEMPLATE-0000-0000-000000000000";

  // 🌟 OTOMATISASI PINTAR: Jika data bot tenant masih kosong, ambil dari Master Template hasil seeding Anda
  if (!welcomeNode) {
    console.log(`ℹ️ [Bot Service] Tenant ${tenantId} kosong. Mengambil dari Master Template...`);
    welcomeNode = await prisma.botNode.findFirst({
      where: { tenantId: MASTER_TEMPLATE_ID, nodeType: "WELCOME" },
      include: { options: true },
    });
    if (welcomeNode) {
      targetTenantId = MASTER_TEMPLATE_ID;
    }
  }

  // Jika database benar-benar kosong total (belum di-seed sama sekali)
  if (!welcomeNode) {
    return { welcomeMessage: "", menus: [] };
  }

  const menusPayload = [];

  // Looping setiap tombol pilihan menu utama
  for (const option of welcomeNode.options) {
    const questionsList = [];
    let queue = [option.nextNodeId];
    let visited = new Set(); // Antispam anti-infinite loop
    let loopCounter = 0;

    while (queue.length > 0) {
      loopCounter++;
      if (loopCounter > 50) break; // Watchdog keamanan server

      let currentNodeId = queue.shift();
      if (!currentNodeId || currentNodeId === "FINALIZE_CRM_SIGNAL" || visited.has(currentNodeId)) {
        continue;
      }
      visited.add(currentNodeId);

      const node = await prisma.botNode.findFirst({
        where: { nodeId: currentNodeId, tenantId: targetTenantId },
        include: { options: true },
      });

      if (!node) continue;

      // Jika node ini berupa input form formulir, masukkan ke list untuk Flutter
      if (node.isFormInput) {
        questionsList.push({
          questionText: node.messageText,
          jsonKey: node.saveToField,
        });
      }

      // Jalur A: Jika ada rute default lurus ke depan, masukkan ke antrean
      if (node.nextDefaultNodeId) {
        queue.push(node.nextDefaultNodeId);
      }

      // Jalur B: Jika ternyata di dalam menu ini ada tombol pilihan lagi (Sub-Menu)
      if (node.options && node.options.length > 0) {
        for (const subOption of node.options) {
          queue.push(subOption.nextNodeId);
        }
      }
    }

    menusPayload.push({
      triggerKey: option.triggerKey,
      label: option.label,
      questions: questionsList,
    });
  }

  return {
    welcomeMessage: welcomeNode.messageText,
    menus: menusPayload,
  };
}

/**
 * 6. Otomatisasi Boot: Menarik semua Tenant ID yang sudah memiliki sesi login sah ("creds")
 * di PostgreSQL agar server bisa menyambungkannya kembali secara otomatis saat startup.
 */
async function autoStartActiveBots() {
  try {
    const activeSessions = await prisma.whatsappAuth.findMany({
      where: { key: "creds" },
      select: { tenantId: true },
    });
    return activeSessions.map((session) => session.tenantId);
  } catch (error) {
    console.error("🚨 [Bot Service] Gagal menarik daftar bot aktif untuk auto-start:", error.message);
    return [];
  }
}

module.exports = {
  getAuthValue,
  saveAuthValue,
  deleteAuthValue,
  checkBotConnectionStatus,
  fetchBotMenuConfiguration,
  autoStartActiveBots, // 👈 Eksport fungsi baru Anda di sini
};
