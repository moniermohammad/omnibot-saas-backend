const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const { handleIncomingMessage } = require("./handler");
const { usePrismaAuthState, clearPrismaAuthState } = require("./botAuthAdapter");
const { activeSockets } = require("../../botMemory");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const qrExpiredTenants = new Set();
const connectingLocks = new Set();
const qrTimers = new Map();

if (!global.lastTenantQr) {
  global.lastTenantQr = {};
}

/**
 * Fungsi Universal untuk Menghubungkan Bot Utama maupun Bot Tenant
 */
async function connectToWhatsApp(tenantId = "MASTER_SYSTEM") {
  // 🛑 1. PENGAMAN ANTI-BENTROK: Tolak jika tenant ini sedang proses konek atau sudah online
  if (connectingLocks.has(tenantId) || activeSockets[tenantId]) {
    console.log(`⏳ [Baileys Engine] Koneksi untuk [${tenantId}] sudah berjalan/aktif. Melewati duplikasi.`);
    return activeSockets[tenantId];
  }

  // Pasang kunci segera sebelum operasi database berjalan
  connectingLocks.add(tenantId);

  try {
    
    const {
      default: makeWASocket,
      DisconnectReason,
      makeCacheableSignalKeyStore,
    } = await import("@whiskeysockets/baileys");

    const { state, saveCreds } = await usePrismaAuthState(tenantId);
    const silentLogger = pino({ level: "silent" });

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        // 🌟 2. PENGAMAN ANTI-MESSAGECOUNTERERROR: Cache kunci enkripsi di RAM
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      printQRInTerminal: false,
      logger: silentLogger,
    });

    // Catat socket yang aktif ke memory pusat sementara
    activeSockets[tenantId] = sock;

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrExpiredTenants.delete(tenantId);
        global.lastTenantQr[tenantId] = qr;

        if (tenantId === "MASTER_SYSTEM") {
          console.clear();
          console.log(`\n🚀 [MASTER BOT] Silakan scan QR Code di bawah ini untuk mengaktifkan sistem pendaftaran SaaS:`);
          qrcode.generate(qr, { small: true });
        }

        // Kirim kode QR ke UI React secara real-time via WebSocket jika terhubung
        if (global.io) {
          global.io.to(tenantId).emit("wa-qrcode", { qr });
        }

        if (tenantId !== "MASTER_SYSTEM") {
          // Simpan referensi timer ke qrTimers agar bisa dibersihkan jika QR sukses di-scan
          if (qrTimers.has(tenantId)) clearTimeout(qrTimers.get(tenantId));

          const timer = setTimeout(() => {
            if (global.lastTenantQr && global.lastTenantQr[tenantId] === qr) {
              delete global.lastTenantQr[tenantId];
              qrExpiredTenants.add(tenantId);
              console.log(`🗑️ [Baileys Engine] Batas 15 detik habis. Menghentikan QR Code secara permanen untuk Tenant [${tenantId}].`);
              try {
                sock.end();
              } catch (e) {}
            }
          }, 15000);

          qrTimers.set(tenantId, timer);
        }
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error
          ? lastDisconnect.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : lastDisconnect.error?.output?.statusCode
          : null;

        // 1. Lepas lock & bersihkan timer QR agar tidak bocor di RAM
        connectingLocks.delete(tenantId);
        if (qrTimers.has(tenantId)) {
          clearTimeout(qrTimers.get(tenantId));
          qrTimers.delete(tenantId);
        }

        // 2. Hancurkan seluruh listener dari socket lama ini
        try {
          sock.ev.removeAllListeners();
          sock.end(undefined);
        } catch (e) {}

        // 3. Hapus dari activeSockets HANYA JIKA socket di memori masih socket lama ini
        if (activeSockets[tenantId] === sock) {
          delete activeSockets[tenantId];
        }

        // 4. Cek proteksi QR code expired
        if (qrExpiredTenants.has(tenantId)) {
          console.log(`🛑 [Baileys Engine] Sesi dihentikan karena QR Code Kedaluwarsa untuk Tenant [${tenantId}].`);
          qrExpiredTenants.delete(tenantId);
          return;
        }

        // 5. Cek proteksi Status 401 (Logged Out dari HP) -> BERSIHKAN DATABASE!
        if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
          console.log(`❌ [Baileys Engine] Sesi Tenant [${tenantId}] HANGUS/LOGOUT (Status 401). Menghapus sesi DB...`);
          await clearPrismaAuthState(tenantId).catch(() => {});
          if (tenantId !== "MASTER_SYSTEM") {
            await prisma.tenant.update({
              where: { tenantId },
              data: { status: "DISCONNECTED" },
            }).catch(() => {});
          }
          return;
        }

        // 6. Status 440 (Connection Replaced) DILARANG auto-reconnect
        if (statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
          console.log(`⚠️ [Baileys Engine] Koneksi [${tenantId}] digantikan oleh sesi lain (Status 440). Menghentikan reconnect.`);
          return;
        }

        // 7. Status 515 (Restart Required setelah scan QR) -> Langsung reconnect cepat
        if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
          console.log(`🔄 [Baileys Engine] WhatsApp meminta restart resmi (515) untuk [${tenantId}]. Menyambung ulang...`);
          setTimeout(() => connectToWhatsApp(tenantId), 1500);
          return;
        }

        // 8. Reconnect Normal untuk gangguan jaringan (timeout, 408, 428, 500, dll)
        console.log(`🔌 Koneksi Bot Tenant [${tenantId}] terputus (Status: ${statusCode}). Reconnect dalam 5 detik...`);
        setTimeout(() => connectToWhatsApp(tenantId), 5000);
      }

      // 🌟 SAAT STATUS "OPEN" (SUKSES SCAN / CONNECT)
      else if (connection === "open") {
        // Lepas lock koneksi & bersihkan timer QR
        connectingLocks.delete(tenantId);
        qrExpiredTenants.delete(tenantId);
        if (global.lastTenantQr) delete global.lastTenantQr[tenantId];
        if (qrTimers.has(tenantId)) {
          clearTimeout(qrTimers.get(tenantId));
          qrTimers.delete(tenantId);
        }

        console.log(`\n✅ WhatsApp Bot untuk Tenant [${tenantId}] BERHASIL TERHUBUNG DAN ONLINE !`);

        // 1. Kunci socket terhubung ke memori RAM global pusat
        activeSockets[tenantId] = sock;

        // 2. SINKRONISASI PINTAR: Update DB HANYA jika data waNumber belum sesuai
        const myBotNumberRaw = sock.user?.id || "";
        const cleanPhoneNumber = myBotNumberRaw.split(":")[0].replace(/[^0-9]/g, "");

        if (tenantId !== "MASTER_SYSTEM" && cleanPhoneNumber) {
          try {
            const currentTenant = await prisma.tenant.findUnique({
              where: { tenantId: tenantId },
              select: { waNumber: true, status: true },
            });

            if (!currentTenant || currentTenant.waNumber !== cleanPhoneNumber || currentTenant.status !== "ACTIVE") {
              await prisma.tenant.update({
                where: { tenantId: tenantId },
                data: {
                  status: "ACTIVE",
                  waNumber: cleanPhoneNumber,
                },
              });
              console.log(`💾 [Prisma Engine] Nomor WA +${cleanPhoneNumber} BERHASIL DI-MAPPING PERTAMA KALI ke Tenant [${tenantId}].`);
            } else {
              console.log(`ℹ️ [Prisma Engine] Nomor WA +${cleanPhoneNumber} sudah sinkron. Melewati update database untuk kestabilan koneksi.`);
            }
          } catch (dbErr) {
            console.error(`🚨 Gagal memproses sinkronisasi aman nomor WA tenant:`, dbErr);
          }
        }

        // 3. Pancarkan sinyal real-time ke UI React via Socket.io
        if (global.io) {
          global.io.to(tenantId).emit("wa-status-changed", {
            status: "ONLINE",
            message: "WhatsApp sukses terhubung dan stabil!",
          });
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    // 🌟 FILTER PESAN RIWAYAT & SINKRONISASI MASSAL
        sock.ev.on("messages.upsert", async (m) => {
      // Terima event 'notify' maupun 'append' untuk chat masuk real-time
      if (m.type !== "notify" && m.type !== "append") return;

      for (const msg of m.messages) {
        // 1. Abaikan pesan dari diri sendiri & status/grup
        if (msg.key.fromMe) continue;
        if (!msg.key.remoteJid || msg.key.remoteJid.endsWith("@g.us") || msg.key.remoteJid === "status@broadcast") continue;
        if (msg.messageStubType || !msg.message) continue;

        // 2. Pastikan hanya memproses pesan baru (maksimal 5 menit / 300 detik)
        const messageTimestamp = msg.messageTimestamp;
        if (messageTimestamp) {
          const messageTimeMs = (typeof messageTimestamp === "number" ? messageTimestamp : messageTimestamp.low) * 1000;
          const timeGapSeconds = Math.abs(Date.now() - messageTimeMs) / 1000;
          if (timeGapSeconds > 300) continue;
        }

        console.log(`🔔 [INCOMING WA] Pesan masuk untuk Tenant [${tenantId}] dari [${msg.key.remoteJid}]`);
        await handleIncomingMessage(sock, msg, tenantId);
      }
    });


    return sock;
  } catch (err) {
    connectingLocks.delete(tenantId);
    delete activeSockets[tenantId];
    console.error(`🚨 Gagal menginisialisasi koneksi WhatsApp untuk [${tenantId}]:`, err);
  }
}

