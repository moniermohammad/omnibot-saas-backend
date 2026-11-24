// src/services/crmService.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Service untuk Mengambil Detail Single Lead berdasarkan ID, Tenant, dan Role
 */
async function getLeadByIdService({ leadId, tenantId, role, currentUserId }) {
  const whereCondition = {
    leadId: leadId,
    tenantId: tenantId,
  };

  if (role === "SALES") {
    whereCondition.assignedToSalesId = currentUserId;
  }

  // 2. Query ke Prisma
  const leadData = await prisma.lead.findFirst({
    where: whereCondition,
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
        orderBy: {
          scheduledAt: "desc",
        },
      },
    },
  });

  if (!leadData) {
    throw {
      statusCode: 404,
      message: "⚠️ Data prospek tidak ditemukan.",
    };
  }
  return leadData;
}

/**
 * Service untuk Mengambil Seluruh Data Leads dengan Dukungan Pagination & Pencarian Nama
 */
async function getAllLeadsService({ tenantId, role, currentUserId, page, limit, search }) {
  // 1. Hitung jumlah baris data yang harus dilewati oleh PostgreSQL
  const skip = (page - 1) * limit;
  // 2. Susun kriteria filter database dasar (Isolasi Multi-Tenant)
  const whereCondition = {
    tenantId: tenantId,
  };

  // 🔒 Security Filter: Jika role SALES, kunci agar HANYA bisa lihat lead miliknya sendiri
  // Disinkronkan dengan nama field kolom asli Anda: assignedToSalesId
  if (role === "SALES" || role === "sales") {
    whereCondition.assignedToSalesId = currentUserId;
  }

  // 🔍 Search Filter: Jika ada ketikan kata kunci dari aplikasi mobile Flutter
  if (search) {
    whereCondition.name = {
      contains: search,
      mode: "insensitive", // Kebal dari perbedaan huruf besar/kecil (Agus, agus, AGUS sama saja)
    };
  }

  try {
    // 3. Jalankan Transaksi Paralel: Ambil data potongan + Hitung total baris murni di DB
    const [leads, totalData] = await prisma.$transaction([
      prisma.lead.findMany({
        where: whereCondition,
        take: limit, // Batasi jumlah data yang ditarik (Misal: 10 data)
        skip: skip, // Lewati data halaman sebelumnya
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
            orderBy: {
              scheduledAt: "desc",
            },
          },
        },
        orderBy: { createdAt: "desc" }, // Leads terbaru selalu di atas
      }),
      prisma.lead.count({
        where: whereCondition, // Menghitung total leads asli untuk info total halaman di Flutter
      }),
    ]);

    // 4. Hitung total halaman tersedia secara matematis pembulatan ke atas
    const totalPages = Math.ceil(totalData / limit);

    // Kembalikan objek data ganda ke Controller
    return {
      leads,
      pagination: {
        totalData,
        currentPage: page,
        totalPages,
        limit,
      },
    };
  } catch (error) {
    console.error("🚨 [Lead Service] Gagal memuat pagination leads:", error.message);
    throw error;
  }
}

/**
 * Service untuk Mendaftarkan Lead/Prospek Baru
 */
