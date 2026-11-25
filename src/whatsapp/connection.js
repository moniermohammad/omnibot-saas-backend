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

// ✅ FUNGSI AUTO-RESTORE SELURUH SESI TENANT DARI TABEL WhatsappAuth
async function restoreAllTenantSessions() {
  try {
    console.log("🔄 [Baileys Engine] Memeriksa sesi WhatsApp tenant di database...");

    // Cari semua tenantId unik yang memiliki data 'creds' di tabel WhatsappAuth (dan tenant belum EXPIRED)
    const savedSessions = await prisma.whatsappAuth.findMany({
      where: {
        key: "creds",
        tenant: {
          status: { not: "EXPIRED" },
        },
      },
      select: {
        tenantId: true,
        tenant: {
          select: { businessName: true },
        },
      },
      distinct: ["tenantId"],
    });

    if (savedSessions.length === 0) {
      console.log("ℹ️ [Baileys Engine] Tidak ada sesi tenant tersimpan yang perlu dipulihkan.");
      return;
    }

    for (const session of savedSessions) {
      if (session.tenantId === "MASTER_SYSTEM") continue;

      const label = session.tenant?.businessName || session.tenantId;
      console.log(`🔌 [Baileys Engine] Menyambungkan ulang sesi WA otomatis untuk [${label}]...`);
      
      await connectToWhatsApp(session.tenantId);
      // Beri jeda 1.5 detik antar tenant agar koneksi Baileys stabil
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } catch (error) {
    console.error("🚨 [Baileys Engine] Gagal memulihkan sesi tenant saat startup:", error.message);
  }
}


module.exports = { connectToWhatsApp, restoreAllTenantSessions };