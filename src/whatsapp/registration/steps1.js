const prisma = require('../../../config/prisma');

async function askReady(sock, rawJid, senderPhoneNumber) {
    try {
        // Cek apakah data session lama yang menggantung masih ada
        let existingSession = await prisma.botSession.findUnique({
            where: { id: senderPhoneNumber }
        });

        let tenantId;

        if (!existingSession) {
            // 🔑 ANTISIPASI SAAS: Hapus sisa-sisa Tenant lama dengan nomor yang sama jika ada (untuk mencegah Unique Constraint Error)
            try {
                await prisma.tenant.deleteMany({
                    where: { waNumber: senderPhoneNumber }
                });
            } catch (_) {
                // Abaikan jika memang data tenant lamanya tidak ada
            }

            // 1. Buat Tenant penampung awal yang bersih
            const tempTenant = await prisma.tenant.create({
                data: {
                    businessName: "PENDING_REGISTRATION",
                    waNumber: senderPhoneNumber,
                    status: "FREE_TRIAL",
                    subscriptionStart: new Date(),
                    subscriptionEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // Default 14 hari
                }
            });
            tenantId = tempTenant.id;

            // 2. Buat sesi chat baru bawa Tenant ID yang sah
            await prisma.botSession.create({
                data: {
                    id: senderPhoneNumber,
                    tenantId: tenantId,
                    currentNodeId: "REG_ASK_READY"
                }
            });
        } else {
            // Jika sesi ternyata sudah ada di database, cukup reset status alurnya kembali ke awal
            tenantId = existingSession.tenantId;
            await prisma.botSession.update({
                where: { id: senderPhoneNumber },
                data: { currentNodeId: "REG_ASK_READY" }
            });
            
            // Kembalikan nama bisnis ke pending jika mereka mengulang dari awal
            if (tenantId) {
                await prisma.tenant.update({
                    where: { id: tenantId },
                    data: { businessName: "PENDING_REGISTRATION" }
                });
            }
        }

        await sock.sendMessage(rawJid, { 
            text: "👋 Halo! Selamat datang di Layanan SaaS CRM Mobile.\n\nApakah Anda ingin mendaftarkan bisnis Anda ke sistem kami sekarang?\n\nKetik *1* jika YA / SIAP\nKetik *2* jika BATAL / KELUAR (Sapu Bersih Data)" 
        });

    } catch (error) {
        console.error("🚨 Gagal mengeksekusi askReady di steps1:", error);
    }
}

async function inputBusinessName(sock, rawJid, regSession) {
    try {
        await prisma.botSession.update({
            where: { id: regSession.id },
            data: { currentNodeId: "REG_INPUT_BUSINESS_NAME" } // Menandakan user siap mengetik nama bisnis
        });

        await sock.sendMessage(rawJid, { 
            text: "🏢 Langkah 1: Silakan tuliskan *Nama Bisnis / Nama Toko* Anda:\n_(Contoh: Berkah Elektronik / Sales Corp)_" 
        });
    } catch (error) {
        console.error("🚨 Gagal mengeksekusi inputBusinessName di steps1:", error);
    }
}

module.exports = { askReady, inputBusinessName };