module.exports = { connectToWhatsApp };


// const { Boom } = require("@hapi/boom");
// const qrcode = require("qrcode-terminal");
// const pino = require("pino");
// const { handleIncomingMessage } = require("./handler");
// const { usePrismaAuthState } = require("./botAuthAdapter");
// const { activeSockets } = require("../../botMemory");
// const { PrismaClient } = require("@prisma/client"); // 🌟 TAMBAHAN: Untuk update status di DB

// const prisma = new PrismaClient();
// const qrExpiredTenants = new Set();
// const connectingLocks = new Set();
// const qrTimers = new Map();

// if (!global.lastTenantQr) {
//   global.lastTenantQr = {};
// }

// /**
//  * Fungsi Universal untuk Mengaktifkan Sesi WhatsApp Bot Dinamis Berbasis PostgreSQL
//  */
// async function connectToWhatsApp(tenantId = "MASTER_SYSTEM") {

//   const { default: makeWASocket, DisconnectReason } = await import("@whiskeysockets/baileys");
//   const { state, saveCreds } = await usePrismaAuthState(tenantId);

//   const sock = makeWASocket({
//     auth: state,
//     printQRInTerminal: false,
//     logger: pino({ level: "silent" }),
//   });

//   // Catat socket yang aktif ke memory pusat sementara
//   activeSockets[tenantId] = sock;

