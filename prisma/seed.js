const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const prisma = new PrismaClient();

async function main() {
  console.log("🚀 Memulai seeding data Master Template Chatbot Dinamis Multi-Tenant...");

  // 1. Bersihkan data lama dengan urutan yang aman (child -> parent)
  console.log("🧹 Memproses pembersihan data lama...");
  await prisma.quotationItem.deleteMany({});
  await prisma.quotation.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.schedule.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.botSession.deleteMany({});
  await prisma.botOption.deleteMany({});
  await prisma.botNode.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  // 2. Tentukan Durasi Sewa Master Template (10 Tahun Ke Depan)
  const startDate = new Date();
  const endDate = new Date();
  endDate.setFullYear(startDate.getFullYear() + 10);

  // 3. Buat Master Tenant Utamanya
  const MASTER_TEMPLATE_ID = "MASTER-TEMPLATE-0000-0000-000000000000";
  const masterTenant = await prisma.tenant.create({
    data: {
      tenantId: MASTER_TEMPLATE_ID,
      businessName: "CETAKAN MASTER TEMPLATE UNIVERSAL",
      waNumber: "MASTER_TEMPLATE",
      status: "ACTIVE",
      tenantType: "ENTERPRISE",
      businessType: "SYSTEM_TEMPLATE",
      address: "SaaS Central Cloud System Server",
      keyBotTenant: crypto.randomUUID(),
      subscriptionStart: startDate,
      subscriptionEnd: endDate,
    },
  });
  console.log(`✅ Tenant Master Terbuat | keyBotTenant: ${masterTenant.keyBotTenant}`);

  // 4. Tambahkan Contoh User Tim Sales Lapangan
  const SAMPLE_SALES_ID = "SALES-DEMO-0000-0000-000000000000";
  const sampleSales = await prisma.user.create({
    data: {
      userId: SAMPLE_SALES_ID,
      tenantId: masterTenant.tenantId,
      name: "Budi Tim Sales Lapangan",
      phoneNumber: "6289999999999",
      role: "SALES",
    },
  });

  // ====================================================================
  // 🌟 PROSES SEEDING PERTANYAAN KUESIONER (NODE CHATBOT)
  // ====================================================================
  console.log("🤖 Menyusun alur kuesioner chatbot dinamis...");

  // C. Node Penutup / Finalisasi CRM
  const finalizeNode = await prisma.botNode.create({
    data: {
      nodeId: "FINALIZE_CRM_SIGNAL",
      tenantId: masterTenant.tenantId,
      nodeType: "FINALIZE",
      messageText: "Terima kasih! Data Anda telah kami catat. Tim kami akan segera menghubungi Anda.",
      isFormInput: false,
    },
  });

  // Pertanyaan ke-4 (Kuantitas / Luas)
  const nodeArea = await prisma.botNode.create({
    data: {
      tenantId: masterTenant.tenantId,
      nodeType: "STANDARD",
      messageText: "Berapa perkiraan *Kuantitas / Luas / Jumlah Porsi* yang Anda butuhkan?",
      isFormInput: true,
      saveToField: "kuantitas_atau_luas",
      nextDefaultNodeId: finalizeNode.nodeId,
    },
  });

  // Pertanyaan ke-3 (Spesifikasi / Detail Kendala)
  const nodeLocation = await prisma.botNode.create({
    data: {
      tenantId: masterTenant.tenantId,
      nodeType: "STANDARD",
      messageText: "Tuliskan *Detail Kebutuhan / Tipe Produk / Kendala* Anda secara spesifik:",
      isFormInput: true,
      saveToField: "detail_spesifikasi",
      nextDefaultNodeId: nodeArea.nodeId,
    },
  });

  // Pertanyaan ke-2 (Alamat Lengkap)
  const nodeAddress = await prisma.botNode.create({
    data: {
      tenantId: masterTenant.tenantId,
      nodeType: "STANDARD",
      messageText: "Mohon tuliskan *Alamat Lengkap / Lokasi Wilayah* Anda saat ini:",
      isFormInput: true,
      saveToField: "alamat_lengkap",
      nextDefaultNodeId: nodeLocation.nodeId,
    },
  });

  // Pertanyaan ke-1 (Nama Lengkap)
  const nodeName = await prisma.botNode.create({
    data: {
      tenantId: masterTenant.tenantId,
      nodeType: "STANDARD",
      messageText: "Silahkan bantu kami mengisi formulir.\nSiapa *Nama Lengkap* Anda?",
      isFormInput: true,
      saveToField: "nama_lengkap",
      nextDefaultNodeId: nodeAddress.nodeId,
    },
  });

  // Node Opsi Cabang Sub-Menu
  const nodeEquipment = await prisma.botNode.create({
    data: {
      tenantId: masterTenant.tenantId,
      nodeType: "STANDARD",
      messageText: "Anda memilih *Kategori Pilihan Kedua*.\n\n*Apakah kebutuhan ini akan digunakan untuk:*",
      isFormInput: false,
    },
  });

  // B. Menu Utama (Welcome Node)
  const welcomeNode = await prisma.botNode.create({
    data: {
      tenantId: masterTenant.tenantId,
      nodeType: "WELCOME",
      messageText: "Terima kasih sudah menghubungi kami! Ada yang bisa kami bantu?\n\n*Silahkan pilih opsi menu di bawah ini:*",
      isFormInput: false,
    },
  });

  // Seeding Opsi untuk nodeEquipment & welcomeNode (Dipisah agar relational FK terjamin aman)
  await prisma.botOption.createMany({
    data: [
      // Opsi untuk Node Equipment
      { nodeId: nodeEquipment.nodeId, triggerKey: "1", label: "Konsumsi Sendiri / Retail", nextNodeId: nodeName.nodeId },
      { nodeId: nodeEquipment.nodeId, triggerKey: "2", label: "Kebutuhan Instansi / Perusahaan", nextNodeId: nodeName.nodeId },
      
      // Opsi untuk Welcome Node
      { nodeId: welcomeNode.nodeId, triggerKey: "1", label: "Pemesanan Utama / Order Jasa", nextNodeId: nodeName.nodeId },
      { nodeId: welcomeNode.nodeId, triggerKey: "2", label: "Konsultasi Produk / Layanan Tambahan", nextNodeId: nodeEquipment.nodeId },
      { nodeId: welcomeNode.nodeId, triggerKey: "halo", label: "Sapaan Otomatis", nextNodeId: welcomeNode.nodeId },
    ],
  });

  // ====================================================================
  // 📊 5. SEEDING DATA OPERASIONAL CRM (LEADS & SCHEDULES)
  // ====================================================================
  console.log("📊 Menambahkan data simulasi Lead & Schedule CRM Sales...");

  const SAMPLE_LEAD_ID = "LEAD-DEMO-0000-0000-000000000000";
  const sampleLead = await prisma.lead.create({
    data: {
      leadId: SAMPLE_LEAD_ID,
      tenantId: masterTenant.tenantId,
      phoneNumber: "6281234567890",
      status: "WAITING_SCHEDULE", 
      sourceLeads: "WHATSAPP_BOT",
      assignedToSalesId: sampleSales.userId,
      formData: {
        nama_lengkap: "Andi Wijaya (Customer Demo)",
        alamat_lengkap: "Jl. Jenderal Sudirman No. 45, Jakarta Pusat",
        detail_spesifikasi: "Tertarik paket langganan katering harian kantor isi 50 porsi",
        kuantitas_atau_luas: "50 Kotak / Hari",
      },
    },
  });

  const scheduleDate = new Date();
  scheduleDate.setDate(startDate.getDate() + 2);
  await prisma.schedule.create({
    data: {
      scheduleId: "SCHED-DEMO-0000-0000-000000000000",
      tenantId: masterTenant.tenantId,
      leadId: sampleLead.leadId,
      salesId: sampleSales.userId,
      eventType: "MEETING",
      title: "Meeting Deal & Test Food Katering",
      description: "Datang ke lokasi kantor Pak Andi untuk membawa sampel produk makanan serta negosiasi kontrak harga bulk order.",
      outcomeStatus: "PENDING",
      scheduledAt: scheduleDate,
    },
  });

  // ====================================================================
  // 📦 6. SEEDING DATA PRODUK & PENAWARAN (PRODUCTS & QUOTATIONS)
  // ====================================================================
  console.log("📦 Menambahkan data simulasi Katalog Produk & Surat Penawaran...");

  const productA = await prisma.product.create({
    data: {
      productId: "PROD-DEMO-0001-0000-000000000000",
      tenantId: masterTenant.tenantId,
      productName: "Paket Katering Bulk (Harian)",
      description: "Paket konsumsi premium isi nasi, lauk utama, lauk pendamping, sayur, dan buah.",
      costPrice: 25000.00,
      maxDiscount: 15.00,
      status: "ACTIVE",
    },
  });

  const productB = await prisma.product.create({
    data: {
      productId: "PROD-DEMO-0002-0000-000000000000",
      tenantId: masterTenant.tenantId,
      productName: "Layanan Delivery Logistik Dedicated",
      description: "Biaya pengantaran armada pengiriman tepat waktu langsung ke titik lokasi.",
      costPrice: 150000.00,
      maxDiscount: 5.00,
      status: "ACTIVE",
    },
  });

  const quotation = await prisma.quotation.create({
    data: {
      quotationId: "QUOT-DEMO-0000-0000-000000000000",
      tenantId: masterTenant.tenantId,
      leadId: sampleLead.leadId,
      salesId: sampleSales.userId,
      quotationNo: "QT/TEMPLATE/2026/001",
      totalAmount: 1650000.00,
      status: "DRAFT",
      notes: "Harga penawaran mengikat selama periode trial 30 hari pertama.",
    },
  });

  await prisma.quotationItem.createMany({
    data: [
      {
        quotationItemId: "QTIT-DEMO-0001-0000-000000000000",
        quotationId: quotation.quotationId,
        productId: productA.productId,
        quantity: 50,
        sellingPrice: 35000.00,
        discountGiven: 50000.00,
      },
      {
        quotationItemId: "QTIT-DEMO-0002-0000-000000000000",
        quotationId: quotation.quotationId,
        productId: productB.productId,
        quantity: 1,
        sellingPrice: 150000.00,
        discountGiven: 0.00,
      },
    ],
  });

  console.log("\n✅ [BERHASIL] Seeding Master Configuration, Nodes, Leads, Schedule, Products, dan Quotation selesai!");
}

main()
  .catch((e) => {
    console.error("❌ Gagal melakukan seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });