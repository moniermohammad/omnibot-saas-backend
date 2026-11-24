const prisma = require("../../config/prisma");
const { createLeadService, getAllLeadsService, getLeadByIdService, deleteLeadService, updateLeadService } = require("../services/crmService");

/**
 * 1. Ambil semua Leads terisolasi dinamis dengan Pagination & Search untuk Dashboard Flutter/Web
 * GET /api/crm/leads?page=1&limit=10&search=budi
 */
async function getAllLeads(req, res) {
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

    // 2. Panggil Layer Service dengan menyisipkan parameter baru (page, limit, search)
    // Layer service Anda nanti bertugas memotong datanya menggunakan kueri Prisma (take, skip, contains)
    const { leads, pagination } = await getAllLeadsService({
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
    console.error("🚨 Error pada getAllLeads Controller:", error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return res.status(500).json({
      success: false,
      message: "⚠️ Gagal memuat data leads dashboard dari server.",
    });
  }
}

/**
 * GET /api/crm/leads/:id
 */
async function getLeadById(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;
    const currentUserId = req.user?.id || req.user?.userId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "⚠️ Sesi tidak valid. Tenant ID tidak ditemukan.",
      });
    }

    // Panggil Service Layer
    const leadData = await getLeadByIdService({
      leadId: id,
      tenantId,
      role,
      currentUserId,
    });

    return res.status(200).json({
      success: true,
      message: `🎉 Berhasil memuat detail data lead untuk role ${role}`,
      data: leadData,
    });
  } catch (error) {
    console.error("🚨 Error pada getLeadById Controller:", error);

    // Tangkap custom error (seperti 404 dari service)
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "⚠️ Gagal memuat detail data lead dari server.",
    });
  }
}

/**
 * ENDPOINT: Create New leads (POST /api/crm/schedules)
 */
async function createLead(req, res) {
  try {
    // 1. Ekstrak identitas penginput (dari JWT atau x-bot-tenant-key)
    const tenantId = req.user?.tenantId || req.tenant?.tenantId;
    const userRole = req.user?.role || null; // OWNER, ADMIN, SALES, atau null (Bot)
    const loggedInUserId = req.user?.id || req.user?.userId || null;

    const { phone, status, sourceLeads, nama_lengkap, assignedToSalesId, ...fieldsLainnya } = req.body;

    // Validasi Tenant ID
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "⚠️ Sesi tidak valid. Tenant ID tidak ditemukan." });
    }

    // Validasi Nomor HP
    if (!phone) {
      return res.status(400).json({ success: false, message: "⚠️ Nomor HP prospek wajib diisi!" });
    }

    // Standarisasi nomor HP ke format 62
    let cleanPhone = phone.replace(/[^0-9]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "62" + cleanPhone.substring(1);
    }

    let finalSalesId = null;
    let targetStatus = "WAITING_ASSIGN";
    let logTitle = "";
    let logDescription = "";

    if (userRole === "OWNER" || userRole === "ADMIN") {
      if (!assignedToSalesId) {
        return res.status(400).json({
          success: false,
          message: "⚠️ Silakan pilih Sales yang bertanggung jawab untuk prospek ini!",
        });
      }

      const targetSales = await prisma.user.findFirst({
        where: {
          userId: assignedToSalesId,
          tenantId: tenantId, // 👈 KUNCI: Harus 1 tenant dengan Admin
          role: "SALES",
        },
      });

      if (!targetSales) {
        return res.status(403).json({
          success: false,
          message: "⛔ Akses ditolak! Sales yang Anda pilih tidak ditemukan di perusahaan/tenant Anda.",
        });
      }

      finalSalesId = assignedToSalesId;
      targetStatus = status || "WAITING_SCHEDULE";
      logTitle = "Prospek Dialokasikan oleh Admin";
      logDescription = `Prospek didaftarkan oleh Admin/Owner dan dialokasikan ke ${targetSales.name}. Menunggu pembuatan jadwal follow-up.`;
    } else if (userRole === "SALES") {
      // 👤 SKENARIO SALES: Otomatis terkunci ke ID milik Sales yang sedang login
      finalSalesId = loggedInUserId;
      targetStatus = status || "WAITING_SCHEDULE";
      logTitle = "Prospek Didaftarkan oleh Sales";
      logDescription = "Prospek diinput secara mandiri oleh Sales. Menunggu pembuatan jadwal follow-up.";
    } else {
      // 🤖 SKENARIO BOT CHAT: Dibiarkan null (Menunggu Round Robin)
      finalSalesId = null;
      targetStatus = "WAITING_ASSIGN";
      logTitle = "Registrasi Prospek Baru (Bot)";
      logDescription = "Prospek masuk via Bot Chat. Menunggu antrean / alokasi Sales (Round Robin / Admin).";
    }

    const constructedFormData = {
      nama_lengkap: nama_lengkap || "Tanpa Nama",
      ...fieldsLainnya,
    };

    // =======================================================================
    // 🚀 TRANSACTION PRISMA
    // =======================================================================
    const transactionResult = await prisma.$transaction(async (tx) => {
      // A. Simpan ke tabel LEADS
      const newLead = await tx.lead.create({
        data: {
          tenantId: tenantId,
          phoneNumber: cleanPhone,
          status: targetStatus,
          assignedToSalesId: finalSalesId,
          sourceLeads: sourceLeads || (userRole ? "MANUAL_INPUT" : "WHATSAPP_BOT"),
          formData: constructedFormData,
        },
      });

      // B. Simpan Log Histori awal ke tabel SCHEDULES
      await tx.schedule.create({
        data: {
          tenantId: tenantId,
          leadId: newLead.leadId,
          salesId: finalSalesId,
          eventType: targetStatus,
          outcomeStatus: targetStatus,
          lastStatus: null,
          title: logTitle,
          description: logDescription,
          isUpdated: 0,
          outcomeData: {},
          scheduledAt: new Date(),
        },
      });

      // Fetch ulang data lead beserta relasi sales & schedules
      const fullCreatedLead = await tx.lead.findUnique({
        where: { leadId: newLead.leadId },
        include: {
          sales: {
            select: {
              userId: true,
              name: true,
              phoneNumber: true,
              tenantId: true,
              role: true,
            },
          },
          schedules: {
            orderBy: { scheduledAt: "desc" },
          },
        },
      });

      return fullCreatedLead;
    });

    return res.status(201).json({
      success: true,
      message: `🎉 Prospek baru berhasil didaftarkan dengan status ${targetStatus}.`,
      data: transactionResult,
    });
  } catch (error) {
    console.error("🚨 Error Create Lead di Controller:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "⚠️ Nomor HP prospek ini sudah terdaftar." });
    }
    if (error.code === "P2003") {
      return res.status(422).json({ success: false, message: "⚠️ Gagal menyimpan. Data relasi ID tidak valid." });
    }
    return res.status(500).json({ success: false, message: `⚠️ Server Error: ${error.message}` });
  }
}

