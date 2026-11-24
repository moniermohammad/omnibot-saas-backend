const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("⚡ Mendaftarkan ID MASTER_SYSTEM ke database PostgreSQL...");

  // Tentukan durasi aktif sistem internal (10 tahun)
  const endDate = new Date();
  endDate.setFullYear(endDate.getFullYear() + 10);

  await prisma.tenant.upsert({
    where: { tenantId: "MASTER_SYSTEM" },
    update: {},
    create: {
      tenantId: "MASTER_SYSTEM",
      businessName: "SaaS CRM Master System Internal",
      businessType: "INTERNAL_BOT",
      waNumber: "6285177868126", // Sesuaikan dengan nomor Master Bot Anda
      status: "ACTIVE",
      tenantType: "ENTERPRISE",
      subscriptionEnd: endDate,
    },
  });

  console.log("🎉 SUCCESS: ID [MASTER_SYSTEM] resmi terdaftar! Database siap menerima session token.");
}

main()
  .catch((e) => console.error("❌ Gagal mendaftarkan:", e))
  .finally(() => prisma.$disconnect());
