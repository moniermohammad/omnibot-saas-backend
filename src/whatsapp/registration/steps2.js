const prisma = require("../../../config/prisma");
const QRCode = require("qrcode");

// ⚠️ Perubahan 1: Panggilan Baileys secara static require() dihapus dari atas file ini.
// Pustaka path dan fs tetap pakai CommonJS require()
const path = require("path");
const fs = require("fs");

const DELIMITER = ":::";

if (!global.activeClientSockets) {
  global.activeClientSockets = new Map();
}

// ==========================================
// 1. FUNGSI MENAMPUNG NAMA BISNIS & TANYA NAMA OWNER
// ==========================================
async function askOwnerName(sock, rawJid, regSession, businessNameInput, senderPhoneNumber) {
  try {
    await prisma.tenant.update({
      where: { id: regSession.tenantId },
      data: { businessName: businessNameInput.trim() },
    });

    await prisma.botSession.update({
      where: { id: senderPhoneNumber },
      data: { currentNodeId: `REG_INPUT_OWNER_NAME${DELIMITER}${businessNameInput.trim()}` },
    });

    await sock.sendMessage(rawJid, {
      text: "🏢 *Nama bisnis berhasil disimpan!*\n\nLangkah 2: Sekarang, silakan tuliskan *Nama Lengkap Anda* selaku Pemilik/Owner Bisnis:",
    });
  } catch (error) {
    console.error("🚨 Gagal di askOwnerName:", error);
  }
}

// ==========================================
// 2. FUNGSI MENAMPUNG NAMA OWNER & TANYA NOMOR OWNER
// ==========================================
async function askOwnerPhone(sock, rawJid, regSession, ownerNameInput, senderPhoneNumber) {
  try {
    const parts = regSession.currentNodeId.split(DELIMITER);
    const businessName = parts[1];

    await prisma.botSession.update({
      where: { id: senderPhoneNumber },
      data: { currentNodeId: `REG_INPUT_OWNER_PHONE${DELIMITER}${businessName}${DELIMITER}${ownerNameInput.trim()}` },
    });

    await sock.sendMessage(rawJid, {
      text: "👤 *Nama Owner berhasil dicatat.*\n\nLangkah 3: Tuliskan *Nomor WhatsApp Utama Owner* yang akan digunakan untuk masuk/login ke Aplikasi Mobile Flutter:\n_(Contoh: 628558836680)_",
    });
  } catch (error) {
    console.error("🚨 Gagal di askOwnerPhone:", error);
  }
}