//   sock.ev.on("connection.update", async (update) => {
//     const { connection, lastDisconnect, qr } = update;

//     if (qr) {
//       qrExpiredTenants.delete(tenantId);
//       global.lastTenantQr[tenantId] = qr;

//       if (tenantId === "MASTER_SYSTEM") {
//         console.clear();
//         console.log(`\n🚀 [MASTER BOT] Silakan scan QR Code di bawah ini untuk mengaktifkan sistem pendaftaran SaaS:`);
//         qrcode.generate(qr, { small: true });
//       }

//       // 🌟 TAMBAHAN: Kirim kode QR ke UI React secara real-time via WebSocket jika terhubung
//       if (global.io) {
//         global.io.to(tenantId).emit("wa-qrcode", { qr });
//       }

//       if (tenantId !== "MASTER_SYSTEM") {
//         setTimeout(() => {
//           if (global.lastTenantQr && global.lastTenantQr[tenantId] === qr) {
//             delete global.lastTenantQr[tenantId];
//             qrExpiredTenants.add(tenantId);
//             console.log(`🗑️ [Baileys Engine] Batas 15 detik habis. Menghentikan QR Code secara permanen untuk Tenant [${tenantId}].`);
//             try { sock.end(); } catch (e) {}
//           }
//         }, 15000);
//       }
//     }

//     if (connection === "close") {
//       const { DisconnectReason } = await import("@whiskeysockets/baileys");
//       const statusCode = lastDisconnect?.error
//         ? (lastDisconnect.error instanceof Boom
//             ? lastDisconnect.error.output?.statusCode
//             : lastDisconnect.error?.output?.statusCode)
//         : null;

//       // 1. Lepas lock & bersihkan timer QR agar tidak bocor di RAM
//       connectingLocks.delete(tenantId);
//       if (qrTimers.has(tenantId)) {
//         clearTimeout(qrTimers.get(tenantId));
//         qrTimers.delete(tenantId);
//       }