async function createLeadService(payload) {
  const { tenantId, userRole, loggedInUserId, phone, status, sourceLeads, nama_lengkap, assignedToSalesId, ...fieldsLainnya } = payload;

  // 1. Standarisasi Nomor HP ke format 62
  let cleanPhone = phone.replace(/[^0-9]/g, "");
  if (cleanPhone.startsWith("0")) {
    cleanPhone = "62" + cleanPhone.substring(1);
  }

  let finalSalesId = null;
  let targetStatus = "WAITING_ASSIGN";
  let logTitle = "";
  let logDescription = "";

  // 2. LOGIKA BISNIS & BENTENG KEAMANAN MULTI-TENANT
  if (userRole === "OWNER" || userRole === "ADMIN") {
    // 🛑 Admin wajib memilih Sales
    if (!assignedToSalesId) {
      throw { statusCode: 400, message: "⚠️ Silakan pilih Sales yang bertanggung jawab untuk prospek ini!" };
    }

    // 🔒 Cek apakah Sales benar-benar milik Tenant ini
    const targetSales = await prisma.user.findFirst({
      where: {
        userId: assignedToSalesId,
        tenantId: tenantId,
        role: "SALES",
      },
    });

    if (!targetSales) {
      throw { statusCode: 403, message: "⛔ Akses ditolak! Sales tidak ditemukan di perusahaan/tenant Anda." };
    }

    finalSalesId = assignedToSalesId;
    targetStatus = status || "WAITING_SCHEDULE";
    logTitle = "Prospek Dialokasikan oleh Admin";
    logDescription = `Prospek didaftarkan oleh Admin/Owner dan dialokasikan ke ${targetSales.name}. Menunggu pembuatan jadwal follow-up.`;
  } else if (userRole === "SALES") {
    // 👤 Sales menginput prospek miliknya sendiri
    finalSalesId = loggedInUserId;
    targetStatus = status || "WAITING_SCHEDULE";
    logTitle = "Prospek Didaftarkan oleh Sales";
    logDescription = "Prospek diinput secara mandiri oleh Sales. Menunggu pembuatan jadwal follow-up.";
  } else {
    // 🤖 Prospek masuk via Bot WhatsApp
    finalSalesId = null;
    targetStatus = "WAITING_ASSIGN";
    logTitle = "Registrasi Prospek Baru (Bot)";
    logDescription = "Prospek masuk via Bot Chat. Menunggu antrean / alokasi Sales (Round Robin / Admin).";
  }

  const constructedFormData = {
    nama_lengkap: nama_lengkap || "Tanpa Nama",
    ...fieldsLainnya,
  };

  // 3. TRANSAKSI DATABASE PRISMA
  return await prisma.$transaction(async (tx) => {
    // A. Simpan Lead Baru
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

    // B. Simpan Log Histori awal ke Schedule
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

    // C. Fetch Ulang Data Lengkap beserta Relasi
    return await tx.lead.findUnique({
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
  });
}

/**
 * Service untuk Menghapus Lead secara permanen (Soft/Hard Delete)
 */
async function deleteLeadService({ leadId, tenantId, role }) {
  // 🔒 1. PROTEKSI HAK AKSES ROLE
  if (role !== "OWNER" && role !== "ADMIN") {
    throw {
      statusCode: 403,
      message: "❌ Hak akses ditolak! Hanya Admin atau Owner yang diizinkan menghapus data prospek.",
    };
  }

  // 🔍 2. CEK EKSISTENSI DATA & ISOLASI TENANT
  const existingLead = await prisma.lead.findUnique({
    where: { leadId: leadId },
  });

  if (!existingLead || existingLead.tenantId !== tenantId) {
    throw {
      statusCode: 404,
      message: "⚠️ Data prospek tidak ditemukan atau Anda tidak memiliki hak akses.",
    };
  }

  // 🗑️ 3. EKSEKUSI PENGHAPUSAN
  return await prisma.lead.delete({
    where: { leadId: leadId },
  });
}

/**
 * Service untuk Memperbarui Data Lead (Update Status, Sales, & Dynamic Form Data)
 */
async function updateLeadService({ leadId, tenantId, payload }) {
  const { status, assignedToSalesId, ...fieldsLainnya } = payload;

  // 1. Cari data lama di database untuk cek eksistensi & isolasi Multi-Tenant
  const existingLead = await prisma.lead.findUnique({
    where: { leadId: leadId },
  });

  if (!existingLead || existingLead.tenantId !== tenantId) {
    throw {
      statusCode: 404,
      message: "⚠️ Data prospek tidak ditemukan atau Anda tidak memiliki hak akses.",
    };
  }

  // 2. Gabungkan JSON formData secara dinamis
  const oldFormData = existingLead.formData || {};
  const updatedFormData = {
    ...oldFormData, // Pertahankan data lama
    ...fieldsLainnya, // Overwrite dengan field-field baru dari request
  };

  // 3. Eksekusi pembaruan ke PostgreSQL via Prisma
  return await prisma.lead.update({
    where: { leadId: leadId },
    data: {
      status: status && status.trim() !== "" ? status : existingLead.status,
      assignedToSalesId: assignedToSalesId !== undefined ? assignedToSalesId : existingLead.assignedToSalesId,
      formData: updatedFormData,
    },
  });
}

/**
 * Service untuk Re-assign Sales pada Header (Lead) dan History (Schedule)
 */
async function addAsignLeadService({ leadId, scheduleId, assignedToSalesId, tenantId }) {
  // 1. Validasi Input Parameter Langsung
  if (!assignedToSalesId) {
    throw { statusCode: 400, message: "⚠️ ID Sales penanggung jawab baru wajib diisi!" };
  }

  if (!scheduleId) {
    throw { statusCode: 400, message: "⚠️ ID History Schedule wajib diisi!" };
  }

  // 2. Cek Eksistensi Header Lead & Proteksi Tenant ID
  const existingLead = await prisma.lead.findUnique({
    where: { leadId },
  });

  if (!existingLead || existingLead.tenantId !== tenantId) {
    throw {
      statusCode: 404,
      message: "⚠️ Data header prospek tidak ditemukan atau Anda tidak memiliki hak akses.",
    };
  }

  // 3. Cek Eksistensi History Schedule pada Lead ini
  const existingSchedule = await prisma.schedule.findFirst({
    where: {
      scheduleId,
      leadId,
      tenantId,
    },
  });

  if (!existingSchedule) {
    throw {
      statusCode: 404,
      message: "⚠️ Data history schedule tidak ditemukan pada prospek ini.",
    };
  }

  // 🔒 4. Validasi Sales Baru di Perusahaan/Tenant yang Sama
  const targetSales = await prisma.user.findFirst({
    where: {
      userId: assignedToSalesId,
      tenantId,
      role: "SALES",
    },
  });

  if (!targetSales) {
    throw {
      statusCode: 403,
      message: "⛔ Sales tidak ditemukan atau tidak terdaftar di perusahaan Anda.",
    };
  }

  // 5. Transaksi Database (Atomic Transaction)
  return await prisma.$transaction(async (tx) => {
    // A. Update Penanggung Jawab di Header (Tabel Lead)
    await tx.lead.update({
      where: { leadId },
      data: { assignedToSalesId },
    });

    // B. Update Sales ID di History Aktivitas (Tabel Schedule)
    await tx.schedule.update({
      where: { scheduleId },
      data: { salesId: assignedToSalesId },
    });

    // C. Return Data Header Lead + Schedules Terbaru
    return await tx.lead.findUnique({
      where: { leadId },
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
  });
}

/**
 * Service untuk Membuat Schedule Baru + Otomatis Update Status Lead ke FOLLOW_UP
 */
async function createScheduleService({ leadId, eventType, title, description, scheduledAt, tenantId, salesId }) {
  // 1. Validasi Input Parameter
  if (!leadId || !eventType || !title || !scheduledAt) {
    throw {
      statusCode: 400,
      message: "⚠️ Data jadwal tidak lengkap!",
    };
  }

  // 2. Cek Apakah Header Lead Ada & Milik Tenant yang Sama
  const leadCheck = await prisma.lead.findFirst({
    where: {
      leadId: leadId,
      tenantId: tenantId, // 🔐 Isolasi Multi-Tenant
    },
  });

  if (!leadCheck) {
    throw {
      statusCode: 404,
      message: "❌ Data pelanggan tidak valid atau berada di luar grup bisnis perusahaan Anda.",
    };
  }

  // 3. Transaksi Database Atomic (Buat Schedule + Update Status Lead)
  return await prisma.$transaction(async (tx) => {
    // A. Buat record Schedule baru (History)
    const newSchedule = await tx.schedule.create({
      data: {
        tenantId,
        leadId,
        salesId,
        eventType,
        title,
        description,
        scheduledAt: new Date(scheduledAt),
      },
    });

    // B. Otomatis Update Status Header (Lead) menjadi FOLLOW_UP
    await tx.lead.update({
      where: { leadId: leadId },
      data: { status: "FOLLOW_UP" },
    });

    return newSchedule;
  });
}

module.exports = {
  createLeadService,
  getAllLeadsService,
  getLeadByIdService,
  deleteLeadService,
  updateLeadService,
  addAsignLeadService,
  createScheduleService,
};
