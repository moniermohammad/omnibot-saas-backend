const prisma = require('../../../config/prisma');

/**
 * Mengirimkan ringkasan leads baru ke WhatsApp Supervisor (SVP) dari Tenant yang bersangkutan
 * @param {Object} sock - Instance WhatsApp Socket dari Baileys
 * @param {String} tenantId - UUID Pengikat bisnis klien
 * @param {String} leadId - UUID Data leads/customer yang baru saja selesai mengisi formulir bot
 */
async function sendSupervisorNotification(sock, tenantId, leadId) {
    try {
        // 1. Ambil data lead yang spesifik milik tenant bersangkutan menggunakan Kunci ID Utama UUID
        const finalLead = await prisma.lead.findFirst({ 
            where: { id: leadId, tenantId: tenantId } 
        });
        
        // 2. Cari data Supervisor (SVP) yang terdaftar di dalam bisnis Tenant ini
        const supervisor = await prisma.user.findFirst({ 
            where: { tenantId: tenantId, role: 'SVP' } 
        });

        if (supervisor && finalLead) {
            // 3. AMBIL DAFTAR SALES DINAMIS: Hanya cari sales agen yang terikat di Tenant yang sama
            const activeSales = await prisma.user.findMany({ 
                where: { tenantId: tenantId, role: 'SALES' } 
            });
            
            // Rangkai teks bantuan instruksi pendelegasian tugas sales
            let salesOptionsList = "Silahkan pilih Sales Lapangan untuk menindaklanjuti lead ini dengan mengetik perintah format:\n" +
                                   "*ASSIGN [No_HP_Pelanggan] [ID_Sales]*\n\n" +
                                   "Contoh:\n" +
                                   `_ASSIGN ${finalLead.phoneNumber} ${activeSales[0]?.id || 'ID_SALES'}_\n\n` +
                                   "*Daftar Sales Aktif Perusahaan Anda:*";
            
            // Lakukan looping untuk menyusun list agen sales beserta string ID UUID-nya agar bisa langsung di-copy SPV
            activeSales.forEach(sales => {
                salesOptionsList += `\n\n• *Nama:* ${sales.name} (+${sales.phoneNumber})\n  *ID UUID:* \`${sales.id}\``;
            });

            // 4. Susun pesan laporan dengan label netral yang adaptif untuk segala jenis lini bisnis
            const report = `🚨 *NOTIFIKASI LEAD BARU MASUK (CRM)* 🚨\n\n` +
                `• *Nomor HP Customer:* +${finalLead.phoneNumber}\n` +
                `• *Nama Pelanggan:* ${finalLead.customerName || '-'}\n` +
                `• *Alamat:* ${finalLead.address || '-'}\n` +
                `• *Kategori/Menu:* ${finalLead.category || '-'}\n` +
                `• *Spesifikasi/Rasa:* ${finalLead.specification || '-'}\n` + 
                `• *Jumlah/Luas:* ${finalLead.quantityOrSize || '-'}\n\n` +
                `${salesOptionsList}`;

            // Kirim pesan teks ke nomor WhatsApp pribadi milik Supervisor bersangkutan
            const svpJid = `${supervisor.phoneNumber}@s.whatsapp.net`;
            await sock.sendMessage(svpJid, { text: report });
            
            console.log(`✅ Laporan lead untuk Tenant ${tenantId} sukses dikirim ke SVP +${supervisor.phoneNumber}`);
        } else {
            console.warn(`⚠️ Gagal mengirim notifikasi. Supervisor atau data lead tidak ditemukan pada Tenant ${tenantId}`);
        }
    } catch (error) {
        console.error("❌ Eror fatal pada internal notification.js:", error);
    }
}

module.exports = { 
    sendSupervisorNotification 
};