//       // 2. Hancurkan seluruh listener dari socket lama ini
//       try {
//         sock.ev.removeAllListeners();
//         sock.end(undefined);
//       } catch (e) {}

//       // 3. Hapus dari activeSockets HANYA JIKA socket di memori masih socket lama ini
//       if (activeSockets[tenantId] === sock) {
//         delete activeSockets[tenantId];
//       }

//       // 4. Cek proteksi QR code expired
//       if (qrExpiredTenants.has(tenantId)) {
//         console.log(`🛑 [Baileys Engine] Sesi dihentikan karena QR Code Kedaluwarsa untuk Tenant [${tenantId}].`);
//         qrExpiredTenants.delete(tenantId);
//         return;
//       }

//       // 5. Cek proteksi Status 401 (Logged Out dari HP)
//       if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
//         console.log(`❌ [Baileys Engine] Sesi Tenant [${tenantId}] HANGUS/LOGOUT (Status 401).`);
//         return;
//       }

//       // 6. PERBAIKAN CRITICAL: Status 440 (Connection Replaced) DILARANG auto-reconnect!
//       if (statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
//         console.log(`⚠️ [Baileys Engine] Koneksi [${tenantId}] digantikan oleh sesi lain (Status 440). Menghentikan reconnect.`);
//         return;
//       }

//       // 7. Status 515 (Restart Required setelah scan QR) -> Langsung reconnect cepat
//       if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
//         console.log(`🔄 [Baileys Engine] WhatsApp meminta restart resmi (515) untuk [${tenantId}]. Menyambung ulang...`);
//         setTimeout(() => connectToWhatsApp(tenantId), 1500);
//         return;
//       }

//       // 8. Reconnect Normal untuk gangguan jaringan (timeout, 408, 428, 500, dll)
//       console.log(`🔌 Koneksi Bot Tenant [${tenantId}] terputus (Status: ${statusCode}). Reconnect dalam 5 detik...`);
//       setTimeout(() => connectToWhatsApp(tenantId), 5000);
//     }



// //     // 🌟 KUNCI PERBAIKAN UTAMA: SAAT STATUS "OPEN" (SUKSES SCAN / CONNECT)
// //     else if (connection === "open") {
// //       console.log(`\n✅ WhatsApp Bot untuk Tenant [${tenantId}] BERHASIL TERHUBUNG DAN ONLINE !`);
      
// //       qrExpiredTenants.delete(tenantId);
// //       if (global.lastTenantQr) delete global.lastTenantQr[tenantId];

// //       // 1. Kunci socket terhubung ke memori RAM global pusat
// //       activeSockets[tenantId] = sock;

// //       // 2. 🌟 SINKRONISASI PINTAR: Update DB HANYA jika data waNumber belum sesuai
// //       const myBotNumberRaw = sock.user?.id || "";
// //       const cleanPhoneNumber = myBotNumberRaw.split(":")[0].replace(/[^0-9]/g, "");

// //       if (tenantId !== "MASTER_SYSTEM" && cleanPhoneNumber) {
// //         try {
// //           // Tarik data tenant saat ini terlebih dahulu untuk pengecekan
// //           const currentTenant = await prisma.tenant.findUnique({
// //             where: { tenantId: tenantId },
// //             select: { waNumber: true, status: true }
// //           });

// //           // 🎯 JALUR AMAN: Hanya update jika nomor di DB berbeda atau status belum ACTIVE
// //           if (!currentTenant || currentTenant.waNumber !== cleanPhoneNumber || currentTenant.status !== "ACTIVE") {
// //             await prisma.tenant.update({
// //               where: { tenantId: tenantId },
// //               data: { 
// //                 status: "ACTIVE",
// //                 waNumber: cleanPhoneNumber
// //               }
// //             });
// //             console.log(`💾 [Prisma Engine] Nomor WA +${cleanPhoneNumber} BERHASIL DI-MAPPING PERTAMA KALI ke Tenant [${tenantId}].`);
// //           } else {
// //             // Jika sudah sama, biarkan saja tanpa menyentuh database agar Baileys tidak timeout/restart!
// //             console.log(`ℹ️ [Prisma Engine] Nomor WA +${cleanPhoneNumber} sudah sinkron. Melewati update database untuk kestabilan koneksi.`);
// //           }
// //         } catch (dbErr) {
// //           console.error(`🚨 Gagal memproses sinkronisasi aman nomor WA tenant:`, dbErr);
// //         }
// //       }

