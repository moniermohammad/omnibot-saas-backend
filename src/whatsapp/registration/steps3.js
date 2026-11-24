const prisma = require('../../../config/prisma');
const { cleanNumber, isUserExist, getGlobalDuplicates } = require('./validator'); 
const { executeRegistrationTx } = require('./db'); 
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');

const DELIMITER = ':::';

// Global Map untuk melacak socket aktif agar bisa dimatikan paksa saat timeout
if (!global.activeClientSockets) {
    global.activeClientSockets = new Map();
}

async function inputAdminNumber(sock, rawJid, regSession, incomingText) {
    const parts = regSession.currentNodeId.split(DELIMITER);
    const businessName = parts[1];
    const ownerNumber = parts[2];
    
    const adminNumber = cleanNumber(incomingText);
    if (adminNumber.length < 9) {
        return await sock.sendMessage(rawJid, { text: "⚠️ Format salah. Silakan masukkan nomor Admin SPV yang valid (Hanya Angka):" });
    }

    await prisma.botSession.update({
        where: { id: regSession.id },
        data: { currentNodeId: `REG_INPUT_SALES_NUMBERS${DELIMITER}${businessName}${DELIMITER}${ownerNumber}${DELIMITER}${adminNumber}` }
    });

    return await sock.sendMessage(rawJid, { 
        text: `Nomor Admin SPV *${adminNumber}* berhasil disimpan.\n\nLangkah Terakhir, masukkan minimal 1 dan maksimal 2 nomor *Sales Agen Lapangan* Anda (Pisahkan dengan tanda koma jika lebih dari 1, Contoh: 081234,085678):` 
    });
}