// ==========================================
// 3. FUNGSI UTAMA GENERATOR SOCKET DAN REGISTRASI QR
// ==========================================
async function finalizeAndRequestQr(sock, rawJid, regSession, ownerPhoneInput, senderPhoneNumber) {
  // 🌟 PERUBAHAN UTAMA: Import Baileys secara dinamis di dalam fungsi async ini
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = await import("@whiskeysockets/baileys");

  const parts = regSession.currentNodeId.split(DELIMITER);
  const businessName = parts[1];
  const ownerName = parts[2];

  const cleanPhone = ownerPhoneInput.replace(/[^0-9]/g, "").trim();

  if (cleanPhone.length < 10) {
    return await sock.sendMessage(rawJid, {
      text: "⚠️ Format nomor salah. Masukkan nomor WhatsApp owner yang valid dengan kode negara (contoh: 62855xxx):",
    });
  }

  let expiryTimeout = null;

  try {
    // 🌟 A. KUNCI MASA SEWA
    const startDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setDate(startDate.getDate() + 14);

    const finalTenant = await prisma.tenant.update({
      where: { id: regSession.tenantId },
      data: {
        businessName: businessName,
        status: "FREE_TRIAL",
        subscriptionStart: startDate,
        subscriptionEnd: trialEndDate,
      },
    });

    // 🌟 B. BUAT USER BARU VIA UPSERT
    await prisma.user.upsert({
      where: {
        phoneNumber: cleanPhone,
      },
      update: {
        tenantId: finalTenant.id,
        name: ownerName,
        role: "OWNER",
      },
      create: {
        tenantId: finalTenant.id,
        name: ownerName,
        phoneNumber: cleanPhone,
        role: "OWNER",
      },
    });
    console.log(`👤 [SaaS DB] Data user owner ${cleanPhone} sukses diamankan via Upsert.`);

    // 🌟 C. GESER STATE KE WAITING SCAN
    await prisma.botSession.update({
      where: { id: senderPhoneNumber },
      data: { currentNodeId: "REG_WAITING_SCAN" },
    });

    await sock.sendMessage(rawJid, {
      text: `🎉 **DATA TERAKTIVASI** 🎉\n\nData bisnis *${businessName}* sudah aman di database.\n\nSistem sedang menyiapkan **QR Code khusus** untuk nomor WhatsApp bisnis Anda. Mohon tunggu sejenak... ⏳`,
    });

    // Putus socket lama di memori jika ada
    if (global.activeClientSockets.has(finalTenant.id)) {
      const oldSock = global.activeClientSockets.get(finalTenant.id);
      try {
        oldSock.ev.removeAllListeners("connection.update");
        oldSock.end();
      } catch (_) {}
      global.activeClientSockets.delete(finalTenant.id);
    }

    // 🌟 D. ISOLASI FOLDER CONFIG BAILEYS (BERSIH TOTAL)
    const sessionFolder = path.join(__dirname, `../../../../auth_info_baileys/${finalTenant.id}`);

    if (fs.existsSync(sessionFolder)) {
      try {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (_) {}
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    // Mengambil versi WA Web terbaru cadangan
    let waVersion = [2, 3000, 101597000];
    try {
      const { version } = await fetchLatestBaileysVersion();
      waVersion = version;
    } catch (_) {}

    const clientSock = makeWASocket({
      auth: state,
      version: waVersion,
      browser: Browsers.macOS("Desktop"),
      printQRInTerminal: false,
      logger: require("pino")({ level: "silent" }),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      emitOwnEvents: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
      agent: undefined,
      keepAliveIntervalMs: 20000,
      appStateMacVerification: {
        patch: false,
        snapshot: false,
      },
    });

    global.activeClientSockets.set(finalTenant.id, clientSock);
    clientSock.ev.on("creds.update", saveCreds);

    let lastQrString = null;

    // 🌟 E. WATCHDOG TIMEOUT 2 MENIT
    expiryTimeout = setTimeout(async () => {
      if (global.activeClientSockets.has(finalTenant.id) && clientSock.user === undefined) {
        console.log(`[SaaS Watchdog] Sesi pendaftaran Tenant ${finalTenant.id} hangus.`);
        try {
          clientSock.ev.removeAllListeners("connection.update");
          clientSock.end();
          global.activeClientSockets.delete(finalTenant.id);

          await prisma.user.deleteMany({ where: { tenantId: finalTenant.id } });
          await prisma.botSession.deleteMany({ where: { id: senderPhoneNumber } });
          await prisma.tenant.delete({ where: { id: finalTenant.id } });

          const timeoutTxt =
            `⏳ **WAKTU SCAN HABIS (HANGUS TOTAL)** ⏳\n\n` +
            `Batas waktu pemindaian 2 menit telah terlampaui. Sesi pendaftaran Anda telah dihapus otomatis demi keamanan data server.\n\n` +
            `👉 Silakan kirim pesan chat apa saja ke bot ini untuk memulai proses pendaftaran baru dari awal lagi.`;

          await sock.sendMessage(rawJid, { text: timeoutTxt });
        } catch (e) {
          console.error("Gagal mengeksekusi watchdog timeout pembersihan sesi:", e);
        }
      }
    }, 120000);

    // 🌟 F. COBA TANGKAP QR CODE & ERROR DISCONNECT
    clientSock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (connection) {
        console.log(`[Status Koneksi Tenant ${finalTenant.id}]: ${connection}`);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`[SaaS Error] Socket closed dengan status code: ${statusCode}`);

        if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
          console.log(`[SaaS Auto-Fix] Terkena 515. Membersihkan cache korup dan mencoba ulang dalam 5 detik...`);

          if (expiryTimeout) clearTimeout(expiryTimeout);
          try {
            clientSock.ev.removeAllListeners("connection.update");
            clientSock.end();
          } catch (_) {}

          if (fs.existsSync(sessionFolder)) {
            try {
              fs.rmSync(sessionFolder, { recursive: true, force: true });
            } catch (__) {}
          }

          setTimeout(() => {
            return finalizeAndRequestQr(sock, rawJid, regSession, ownerPhoneInput, senderPhoneNumber);
          }, 5000);

          return;
        }

        if (statusCode !== DisconnectReason.loggedOut && expiryTimeout) {
          await sock.sendMessage(rawJid, {
            text: `🚨 **Gagal Menghubungkan ke Server WA**\n\nServer WhatsApp menolak jabat tangan websocket (Code: ${statusCode || "Unknown"}).\n\nKetik *RESCAN* untuk mencoba ulang pembuatan kode QR baru.`,
          });
        }
      }

      if (qr && qr !== lastQrString) {
        lastQrString = qr;
        try {
          const qrBuffer = await QRCode.toBuffer(qr, { scale: 8 });
          const captionMsg =
            `👇 **INI ADALAH QR CODE AKTIVASI BOT ANDA** 👇\n\n` +
            `💡 **CARA AKTIVASI (PENTING):**\n` +
            `1. Foto/Kirim gambar QR Code di atas ke HP kedua Anda.\n` +
            `2. Buka aplikasi **WhatsApp** di HP utama yang mau dijadikan Bot Toko Klien.\n` +
            `3. Masuk ke menu **Perangkat Tertaut (Linked Devices)** -> klik **Tautkan Perangkat**.\n` +
            `4. Arahkan kamera HP utama ke gambar QR Code yang ada di HP kedua tersebut.\n\n` +
            `⚠️ *Batas waktu scan maksimal 2 menit sebelum sesi pendaftaran Anda hangus total!*`;

          await sock.sendMessage(rawJid, { image: qrBuffer, caption: captionMsg });
        } catch (qrErr) {
          console.error("Gagal convert text QR ke gambar buffer:", qrErr);
        }
      }
    });
  } catch (err) {
    if (expiryTimeout) clearTimeout(expiryTimeout);
    console.error("Eror fatal penyiapan pancingan QR WA:", err);
    return await sock.sendMessage(rawJid, { text: "🚨 Maaf, terjadi gangguan pada server lokal saat memproses pembuatan QR Code." });
  }
}