// //       // 3. Pancarkan sinyal real-time ke UI React via Socket.io
// //       if (global.io) {
// //         global.io.to(tenantId).emit("wa-status-changed", { 
// //           status: "ONLINE",
// //           message: "WhatsApp sukses terhubung dan stabil!" 
// //         });
// //       }
// //     }


// //   });

// //   sock.ev.on("creds.update", saveCreds);
  
// //   // 🌟 PERBAIKAN TOTAL ANTI-LOOP: Filter Pesan Riwayat & Sinkronisasi Massal
// //   sock.ev.on("messages.upsert", async (m) => {
// //     // 1. Validasi awal tipe event upsert
// //     if (m.type !== "notify") return; 

// //     // 2. Ekstraksi identitas nomor HP bot penerima pesan saat ini
// //     const myBotNumberRaw = sock.user?.id || "";
// //     const cleanBotNumber = myBotNumberRaw.split(":")[0].replace(/[^0-9]/g, "");

// //     let resolvedTenantId = tenantId;

// //     if (tenantId !== "MASTER_SYSTEM" && cleanBotNumber) {
// //       try {
// //         const matchedTenant = await prisma.tenant.findFirst({
// //           where: { waNumber: cleanBotNumber },
// //           select: { tenantId: true }
// //         });
// //         if (matchedTenant && matchedTenant.tenantId) {
// //           resolvedTenantId = matchedTenant.tenantId;
// //         }
// //       } catch (dbErr) {
// //         console.error("🚨 Gagal memvalidasi nomor WA bot penerima:", dbErr);
// //       }
// //     }

// //     // 3. Iterasi pesan masuk dengan filter ketat
// //     for (const msg of m.messages) {
// //       // 🛑 FILTER 1: Jangan merespons chat dari diri sendiri
// //       if (msg.key.fromMe) continue; 

// //       // 🛑 FILTER 2 (CRITICAL): Abaikan semua pesan sinkronisasi riwayat masa lalu (History Sync)
// //       // Karakteristik pesan sync Baileys biasanya tidak memiliki chat conversation murni
// //       if (msg.messageStubType || msg.labels || !msg.message) {
// //         continue; 
// //       }

// //       // 🛑 FILTER 3 (CRITICAL): Deteksi & Tolak pesan usang yang umurnya lebih dari 15 detik lalu
// //       // WhatsApp sering mengirim ulang chat lama saat startup, abaikan agar server tidak overload/looping restart
// //       const messageTimestamp = msg.messageTimestamp;
// //       if (messageTimestamp) {
// //         const messageTimeMs = (typeof messageTimestamp === "number" ? messageTimestamp : messageTimestamp.low) * 1000;
// //         const currentTimeMs = Date.now();
// //         const timeGapSeconds = Math.abs(currentTimeMs - messageTimeMs) / 1000;

// //         if (timeGapSeconds > 15) {
// //           // Mengabaikan pesan yang dikirim lebih dari 15 detik yang lalu saat server offline
// //           continue; 
// //         }
// //       }

// //       // 🚀 LOLOS SEMUA FILTER: Teruskan obrolan real-time yang sah ke Core AI Gemini
// //       await handleIncomingMessage(sock, msg, resolvedTenantId);
// //     }
// //   });


// // }

// // module.exports = { connectToWhatsApp };











// // const { Boom } = require("@hapi/boom");
// // const qrcode = require("qrcode-terminal");
// // const pino = require("pino");
// // const { handleIncomingMessage } = require("./handler");
// // const { usePrismaAuthState } = require("./botAuthAdapter");
// // const { activeSockets } = require("../../botMemory");
// // const { PrismaClient } = require("@prisma/client"); // 🌟 SAAS GUARD: Impor Prisma untuk cek masa aktif di DB

// // const prisma = new PrismaClient();
// // const qrExpiredTenants = new Set();

// // if (!global.lastTenantQr) {
// //   global.lastTenantQr = {};
// // }

// // /**
// //  * Fungsi Universal untuk Mengaktifkan Sesi WhatsApp Bot Dinamis Berbasis PostgreSQL
// //  */
// // async function connectToWhatsApp(tenantId = "MASTER_SYSTEM") {
  