/**
 * Controller untuk DELETE /api/crm/leads/:id
 */
async function deleteLead(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "⚠️ Sesi tidak valid. Tenant ID tidak ditemukan.",
      });
    }

    // Panggil Service Layer
    await deleteLeadService({
      leadId: id,
      tenantId,
      role,
    });

    return res.status(200).json({
      success: true,
      message: "🗑️ Data prospek berhasil dihapus dari sistem secara permanen!",
    });
  } catch (error) {
    console.error("🚨 Error Delete Lead Controller:", error);

    // Tangkap Custom Error (403 Forbidden atau 404 Not Found dari Service)
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      message: "⚠️ Terjadi kesalahan internal server saat mencoba menghapus data.",
    });
  }
}

/**
 * Controller untuk PUT /api/crm/leads/:id
 */
async function updatedLead(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "⚠️ Sesi tidak valid. Tenant ID tidak ditemukan.",
      });
    }

    // Panggil Service Layer
    const updatedResult = await updateLeadService({
      leadId: id,
      tenantId,
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: `🎉 Status berhasil diperbarui menjadi ${updatedResult.status}.`,
      data: updatedResult,
    });
  } catch (error) {
    console.error("🚨 Error Update Lead Controller:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "⚠️ Gagal memperbarui data prospek.",
    });
  }
}

/**
 * Controller untuk PUT /api/crm/leads/asign/:id
 */
async function addAsignLead(req, res) {
  try {
    const { id: leadId } = req.params;
    const { scheduleId, assignedToSalesId } = req.body; // Unpack dari request body
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "⚠️ Sesi tidak valid. Tenant ID tidak ditemukan.",
      });
    }

    // Panggil Service dengan parameter eksplisit
    const updatedResult = await addAsignLeadService({
      leadId,
      scheduleId,
      assignedToSalesId,
      tenantId,
    });

    return res.status(200).json({
      success: true,
      message: `🎉 Sales penanggung jawab pada Header Lead & History Schedule berhasil diperbarui ke ${updatedResult.sales?.name || "Sales Baru"}.`,
      data: updatedResult,
    });
  } catch (error) {
    console.error("🚨 Error Assign Sales Controller:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "⚠️ Gagal memperbarui penanggung jawab sales pada prospek & history.",
    });
  }
}

