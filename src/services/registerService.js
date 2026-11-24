const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Service untuk menangani proses Registrasi Tenant (Bisnis Baru) & Owner
 */
const crypto = require("crypto");

// Menghasilkan kode unik format: OB-MOT-4821
function generateTenantCode(businessName = "") {
  const cleanLetters = businessName.replace(/[^a-zA-Z]/g, "").toUpperCase();
  const bizInitial = (cleanLetters.slice(0, 3) || "BIZ").padEnd(3, "X");
  const randomDigits = crypto.randomInt(1000, 10000);
  return `OMB-${bizInitial}-${randomDigits}`;
}

async function registerTenantService({ businessName, ownerName, ownerPhone, businessType }) {
  // 1. Validasi Input Dasar
  if (!businessName || !ownerName || !ownerPhone) {
    throw {
      statusCode: 400,
      message: "⚠️ Nama bisnis, nama lengkap, dan nomor HP wajib diisi!",
    };
  }

  // 2. Format / Bersihkan Nomor HP (Sering 0 diubah menjadi 62)
  let cleanPhone = ownerPhone.replace(/[^0-9]/g, "");
  if (cleanPhone.startsWith("0")) {
    cleanPhone = "62" + cleanPhone.substring(1);
  }

  try {
    // 3. Jalankan Prisma Transaction agar Tenant & Owner sukses bersamaan
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const trialDuration = new Date();
      trialDuration.setDate(now.getDate() + 14); // Otomatis memberikan masa Free Trial 14 hari

      // Buat kode unik OB-XXX-0000 dan pastikan belum dipakai di database
      let tenantCode = generateTenantCode(businessName);
      let existingCode = await tx.tenant.findUnique({ where: { tenantCode } });
      while (existingCode) {
        tenantCode = generateTenantCode(businessName);
        existingCode = await tx.tenant.findUnique({ where: { tenantCode } });
      }

      // A. Masukkan data ke tabel Tenant (Bisnis)
      const newTenant = await tx.tenant.create({
        data: {
          tenantCode, // <-- Tersimpan otomatis dalam format OB-XXX-0000
          businessName: businessName.trim(),
          businessType,
          status: "FREE_TRIAL",
          tenantType: "PERSONAL",
          subscriptionStart: now,
          subscriptionEnd: trialDuration,
        },
      });

      // B. Masukkan data ke tabel User (Role: OWNER)
      const newOwner = await tx.user.create({
        data: {
          tenantId: newTenant.tenantId,
          name: ownerName.trim(),
          phoneNumber: cleanPhone,
          role: "OWNER",
        },
      });

      return {
        tenant: newTenant,
        owner: newOwner,
      };
    });
  } catch (error) {
    // Tangkap Error Spesifik Prisma: Unique Constraint (P2002) untuk Nomor HP yang sudah terdaftar
    if (error.code === "P2002") {
      throw {
        statusCode: 409,
        message: "❌ Nomor HP/WA ini sudah terdaftar di sistem bisnis lain.",
      };
    }

    // Throw error umum ke controller jika ada masalah lain
    throw error;
  }
}

// async function registerTenantService({ businessName, ownerName, ownerPhone, businessType }) {
//   // 1. Validasi Input Dasar
//   if (!businessName || !ownerName || !ownerPhone) {
//     throw {
//       statusCode: 400,
//       message: "⚠️ Nama bisnis, nama lengkap, dan nomor HP wajib diisi!",
//     };
//   }

//   // 2. Format / Bersihkan Nomor HP (Sering 0 diubah menjadi 62)
//   let cleanPhone = ownerPhone.replace(/[^0-9]/g, "");
//   if (cleanPhone.startsWith("0")) {
//     cleanPhone = "62" + cleanPhone.substring(1);
//   }

//   try {
//     // 3. Jalankan Prisma Transaction agar Tenant & Owner sukses bersamaan
//     return await prisma.$transaction(async (tx) => {
//       const now = new Date();
//       const trialDuration = new Date();
//       trialDuration.setDate(now.getDate() + 14); // Otomatis memberikan masa Free Trial 14 hari

//       // A. Masukkan data ke tabel Tenant (Bisnis)
//       const newTenant = await tx.tenant.create({
//         data: {
//           businessName,
//           businessType,
//           status: "FREE_TRIAL",
//           tenantType: "PERSONAL",
//           subscriptionStart: now,
//           subscriptionEnd: trialDuration,
//         },
//       });

//       // B. Masukkan data ke tabel User (Role: OWNER)
//       const newOwner = await tx.user.create({
//         data: {
//           tenantId: newTenant.tenantId,
//           name: ownerName,
//           phoneNumber: cleanPhone,
//           role: "OWNER",
//         },
//       });

//       return {
//         tenant: newTenant,
//         owner: newOwner,
//       };
//     });
//   } catch (error) {
//     // Tangkap Error Spesifik Prisma: Unique Constraint (P2002) untuk Nomor HP yang sudah terdaftar
//     if (error.code === "P2002") {
//       throw {
//         statusCode: 409,
//         message: "❌ Nomor HP/WA ini sudah terdaftar di sistem bisnis lain.",
//       };
//     }

//     // Throw error umum ke controller jika ada masalah lain
//     throw error;
//   }
// }

module.exports = {
  registerTenantService,
};