// //   // 🌟 SAAS GUARD 1: PROTEKSI COLD-START (Mencegah inisialisasi awal / QR jika Tenant sudah EXPIRED)
// //   if (tenantId !== "MASTER_SYSTEM") {
// //     try {
// //       const tenant = await prisma.tenant.findUnique({
// //         where: { tenantId: tenantId },
// //         select: { subscriptionEnd: true }
// //       });

// //       if (tenant && new Date() > new Date(tenant.subscriptionEnd)) {
// //         console.log(`🚫 [SaaS Block] Menolak koneksi awal Tenant [${tenantId}] karena status EXPIRED.`);
// //         await prisma.tenant.update({
// //           where: { tenantId },
// //           data: { status: "EXPIRED" }
// //         });
// //         return; // Menghentikan total inisialisasi pemicuan bot
// //       }
// //     } catch (err) {
// //       console.error("🚨 Gagal melakukan validasi SaaS Cold-Start:", err);
// //     }
// //   }

// //   const { default: makeWASocket, DisconnectReason } = await import("@whiskeysockets/baileys");
// //   const { state, saveCreds } = await usePrismaAuthState(tenantId);

// //   const sock = makeWASocket({
// //     auth: state,
// //     printQRInTerminal: false,
// //     logger: pino({ level: "silent" }),
// //   });

// //   // Catat socket yang aktif ke memory pusat
// //   activeSockets[tenantId] = sock;

// //   sock.ev.on("connection.update", async (update) => {
// //     const { connection, lastDisconnect, qr } = update;

// //     if (qr) {
// //       qrExpiredTenants.delete(tenantId);
// //       global.lastTenantQr[tenantId] = qr;

// //       if (tenantId === "MASTER_SYSTEM") {
// //         console.clear();
// //         console.log(`\n🚀 [MASTER BOT] Silakan scan QR Code di bawah ini untuk mengaktifkan sistem pendaftaran SaaS:`);
// //         qrcode.generate(qr, { small: true });
// //       }

// //       if (tenantId !== "MASTER_SYSTEM") {
// //         setTimeout(() => {
// //           if (global.lastTenantQr && global.lastTenantQr[tenantId] === qr) {
// //             delete global.lastTenantQr[tenantId];
// //             qrExpiredTenants.add(tenantId);
// //             console.log(`🗑️ [Baileys Engine] Batas 15 detik habis. Menghentikan QR Code secara permanen untuk Tenant [${tenantId}].`);
// //             try {
// //               sock.end();
// //             } catch (e) {}
// //           }
// //         }, 15000);
// //       }
// //     }

// //     if (connection === "close") {
// //       const { DisconnectReason } = await import("@whiskeysockets/baileys"); // Pastikan terimpor
// //       const statusCode = lastDisconnect?.error ? (lastDisconnect.error instanceof Boom ? lastDisconnect.error.output?.statusCode : lastDisconnect.error?.output?.statusCode) : null;

// //       if (qrExpiredTenants.has(tenantId)) {
// //         console.log(`🛑 [Baileys Engine] Sistem berhenti mencoba menghubungkan Tenant [${tenantId}] karena QR Code Kedaluwarsa.`);
// //         delete activeSockets[tenantId];
// //         qrExpiredTenants.delete(tenantId);
// //         if (global.lastTenantQr) delete global.lastTenantQr[tenantId];
// //         return;
// //       }

// //       // 🌟 PERBAIKAN CRITICAL 1: Tangani Status 440 (restartRequired) secara aman tanpa spamming
// //       if (statusCode === 440 || statusCode === DisconnectReason.restartRequired) {
// //         console.log(`🔄 [Baileys Engine] WhatsApp meminta restart (Status 440) untuk [${tenantId}]. Membersihkan soket lama dan mencoba lagi dalam 5 detik...`);
// //         try { sock.end(); } catch(e){}
// //         delete activeSockets[tenantId];
// //         setTimeout(() => connectToWhatsApp(tenantId), 5000);
// //         return;
// //       }

// //       if (statusCode === null || statusCode === undefined) {
// //         console.log(`⏳ [Baileys Engine] Menyiapkan inisialisasi QR Code untuk [${tenantId}], menunggu 5 detik...`);
// //         delete activeSockets[tenantId];
// //         setTimeout(() => connectToWhatsApp(tenantId), 5000);
// //         return;
// //       }