/**
 * Controller untuk POST /api/crm/schedules
 */
async function createSchedule(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const salesId = req.user?.id || req.user?.userId;
    const { leadId, eventType, title, description, scheduledAt } = req.body;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "⚠️ Sesi tidak valid. Tenant ID tidak ditemukan.",
      });
    }
    // Panggil Service dengan Parameter Eksplisit
    const newSchedule = await createScheduleService({
      leadId,
      eventType,
      title,
      description,
      scheduledAt,
      tenantId,
      salesId,
    });
    return res.status(201).json({
      success: true,
      message: "🎉 Jadwal aktivitas berhasil disimpan & status prospek diperbarui menjadi FOLLOW_UP.",
      data: newSchedule,
    });
  } catch (error) {
    console.error("🚨 Error Create Schedule Controller:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "⚠️ Gangguan server saat menyimpan jadwal.",
    });
  }
}

/**================================================================================================
 * ENDPOINT: Membuat Jadwal Aktivitas Baru (GET /api/crm/schedules)
 */
async function getSchedules(req, res) {
  try {
    const { tenantId, userId: salesId, role } = req.user;

    // Saring jatah data berdasarkan tingkatan Hak Akses (Role)
    let queryFilter = { tenantId: tenantId };

    if (role === "SALES") {
      queryFilter.salesId = salesId;
    }

    const schedules = await prisma.schedule.findMany({
      where: queryFilter,
      include: {
        lead: {
          // 🌟 PERBAIKAN MUTLAK: Seleksi field baru yang terstruktur
          select: { leadId: true, phoneNumber: true, formData: true },
        },
      },
      orderBy: { scheduledAt: "asc" }, // Urutkan dari jadwal terdekat
    });

    return res.status(200).json({ success: true, data: schedules });
  } catch (error) {
    console.error("🚨 Error Fetch Schedules:", error);
    return res.status(500).json({ success: false, message: "⚠️ Gagal memuat daftar kalender jadwal dari server." });
  }
}

/**
 * 2. Fitur Tim Lapangan: Mengubah status Leads (WON / LOST / FOLLOW_UP)
 * PUT /api/crm/leads/:id
 */
const updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { tenantId, role, userId } = req.user;

    if (!status) {
      return res.status(400).json({ success: false, message: "⚠️ Status baru wajib disertakan!" });
    }

    // 1. CARI DATA: Pastikan lead ada dan terkunci di dalam Tenant perusahaan yang sama
    // 🌟 PERBAIKAN: id diubah menjadi leadId sesuai schema baru
    const checkLead = await prisma.lead.findFirst({
      where: {
        leadId: id,
        tenantId: tenantId,
      },
    });

    if (!checkLead) {
      return res.status(404).json({ success: false, message: "❌ Data pelanggan tidak ditemukan di sistem bisnis Anda." });
    }

    // 2. PRIVILEGE CHECK: Batasi sales agar tidak bisa mengedit status jatah sales lain
    if (role === "SALES" && checkLead.assignedToSalesId !== userId) {
      return res.status(403).json({ success: false, message: "🔒 Akses ditolak! Anda tidak berwenang merubah status pelanggan milik sales agen lain." });
    }

    // 3. EKSEKUSI UPDATE STATUS
    // 🌟 PERBAIKAN: id diubah menjadi leadId sesuai schema baru
    const updatedLead = await prisma.lead.update({
      where: { leadId: id },
      data: { status: status },
    });

    return res.status(200).json({
      success: true,
      message: `✅ Status berhasil diperbarui menjadi ${status}.`,
      data: updatedLead,
    });
  } catch (error) {
    console.error("🚨 Eror updateLeadStatus Controller:", error);
    return res.status(500).json({ success: false, message: "Gagal memperbarui status data pelanggan di database." });
  }
};

// 🌟 Jangan lupa masukkan 'updateLeadStatus' ke bagian module.exports di paling bawah file!
module.exports = {
  getAllLeads,
  updatedLead,
  createSchedule,
  getSchedules,
  createLead,
  deleteLead,
  getLeadById,
};
