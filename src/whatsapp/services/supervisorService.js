const prisma = require('../../../config/prisma');

async function handleSupervisorCommand(sock, rawJid, senderPhoneNumber, incomingText, tenantId) {
    const checkSvp = await prisma.user.findFirst({ 
        where: { phoneNumber: senderPhoneNumber, role: 'SVP', tenantId: tenantId } 
    });
    
    if (!checkSvp || !incomingText.toUpperCase().startsWith('ASSIGN')) return false;

    const parts = incomingText.split(' '); 
    const targetCustomerPhone = parts[1];
    const targetSalesId = parts[2];

    if (!targetCustomerPhone || !targetSalesId) {
        await sock.sendMessage(rawJid, { text: "⚠️ Format salah. Gunakan format: *ASSIGN [No_HP_Pelanggan] [ID_Sales]*" });
        return true;
    }

    const selectedSales = await prisma.user.findFirst({ 
        where: { id: targetSalesId, tenantId: tenantId, role: 'SALES' } 
    });
    
    if (!selectedSales) {
        await sock.sendMessage(rawJid, { text: `⚠️ Gagal. Sales dengan ID tersebut tidak ditemukan di sistem bisnis Anda.` });
        return true;
    }

    const updatedLead = await prisma.lead.update({
        where: { tenantId_phoneNumber: { tenantId, phoneNumber: targetCustomerPhone } },
        data: { assignedToSalesId: targetSalesId, status: "ASSIGNED_TO_SALES" }
    });

    await sock.sendMessage(rawJid, { text: `✅ *ALOKASI BERHASIL!*\n\nLead pelanggan +${targetCustomerPhone} resmi ditugaskan kepada *${selectedSales.name}*.` });

    const salesJid = `${selectedSales.phoneNumber}@s.whatsapp.net`;
    const messageToSales = `💼 *TUGAS BARU (CRM LEADS)* 💼\n\n` +
          `Halo *${selectedSales.name}*, Anda mendapatkan limpahan data prospek pelanggan baru dari Supervisor:\n\n` +
          `• *Nama Pelanggan:* ${updatedLead.customerName || '-'}\n` +
          `• *Nomor Kontak:* +${updatedLead.phoneNumber}\n` +
          `• *Lokasi/Alamat:* ${updatedLead.address || '-'}\n` +
          `• *Kategori Layanan/Produk:* ${updatedLead.category || '-'}\n` +
          `• *Detail Kebutuhan/Kustomisasi:* ${updatedLead.specification || '-'}\n` +
          `👉 *Catatan Tambahan:* Segera hubungi pelanggan di atas untuk melakukan konfirmasi penjualan dan negosiasi lebih lanjut!`;
          
    await sock.sendMessage(salesJid, { text: messageToSales });
    return true; // Perintah berhasil dieksekusi
}

module.exports = { handleSupervisorCommand };