// //       // Jika user sengaja logout dari HP, jangan hubungkan lagi
// //       const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
// //       console.log(`🔌 Koneksi Bot Tenant [${tenantId}] terputus. Status Code: ${statusCode}. Reconnect: ${shouldReconnect}`);

// //       if (!shouldReconnect) {
// //         console.log(`❌ [Baileys Engine] Tenant [${tenantId}] telah logout dari perangkat. Sesi dihancurkan.`);
// //         delete activeSockets[tenantId];
// //       } else {
// //         try { sock.end(); } catch(e){} // Bersihkan socket sebelum memicu yang baru
// //         delete activeSockets[tenantId];
// //         setTimeout(() => connectToWhatsApp(tenantId), 5000);
// //       }

// //       if (global.lastTenantQr) delete global.lastTenantQr[tenantId];
// //     } else if (connection === "open") {
// //       console.log(`\n✅ WhatsApp Bot untuk Tenant [${tenantId}] BERHASIL TERHUBUNG DAN ONLINE !`);
// //       qrExpiredTenants.delete(tenantId);
// //       if (global.lastTenantQr) delete global.lastTenantQr[tenantId];
// //     }
// //   });


// //   sock.ev.on("creds.update", saveCreds);

// //   // 🌟 SAAS GUARD 2: REAL-TIME INTERCEPTION (Putus koneksi otomatis di RAM jika chat masuk saat masa aktif habis)
// //   sock.ev.on("messages.upsert", async (m) => {
// //     if (m.type === "notify") {
      
// //       if (tenantId !== "MASTER_SYSTEM") {
// //         try {
// //           const tenant = await prisma.tenant.findUnique({
// //             where: { tenantId },
// //             select: { subscriptionEnd: true }
// //           });

// //           // Pengecekan waktu server saat ini (7 November 2026) terhadap tenggat database
// //           if (tenant && new Date() > new Date(tenant.subscriptionEnd)) {
// //             console.log(`⚠️ [SaaS Security Intercept] Tenant [${tenantId}] mendeteksi chat masuk pada masa EXPIRED. Memutus paksa sesi...`);
            
// //             // 1. Kunci status di DB PostgreSQL menjadi EXPIRED
// //             await prisma.tenant.update({
// //               where: { tenantId },
// //               data: { status: "EXPIRED" }
// //             });

// //             // 2. Putus dan hancurkan sesi Baileys secara total dari RAM & Klien HP
// //             try {
// //               await sock.logout();
// //               await sock.end();
// //             } catch (e) {}

// //             // 3. Bersihkan sisa memori socket RAM global
// //             delete activeSockets[tenantId];
// //             if (global.lastTenantQr) delete global.lastTenantQr[tenantId];

// //             // 4. Kirim sinyal WebSocket ke UI Dashboard React agar layar otomatis merespons merah
// //             if (global.io) {
// //               global.io.to(tenantId).emit("wa-status-changed", { status: "OFFLINE" });
// //             }

// //             return; // 🛑 BLOKIR JALUR: Memotong eksekusi, chat tidak akan diteruskan ke handler AI
// //           }
// //         } catch (err) {
// //           console.error("🚨 Gagal memproses intersepsi pesan SaaS:", err);
// //         }
// //       }

// //       // Jika lolos verifikasi masa aktif SaaS, chat diteruskan ke handler utama secara normal
// //       for (const msg of m.messages) {
// //         await handleIncomingMessage(sock, msg, tenantId);
// //       }
// //     }
// //   });
// // }

// // module.exports = { connectToWhatsApp };



























// // const { Boom } = require("@hapi/boom");
// // const qrcode = require("qrcode-terminal");
// // const pino = require("pino");
// // const { handleIncomingMessage } = require("./handler");
// // const { usePrismaAuthState } = require("./botAuthAdapter");
// // const { activeSockets } = require("../../botMemory");

// // const qrExpiredTenants = new Set();

// // if (!global.lastTenantQr) {
// //   global.lastTenantQr = {};
// // }

