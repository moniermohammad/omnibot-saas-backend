const prisma = require("../../config/prisma");
// 🌟 PERBAIKAN 1: Berikan alias (nama lain) pada fungsi service agar tidak bentrok dengan nama fungsi controller
const calendarService = require("../services/calendarService");

/**
 * 1. Ambil semua Leads mycaledar berdasarkan hak akses
 */
async function getAllmyCalendar(req, res) {
  try {
    // 1. Ambil data user dari JWT token middleware
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;
    const currentUserId = req.user?.id || req.user?.userId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "⚠️ Sesi tidak valid. Tenant ID tidak ditemukan.",
      });
    }

    // 🚀 PERBAIKAN UTAMA: Tangkap parameter pagination dan pencarian dari query string URL
    const page = parseInt(req.query.page) || 1; // Default ke halaman 1 jika tidak dikirim
    const limit = parseInt(req.query.limit) || 10; // Default ambil 10 data per halaman
    const search = req.query.search ? req.query.search.toString().trim() : ""; // Teks kata kunci cari nama

    // 🌟 PERBAIKAN 2: Panggil fungsi dari objek service yang benar (bukan memanggil fungsi ini lagi)
    const { leads, pagination } = await calendarService.getAllmyCalendar({
      tenantId,
      role,
      currentUserId,
      page,
      limit,
      search,
    });

    // 3. Kembalikan Response lengkap dengan metadata pagination yang sangat disukai developer Flutter
    return res.status(200).json({
      success: true,
      message: `🎉 Berhasil memuat data leads halaman ${page} untuk role ${role}`,
      data: leads, // Berisi 10 data leads spesifik yang sudah dipotong database
      pagination: pagination, // Berisi info totalData, currentPage, totalPages, dan limit
    });
  } catch (error) {
    // 🌟 PERBAIKAN 3: Ubah log agar sesuai dengan nama fungsi controller saat ini
    console.error("🚨 Error pada getAllmyCalendar Controller:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }

    return res.status(500).json({
      success: false,
      message: "⚠️ Gagal memuat data leads dashboard dari server.",
    });
  }
}

module.exports = { getAllmyCalendar };