async function finalizeRegistration(sock, rawJid, regSession, incomingText) {
    const parts = regSession.currentNodeId.split(DELIMITER);
    const businessName = parts[1];
    const ownerNumber = parts[2];
    const adminNumber = parts[3];

    const salesArray = incomingText.split(',').map(num => cleanNumber(num)).filter(num => num.length > 0);

    if (salesArray.length < 1 || salesArray.length > 2) {
        return await sock.sendMessage(rawJid, { text: "⚠️ Jumlah salah! Masukkan minimal 1 dan maksimal 2 nomor sales dipisah dengan koma:" });
    }

    const checkList = [ownerNumber, adminNumber, ...salesArray];
    if (new Set(checkList).size !== checkList.length) {
        return await sock.sendMessage(rawJid, { text: "❌ Antara nomor Owner, Admin, dan antar Sales tidak boleh ada yang sama! Silakan ketik ulang nomor sales:" });
    }

    const duplicates = await getGlobalDuplicates(checkList);
    if (duplicates.length > 0) {
        const failed = duplicates.map(u => `+${u.phoneNumber}`).join(', ');
        return await sock.sendMessage(rawJid, { text: `❌ Registrasi GAGAL! Nomor berikut sudah terdaftar di sistem: *${failed}*.\n\nSilakan kirim ulang nomor sales baru:` });
    }

    let expiryTimeout = null;
    const senderPhoneNumber = regSession.id;

    try {
        // 1. Jalankan Simpan Akun Bisnis Baru ke PostgreSQL secara atomik
        const finalTenant = await executeRegistrationTx(businessName, ownerNumber, adminNumber, salesArray);
        
        // 🌟 UPDATE STATE: Menjadi WAITING_SCAN agar flow utama tahu user sedang di fase scan
        await prisma.botSession.update({
            where: { id: senderPhoneNumber },
            data: { currentNodeId: "REG_WAITING_SCAN" }
        });

        await sock.sendMessage(rawJid, { 
            text: `🎉 **DATA TERAKTIVASI** 🎉\n\nData *${businessName}* sudah aman di database.\n\nSistem sedang menyiapkan **QR Code khusus** untuk nomor WhatsApp bisnis Anda. Mohon tunggu 5-10 detik... ⏳` 
        });

        // Bersihkan koneksi lama yang menggantung pada tenant ini di memori jika ada
        if (global.activeClientSockets.has(finalTenant.id)) {
            const oldSock = global.activeClientSockets.get(finalTenant.id);
            try { oldSock.end(); } catch (_) {}
            global.activeClientSockets.delete(finalTenant.id);
        }

        // 2. Siapkan Folder Sesi Terisolasi Berdasarkan UUID Tenant Baru
        const sessionFolder = path.join(__dirname, `../../../../auth_info_baileys/${finalTenant.id}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

        const clientSock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: require('pino')({ level: 'silent' })
        });

        global.activeClientSockets.set(finalTenant.id, clientSock);
        clientSock.ev.on('creds.update', saveCreds);
        let qrSent = false;

        // 🛡️ B0M WAKTU (WATCHDOG TIMEOUT): Eksekusi mati otomatis dalam 2 menit (120.000 ms) jika dicuekin
        expiryTimeout = setTimeout(async () => {
            if (global.activeClientSockets.has(finalTenant.id) && clientSock.user === undefined) {
                console.log(`[SaaS Watchdog] Sesi scan Tenant ${finalTenant.id} hangus akibat dicuekin user.`);
                
                try {
                    // A. Putus jalur pemantau event jaringan Baileys
                    clientSock.ev.removeAllListeners('connection.update');
                    // B. Hancurkan koneksi socket Baileys (RAM server i3 langsung bersih kembali)
                    clientSock.end(); 
                    global.activeClientSockets.delete(finalTenant.id);
                    
                    // C. HAPUS TOTAL DATA SESI DARI DATABASE POSTGRESQL (Paksa Daftar Ulang)
                    await prisma.botSession.delete({
                        where: { id: senderPhoneNumber }
                    });

                    // D. Kirim pesan edukasi bahwa sesi hangus total
                    const timeoutTxt = `⏳ **WAKTU SCAN HABIS (HANGUS TOTAL)** ⏳\n\n` +
                                       `Batas waktu pemindaian 2 menit telah terlampaui. Sesi pendaftaran Anda telah dihapus otomatis demi keamanan data server.\n\n` +
                                       `👉 Silakan kirim pesan chat apa saja ke bot ini untuk memulai proses pendaftaran baru dari awal lagi.`;
                    
                    await sock.sendMessage(rawJid, { text: timeoutTxt });
                } catch (e) {
                    console.error("Gagal mengeksekusi watchdog timeout pembersihan sesi:", e);
                }
            }
        }, 120000);

        // 3. Tangkap Event Perubahan Koneksi & QR Code
        clientSock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;

            if (qr && !qrSent) {
                qrSent = true; 
                try {
                    const qrBuffer = await QRCode.toBuffer(qr, { scale: 8 });
                    const captionMsg = `👇 **INI ADALAH QR CODE AKTIVASI BOT ANDA** 👇\n\n` +
                                       `💡 **CARA AKTIVASI (PENTING):**\n` +
                                       `1. Foto/Kirim gambar QR Code di atas ke HP kedua Anda.\n` +
                                       `2. Buka aplikasi **WhatsApp** di HP utama yang mau dijadikan Bot Toko Klien.\n` +
                                       `3. Masuk ke menu **Perangkat Tertaut (Linked Devices)** -> klik **Tautkan Perangkat**.\n` +
                                       `4. Arahkan kamera HP utama ke gambar QR Code yang ada di HP kedua tersebut.\n\n` +
                                       `⚠️ *Batas waktu scan maksimal 2 menit sebelum sesi pendaftaran Anda hangus total!*`;

                    await sock.sendMessage(rawJid, { image: qrBuffer, caption: captionMsg });
                } catch (qrErr) {
                    console.error("Gagal convert text QR ke gambar buffer:", qrErr);
                    qrSent = false;
                }
            }

            if (connection === 'open') {
                // 🛡️ BATALKAN BOM WAKTU JIKA USER SUKSES SCAN SEBELUM 2 MENIT!
                if (expiryTimeout) clearTimeout(expiryTimeout);

                console.log(`✅ Bot Toko untuk Tenant ${finalTenant.id} resmi TERTAUT via Scan!`);
                
                // Hapus sesi pendaftaran Master Bot karena pendaftaran telah sukses selesai
                await prisma.botSession.delete({ where: { id: senderPhoneNumber } });
                global.activeClientSockets.delete(finalTenant.id);

                await sock.sendMessage(rawJid, { 
                    text: `✅ **BOT WA CRM AKTIF!**\n\nSelamat, nomor WhatsApp bisnis Anda resmi terhubung dengan sistem CRM Tenant Anda sendiri.` 
                });

                // Otomatisasi seeding welcome node untuk tenant baru ini agar bot mereka tidak kosong
                try {
                    await prisma.botNode.create({
                        data: {
                            tenantId: finalTenant.id,
                            nodeType: "WELCOME",
                            messageText: `Selamat datang di *${businessName}*! 😊\n\nSilakan pilih menu layanan kami:\n1. Konsultasi Jasa\n2. Cek Ketersediaan Alat`,
                            isFormInput: false
                        }
                    });
                } catch (nodeErr) {
                    console.error("Gagal otomatisasi seeding welcome node tenant baru:", nodeErr);
                }
            }
        });

    } catch (err) {
        if (expiryTimeout) clearTimeout(expiryTimeout);
        console.error("Eror fatal penyiapan pancingan QR WA:", err);
        return await sock.sendMessage(rawJid, { text: "🚨 Maaf, terjadi gangguan pada server lokal saat memproses pembuatan QR Code." });
    }
}

module.exports = { inputAdminNumber, finalizeRegistration };
