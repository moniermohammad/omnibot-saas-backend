const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function getMyCalendarService({ tenantId, role, currentUserId, page, limit, search }) {
  // 1. Hitung jumlah baris data yang harus dilewati oleh database (skip)
  const skip = (page - 1) * limit;

  // 2. Susun kriteria filter database dasar (Isolasi Multi-Tenant)
  const whereCondition = {
    tenantId: tenantId,
  };

  // 🔐 Security Filter: Jika role SALES, kunci agar HANYA bisa lihat lead miliknya sendiri
  if (role === "SALES" || role === "sales") {
    whereCondition.assignedToSalesId = currentUserId;
  }

  // 🔍 Search Filter: Pencarian fleksibel berdasarkan nama lead ATAU catatan di agenda mereka
  if (search) {
    whereCondition.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive", // Kebal perbedaan huruf besar/kecil (Agus, agus, AGUS)
        },
      },
      {
        schedules: {
          some: {
            title: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
      },
    ];
  }

  try {
    // 3. Jalankan Transaksi Paralel: Ambil data potongan + Hitung total baris murni di DB
    const [leads, totalData] = await prisma.$transaction([
      prisma.lead.findMany({
        where: whereCondition,
        take: limit, // Batasi jumlah data yang ditarik (Misal: 10 data)
        skip: skip,  // Lewati data halaman sebelumnya
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
        orderBy: { 
          createdAt: "desc" 
        }, // Leads terbaru selalu di atas
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
    console.error("🚨 [Calendar Service] Gagal memuat pagination leads:", error.message);
    throw error;
  }
}

// 🌟 PERBAIKAN UTAMA: Sesuaikan nama fungsi yang di-export agar pas dengan perubahan di Controller sebelumnya!
module.exports = { getAllmyCalendar: getMyCalendarService };
