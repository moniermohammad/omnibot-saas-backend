const prisma = require('../../config/prisma');

/**
 * Mendapatkan semua data pelanggan (Leads) terisolasi per Tenant dan Peran Akun
 * GET /api/leads
 */
const getAllLeads = async (req, res) => {
  try {
    const { tenantId, role, userId } = req.user;

    const whereClause =
      role?.toUpperCase() === 'SALES'
        ? { tenantId, assignedToSalesId: userId }
        : { tenantId };

    const leads = await prisma.lead.findMany({
      where: whereClause,
      include: {
        sales: {
          select: {
            userId: true,
            name: true,
            phoneNumber: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: leads });
  } catch (error) {
    console.error('🚨 Eror getAllLeads Controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat data leads dari server lokal.',
    });
  }
};


/**
 * Mengubah status CRM Lead (Misal: dari WAITING_ASSIGNMENT menjadi WON atau LOST)
 * PUT /api/leads/:id/status
 */
const updateLeadStatus = async (req, res) => {
    try {
        const { id } = req.params; // Mengambil ID bertipe String UUID dari parameter URL Flutter
        const { status } = req.body; // Contoh input JSON body dari Flutter: { "status": "WON" }
        const { tenantId, role, userId } = req.user;

        if (!status) {
            return res.status(400).json({ success: false, message: "⚠️ Status baru wajib disertakan !" });
        }

        // 1. CARI DATA: Pastikan lead yang mau diupdate ada di database dan berada dalam Tenant yang sama
        // 🌟 PERBAIKAN: id diubah menjadi leadId sesuai schema baru
        const checkLead = await prisma.lead.findFirst({
            where: {
                leadId: id,
                tenantId: tenantId
            }
        });

        if (!checkLead) {
            return res.status(404).json({ success: false, message: "❌ Data pelanggan tidak ditemukan di sistem bisnis Anda." });
        }

        // 2. PRIVILEGE CHECK: Jika role-nya SALES, pastikan dia hanya bisa mengubah status lead jatah miliknya sendiri
        if (role === 'SALES' && checkLead.assignedToSalesId !== userId) {
            return res.status(403).json({ success: false, message: "🔒 Akses ditolak! Anda tidak berwenang merubah status pelanggan milik sales agen lain." });
        }

        // 3. EKSEKUSI UPDATE: Lakukan pembaruan status data di PostgreSQL
        // 🌟 PERBAIKAN: id diubah menjadi leadId sesuai schema baru
        const updatedLead = await prisma.lead.update({
            where: { leadId: id }, 
            data: { status: status }
        });

        return res.status(200).json({ 
            success: true, 
            message: `✅ Status berhasil diperbarui menjadi ${status}.`,
            data: updatedLead 
        });

    } catch (error) {
        console.error("🚨 Eror updateLeadStatus Controller:", error);
        return res.status(500).json({ success: false, message: "Gagal memperbarui status data pelanggan." });
    }
};

module.exports = { getAllLeads, updateLeadStatus };