// // /**
// //  * Fungsi Universal untuk Mengaktifkan Sesi WhatsApp Bot Dinamis Berbasis PostgreSQL
// //  */
// // async function connectToWhatsApp(tenantId = "MASTER_SYSTEM") {
// //   const { default: makeWASocket, DisconnectReason } = await import("@whiskeysockets/baileys");
// //   const { state, saveCreds } = await usePrismaAuthState(tenantId);

// //   const sock = makeWASocket({
// //     auth: state,
// //     printQRInTerminal: false,
// //     logger: pino({ level: "silent" }),
// //   });

// //   // Catat socket yang aktif ke memory pusat
// //   activeSockets[tenantId] = sock;

// //   sock.ev.on("connection.update", async (update) => {
// //     const { connection, lastDisconnect, qr } = update;

// //     if (qr) {
// //       qrExpiredTenants.delete(tenantId);
// //       global.lastTenantQr[tenantId] = qr;

// //       if (tenantId === "MASTER_SYSTEM") {
// //         console.clear();
// //         console.log(`\n🚀 [MASTER BOT] Silakan scan QR Code di bawah ini untuk mengaktifkan sistem pendaftaran SaaS:`);
// //         qrcode.generate(qr, { small: true });
// //       }

// //       if (tenantId !== "MASTER_SYSTEM") {
// //         setTimeout(() => {
// //           if (global.lastTenantQr && global.lastTenantQr[tenantId] === qr) {
// //             delete global.lastTenantQr[tenantId];
// //             qrExpiredTenants.add(tenantId);
// //             console.log(`🗑️ [Baileys Engine] Batas 15 detik habis. Menghentikan QR Code secara permanen untuk Tenant [${tenantId}].`);
// //             try {
// //               sock.end();
// //             } catch (e) {}
// //           }
// //         }, 15000);
// //       }
// //     }

// //     if (connection === "close") {
// //       const statusCode = lastDisconnect?.error ? (lastDisconnect.error instanceof Boom ? lastDisconnect.error.output?.statusCode : null) : null;

// //       // 🚀 KUNCI PERBAIKAN UTAMA: Pengecekan Expired dipindah ke kasta tertinggi/paling atas!
// //       // Jika dipicu oleh sock.end() karena batas 15 detik habis, langsung hentikan total dan RETURN (keluar fungsi).
// //       if (qrExpiredTenants.has(tenantId)) {
// //         console.log(`🛑 [Baileys Engine] Sistem berhenti mencoba menghubungkan Tenant [${tenantId}] karena QR Code Kedaluwarsa.`);
// //         delete activeSockets[tenantId];
// //         qrExpiredTenants.delete(tenantId);
// //         if (global.lastTenantQr) delete global.lastTenantQr[tenantId];
// //         return; // Memotong jalur, mencegah eksekusi kode di bawahnya!
// //       }

// //       // Jalur inisialisasi awal gres (Hanya berjalan jika BUKAN dipicu oleh expired 15 detik)
// //       if (statusCode === null || statusCode === undefined) {
// //         console.log(`⏳ [Baileys Engine] Menyiapkan inisialisasi QR Code untuk [${tenantId}], menunggu 5 detik...`);
// //         delete activeSockets[tenantId];
// //         setTimeout(() => connectToWhatsApp(tenantId), 5000);
// //         return;
// //       }

// //       const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
// //       console.log(`🔌 Koneksi Bot Tenant [${tenantId}] terputus. Status Code: ${statusCode}. Reconnect: ${shouldReconnect}`);

// //       if (!shouldReconnect) {
// //         delete activeSockets[tenantId];
// //       } else {
// //         setTimeout(() => connectToWhatsApp(tenantId), 5000);
// //       }

// //       if (global.lastTenantQr) delete global.lastTenantQr[tenantId];
// //     } else if (connection === "open") {
// //       console.log(`\n✅ WhatsApp Bot untuk Tenant [${tenantId}] BERHASIL TERHUBUNG DAN ONLINE !`);
// //       qrExpiredTenants.delete(tenantId);
// //       if (global.lastTenantQr) delete global.lastTenantQr[tenantId];
// //     }
// //   });

// //   sock.ev.on("creds.update", saveCreds);

// //   sock.ev.on("messages.upsert", async (m) => {
// //     if (m.type === "notify") {
// //       for (const msg of m.messages) {
// //         await handleIncomingMessage(sock, msg, tenantId);
// //       }
// //     }
// //   });
// // }

// // module.exports = { connectToWhatsApp };
