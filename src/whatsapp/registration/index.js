const prisma = require('../../../config/prisma'); // Sesuaikan letak path prisma client Anda
const { isUserExist } = require('./validator');
const steps1 = require('./steps1');
const steps2 = require('./steps2');

const activeLocks = new Map();

// Harus sama dengan pemisah kaku di steps2.js
const DELIMITER = ':::';

async function handleRegistrationFlow(sock, rawJid, senderPhoneNumber, incomingText) {
    const cleanText = incomingText ? incomingText.trim() : "";
    if (!cleanText) return; 

    if (activeLocks.get(senderPhoneNumber)) return; 
    activeLocks.set(senderPhoneNumber, true);

    try {
        let regSession = await prisma.botSession.findFirst({
            where: { id: senderPhoneNumber }
        });

        // 🌟 PROTEKSI 10 MENIT: Bersihkan sampah pendaftaran jika ditinggal menggantung
        if (regSession) {
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            if (regSession.updatedAt < tenMinutesAgo) {
                console.log(`⏰ Sesi registrasi ${senderPhoneNumber} hangus karena timeout 10 menit.`);
                
                const targetTenantId = regSession.tenantId;
                try {
                    // Hapus berurutan agar aman dari Foreign Key Constraint
                    if (targetTenantId) {
                        await prisma.user.deleteMany({ where: { tenantId: targetTenantId } });
                    }
                    await prisma.botSession.deleteMany({ where: { id: senderPhoneNumber } });
                    if (targetTenantId) {
                        await prisma.tenant.delete({ where: { id: targetTenantId } });
                    }
                } catch (dbErr) {
                    console.error("🚨 Gagal melakukan auto-cleanup 10 menit:", dbErr);
                }

                await sock.sendMessage(rawJid, { 
                    text: "⏰ *Waktu pendaftaran habis!* Karena Anda tidak merespons selama lebih dari 10 menit, data pendaftaran sebelumnya telah dihapus.\n\nSilakan kirim pesan apa saja untuk memulai daftar ulang dari awal." 
                });
                return;
            }
        }

        // JIKA PERTAMA KALI CHAT / BELUM ADA SESI (Atau setelah dihapus otomatis oleh watchdog timeout)
        if (!regSession) {
            const isExist = await isUserExist(senderPhoneNumber);
            if (isExist) {
                await sock.sendMessage(rawJid, { 
                    text: "❌ Nomor Anda sudah terdaftar di sistem SaaS kami. Silakan masuk ke Aplikasi Mobile Flutter menggunakan OTP WhatsApp." 
                });
                return;
            }
            await steps1.askReady(sock, rawJid, senderPhoneNumber);
            return;
        }

        const state = regSession.currentNodeId;

        // 🌟 WAITING SCAN HANDLE
        if (state === "REG_WAITING_SCAN") {
            // Berikan opsi ketik RESCAN jika mereka merasa QR-nya macet / butuh yang baru sebelum diledakkan watchdog
            if (cleanText.toUpperCase() === "RESCAN") {
                return await steps2.generateAndSendQrCode(sock, rawJid, regSession, senderPhoneNumber);
            }

            await sock.sendMessage(rawJid, { 
                text: "⚠️ Proses registrasi Anda sedang menunggu scan QR Code di atas. Mohon lakukan pemindaian sebelum batas waktu habis.\n\n💡 _Jika QR Code tidak muncul atau kedaluwarsa, silakan ketik *RESCAN* untuk meminta kode baru._" 
            });
            return;
        }

        // ==========================================
        // ALUR STATE MANAGEMENT
        // ==========================================
        if (state === "REG_ASK_READY") {
            if (cleanText === "1") {
                return await steps1.inputBusinessName(sock, rawJid, regSession);
            }
            
            if (cleanText === "2") {
                console.log(`🧹 [SaaS Registry] User ${senderPhoneNumber} membatalkan registrasi. Melakukan sapu bersih database...`);
                const targetTenantId = regSession.tenantId;

                try {
                    if (targetTenantId) {
                        await prisma.user.deleteMany({ where: { tenantId: targetTenantId } });
                    }
                    await prisma.botSession.deleteMany({ where: { id: senderPhoneNumber } });
                    if (targetTenantId) {
                        await prisma.tenant.delete({ where: { id: targetTenantId } });
                    }
                    console.log(`✨ [SaaS Registry] Database steril kembali. Seluruh data nomor ${senderPhoneNumber} sukses dihancurkan.`);
                } catch (dbErr) {
                    console.error("🚨 Gagal melakukan pembersihan total data registrasi:", dbErr);
                }
                
                await sock.sendMessage(rawJid, { 
                    text: "❌ *PROSES PENDAFTARAN DIHANCURKAN TOTAL!* ❌\n\nSesi pendaftaran Anda telah ditutup dan seluruh data Anda telah dihapus permanen dari server database SaaS kami.\n\nTerima kasih! Jika nanti Anda berubah pikiran dan ingin mendaftar kembali, silakan kirim pesan chat apa saja untuk memulai alur pengisian dari awal." 
                });
                return;
            }
            
            await sock.sendMessage(rawJid, { 
                text: "⚠️ Opsi salah. Ketik *1* jika Anda SIAP melanjutkan registrasi bisnis, atau ketik *2* untuk PEMBATALAN PERMANEN (Hapus semua data):" 
            });
            return;
        }
        
        if (state === "REG_INPUT_BUSINESS_NAME") {
            return await steps2.askOwnerName(sock, rawJid, regSession, cleanText, senderPhoneNumber);
        }

        if (state.startsWith("REG_INPUT_OWNER_NAME")) {
            return await steps2.askOwnerPhone(sock, rawJid, regSession, cleanText, senderPhoneNumber);
        }

        if (state.startsWith("REG_INPUT_OWNER_PHONE")) {
            return await steps2.finalizeAndRequestQr(sock, rawJid, regSession, cleanText, senderPhoneNumber);
        }

    } catch (error) {
        console.error(`🚨 Fatal error pada registration flow index [${senderPhoneNumber}]:`, error);
        try {
            await sock.sendMessage(rawJid, { text: "❌ Terjadi gangguan internal. Kirim chat apa saja untuk mengulang." });
        } catch (_) {}
    } finally {
        activeLocks.delete(senderPhoneNumber);
    }
}

module.exports = { handleRegistrationFlow };