// ==========================================
// 4. FUNGSI HANDLER RESCAN KETIKA KODE QR EXPIRED
// ==========================================
async function generateAndSendQrCode(sock, rawJid, regSession, senderPhoneNumber) {
  try {
    const ownerUser = await prisma.user.findFirst({
      where: { tenantId: regSession.tenantId, role: "OWNER" },
    });

    const tenantData = await prisma.tenant.findUnique({
      where: { id: regSession.tenantId },
    });

    if (!ownerUser || !tenantData) {
      return await sock.sendMessage(rawJid, { text: "🚨 Data pendaftaran tidak ditemukan. Silakan kirim chat apa saja untuk mengulang dari awal." });
    }

    const virtualSession = {
      tenantId: regSession.tenantId,
      currentNodeId: `REG_INPUT_OWNER_PHONE${DELIMITER}${tenantData.businessName}${DELIMITER}${ownerUser.name}`,
    };

    return await finalizeAndRequestQr(sock, rawJid, virtualSession, ownerUser.phoneNumber, senderPhoneNumber);
  } catch (error) {
    console.error("🚨 Gagal di generateAndSendQrCode (RESCAN Handler):", error);
    return await sock.sendMessage(rawJid, { text: "🚨 Gagal memproses permintaan RESCAN baru." });
  }
}

module.exports = {
  askOwnerName,
  askOwnerPhone,
  finalizeAndRequestQr,
  generateAndSendQrCode,
};
