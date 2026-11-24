// src/whatsapp/handler.js
const { PrismaClient } = require("@prisma/client");
const { GoogleGenAI } = require("@google/genai");

const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function buildSystemPrompt(botConfig, subject, savedData, remainingFields, isFirstTurn = false) {
  const companyName = botConfig.tenant?.businessName || "Perusahaan Kami";
  const companyProfile = sanitizeDbText(botConfig.openingMessage, companyName);
  const toneStyle = subject.toneStyle || "Ramah dan sopan";

  // Jika kamu punya data produk dari tabel Product, ikutkan sebagai referensi AI
  const productList = (botConfig.tenant?.products || [])
    .map((p) => `- ${p.name}${p.price ? ` (Rp${p.price})` : ""}`)
    .join("\n");

  const collectedEntries = Object.entries(savedData);
  const collectedSummary =
    collectedEntries.length > 0
      ? collectedEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n")
      : "Belum ada data terkumpul.";

  return `
      Kamu adalah Customer Service WhatsApp resmi untuk "${companyName}".
      PROFIL PERUSAHAAN: ${companyProfile}
      ${productList ? `DAFTAR PRODUK TERSEDIA:\n${productList}` : ""}

      LAYANAN YANG DIPILIH: "${subject.name}"
      GAYA BICARA: ${toneStyle}
      ${subject.aiPrompt ? `INSTRUKSI KHUSUS LAYANAN: ${subject.aiPrompt}` : ""}

      DATA PELANGGAN YANG SUDAH TERKUMPUL:
      ${collectedSummary}

      DAFTAR DATA YANG MASIH HARUS DITANYAKAN (BERURUTAN):
      ${remainingFields.length > 0 ? remainingFields.join(", ") : "SEMUA DATA SUDAH LENGKAP"}

      ATURAN WAJIB BALASAN:
      1. ${isFirstTurn ? "Sapa pelanggan dengan sopan sesuai profil perusahaan." : "DILARANG mengulang kata 'Halo', 'Selamat datang', atau menyebut nama pelanggan berulang kali."}
      2. Tanyakan HANYA SATU data paling depan dari daftar yang tersisa. Jangan menggabungkan dua pertanyaan sekaligus.
      3. ATURAN CABANG: Jika data berikutnya bersifat bersyarat (misal mengandung kata "(Jika Perusahaan)") dan pelanggan sebelumnya menjawab "Pribadi", LEWATI pertanyaan itu dan langsung tanyakan data berikutnya.
      4. Jika pelanggan bertanya seputar perusahaan atau produk, jawab singkat terlebih dahulu, lalu lanjutkan menanyakan data yang belum lengkap.
      5. Jangan pernah menuliskan label struktur seperti "Salam Pembuka:" atau "Pesan Penutup:".
      6. Maksimal 2 kalimat pendek agar nyaman dibaca di WhatsApp.
      ${remainingFields.length === 0 ? "7. Semua data sudah lengkap. Ucapkan terima kasih singkat bahwa data akan diteruskan ke tim terkait, lalu akhiri dengan tag [[DATA_COMPLETE]]." : ""}
      `.trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryAskGemini(contents, systemInstruction) {
  if (!process.env.GEMINI_API_KEY) {
    console.error("🚨 [Gemini Config] GEMINI_API_KEY tidak ditemukan di process.env!");
    return null;
  }

  const modelFallbackList = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];

  for (let i = 0; i < modelFallbackList.length; i++) {
    const currentModel = modelFallbackList[i];
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT_4S")), 4000)
      );

      const apiPromise = ai.models.generateContent({
        model: currentModel,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: "minimal", // Lebih cepat & hemat kuota dibanding "low"
          },
        },
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);
      if (response && response.text) {
        return response.text;
      }

      console.warn(`⚠️ [${currentModel}] Response diterima tetapi text kosong.`);
    } catch (err) {
      const status = err?.status;
      console.warn(`⏳ [${currentModel}] Gagal (${status || err?.message}), lanjut ke cadangan...`);

      // Jika masih ada model cadangan di daftar, beri jeda singkat lalu lanjut
      if (i < modelFallbackList.length - 1) {
        await sleep(500);
        continue;
      }

      console.error("🚨 [Gemini Error Detail]:", {
        message: err?.message,
        status,
        code: err?.code,
      });
    }
  }
  return null;
}

function sanitizeDbText(text, fallback = "") {
  if (!text) return fallback;
  return text.replace(/^(salam pembuka|pesan penutup)\s*:?\s*/i, "").trim() || fallback;
}

function isValidInput(text) {
  const clean = text.trim();
  if (clean.length < 1) return false;
  if (/^[^a-zA-Z0-9]+$/.test(clean)) return false;
  if (/[bcdfghjklmnpqrstvwxyz]{6,}/i.test(clean) || /(.)\1{4,}/i.test(clean)) return false;
  return true;
}

// 1. HELPER: Reset sesi pelanggan kembali ke WELCOME
async function resetSessionToWelcome(tenantId, customerPhoneNumber, leadStatusToSet = null) {
  if (leadStatusToSet) {
    await prisma.lead.updateMany({
      where: { tenantId, phoneNumber: customerPhoneNumber, status: "BOT_PROCESS" },
      data: { status: leadStatusToSet },
    });
  }
  return await prisma.botSession.update({
    where: {
      tenantId_customerPhoneNumber: { tenantId, customerPhoneNumber },
    },
    data: { currentNodeId: "WELCOME" },
  });
}

// 4. PINTU MASUK UTAMA
async function handleIncomingMessage(sock, msg, tenantId) {
  if (!msg || !msg.message || msg.key.fromMe) return;
  const rawJid = msg.key.remoteJid;
  if (!rawJid || rawJid === "status@broadcast") return;

  const cleanJidForPhone = msg.key.remoteJidAlt || msg.key.participant || rawJid;
  const senderPhone = cleanJidForPhone.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

  const actualMessage = msg.message?.ephemeralMessage?.message || msg.message;
  const incomingText = (
    actualMessage?.conversation ||
    actualMessage?.extendedTextMessage?.text ||
    ""
  ).trim();

  if (!incomingText || !senderPhone) return;

  if (rawJid.endsWith("@g.us")) {
    if (incomingText.toLowerCase() === "!idgrup") {
      return await sock.sendMessage(rawJid, {
        text: `🆔 *ID Grup WhatsApp ini:*\n\`${rawJid}\`\n\nSalin ID di atas ke pengaturan Bot CRM Anda.`,
      });
    }
    return;
  }

  try {
    console.log(
      `📩 [SaaS WA] Chat Masuk [Tenant: ${tenantId}] dari [${senderPhone}]: "${incomingText}"`
    );

    const botConfig = await prisma.aiBotConfig.findUnique({
      where: { tenantId },
      include: {
        tenant: { include: { products: true } },
        subjects: { orderBy: { name: "asc" } },
      },
    });
    if (!botConfig) return;

    // Cek masa aktif paket tenant
    if (
      botConfig.tenant.status === "EXPIRED" ||
      (botConfig.tenant.subscriptionEnd && new Date() > new Date(botConfig.tenant.subscriptionEnd))
    ) {
      if (botConfig.tenant.status !== "EXPIRED") {
        await prisma.tenant.update({ where: { tenantId }, data: { status: "EXPIRED" } });
      }
      return;
    }

    let session = await prisma.botSession.findUnique({
      where: { tenantId_customerPhoneNumber: { tenantId, customerPhoneNumber: senderPhone } },
    });

    if (!session) {
      session = await prisma.botSession.create({
        data: { tenantId, customerPhoneNumber: senderPhone, currentNodeId: "WELCOME" },
      });
    }

    // Auto-reset sesi jika lebih dari 24 jam tidak ada balasan
    if (session.currentNodeId !== "WELCOME" && session.updatedAt) {
      const hoursInactive =
        (Date.now() - new Date(session.updatedAt).getTime()) / (1000 * 60 * 60);
      if (hoursInactive >= 24) {
        session = await resetSessionToWelcome(tenantId, senderPhone, "EXPIRED_SESSION");
      }
    }

    // Perintah reset manual oleh pelanggan
    if (["menu", "reset", "batal"].includes(incomingText.toLowerCase())) {
      await resetSessionToWelcome(tenantId, senderPhone, "CANCELLED");
      if (botConfig.subjects.length === 1) {
        const companyIntro = sanitizeDbText(
          botConfig.openingMessage,
          `Halo! Selamat datang di *${botConfig.tenant?.businessName || "Layanan Kami"}*.`
        );
        return await startSubjectInterview(
          sock,
          rawJid,
          tenantId,
          senderPhone,
          botConfig,
          botConfig.subjects[0],
          companyIntro
        );
      }
      return await sendSubjectMenu(sock, rawJid, botConfig, incomingText);
    }

    // Jika sedang di dalam wawancara subjek aktif -> panggil processActiveInterview
    const activeSubject = botConfig.subjects.find((s) => s.subjectId === session.currentNodeId);
    if (activeSubject) {
      return await processActiveInterview(
        sock,
        rawJid,
        tenantId,
        senderPhone,
        incomingText,
        botConfig,
        activeSubject
      );
    }

    // Jika subjek hanya ada 1 -> langsung sapa profil perusahaan & mulai pertanyaan pertama tanpa pilih angka 1
    if (botConfig.subjects.length === 1) {
      const companyIntro = sanitizeDbText(
        botConfig.openingMessage,
        `Halo! Selamat datang di *${botConfig.tenant?.businessName || "Layanan Kami"}*.`
      );
      return await startSubjectInterview(
        sock,
        rawJid,
        tenantId,
        senderPhone,
        botConfig,
        botConfig.subjects[0],
        companyIntro
      );
    }

    // Jika subjek >= 2 -> cocokkan pilihan nomor/nama layanan, atau tampilkan daftar menu
    const numericChoice = parseInt(incomingText, 10);
    const matchedSubject =
      botConfig.subjects.find((s) => s.name.toLowerCase() === incomingText.toLowerCase()) ||
      (!Number.isNaN(numericChoice) && numericChoice > 0 && numericChoice <= botConfig.subjects.length
        ? botConfig.subjects[numericChoice - 1]
        : null);

    if (matchedSubject) {
      return await startSubjectInterview(sock, rawJid, tenantId, senderPhone, botConfig, matchedSubject);
    }

    return await sendSubjectMenu(sock, rawJid, botConfig, incomingText);
  } catch (error) {
    console.error("🚨 [Bot Handler Error]:", error);
  }
}


// 2. SUB-PROSES A: Memulai wawancara subjek (Bisa dipanggil langsung jika subjek cuma 1, atau setelah pilih menu)
async function startSubjectInterview(
  sock,
  rawJid,
  tenantId,
  senderPhone,
  botConfig,
  subject,
  initialGreeting = ""
) {
  await prisma.botSession.update({
    where: {
      tenantId_customerPhoneNumber: { tenantId, customerPhoneNumber: senderPhone },
    },
    data: { currentNodeId: subject.subjectId },
  });

  await prisma.lead.create({
    data: { tenantId, phoneNumber: senderPhone, status: "BOT_PROCESS", formData: {} },
  });

  const fields = (subject.targetData || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const closingText = sanitizeDbText(
    botConfig.closingMessage,
    "Baik, kami hubungkan Anda dengan tim kami."
  );

  // Jika subjek tidak memiliki pertanyaan data wajib, langsung teruskan ke sales
  if (fields.length === 0) {
    const introPrefix = initialGreeting ? `${initialGreeting}\n\n` : "";
    await sock.sendMessage(rawJid, { text: `${introPrefix}${closingText}` });
    await allocateLeadsToSales(sock, rawJid, tenantId, subject, senderPhone, {});
    return await resetSessionToWelcome(tenantId, senderPhone);
  }

  const firstField = fields[0];

  await sock.sendPresenceUpdate("composing", rawJid);
  const promptInstruction = initialGreeting
    ? `Pelanggan baru menyapa. Sapa pelanggan menggunakan profil perusahaan ini: "${initialGreeting}", lalu langsung lanjutkan menanyakan "${firstField}" untuk layanan "${subject.name}".`
    : `Pelanggan memilih layanan "${subject.name}". Mulai wawancara dengan menanyakan "${firstField}".`;

  const initialAi = await tryAskGemini(
    [{ role: "user", parts: [{ text: promptInstruction }] }],
    buildSystemPrompt(botConfig, subject, {}, fields, true)
  );
  await sock.sendPresenceUpdate("paused", rawJid);

  if (initialAi) {
    return await sock.sendMessage(rawJid, {
      text: initialAi.replace("[[DATA_COMPLETE]]", "").trim(),
    });
  }

  // Fallback manual jika AI limit/gangguan
  const fallbackIntro = initialGreeting
    ? `${initialGreeting}\n\nUntuk membantu kebutuhan Anda, boleh informasikan *${firstField}* Anda terlebih dahulu?`
    : `Baik, untuk layanan *${subject.name}*, boleh informasikan *${firstField}* Anda terlebih dahulu?`;

  return await sock.sendMessage(rawJid, { text: fallbackIntro });
}

// 3. SUB-PROSES B: Melanjutkan wawancara yang sedang berjalan
async function processActiveInterview(
  sock,
  rawJid,
  tenantId,
  senderPhone,
  incomingText,
  botConfig,
  activeSubject
) {
  const fields = (activeSubject.targetData || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  let currentLead = await prisma.lead.findFirst({
    where: { tenantId, phoneNumber: senderPhone, status: "BOT_PROCESS" },
    orderBy: { createdAt: "desc" },
  });

  if (!currentLead) {
    currentLead = await prisma.lead.create({
      data: { tenantId, phoneNumber: senderPhone, status: "BOT_PROCESS", formData: {} },
    });
  }

  const savedData =
    typeof currentLead.formData === "object" && currentLead.formData !== null
      ? { ...currentLead.formData }
      : {};

  const currentField = fields.find((f) => !savedData[f]) || null;

  if (currentField) {
    if (!isValidInput(incomingText)) {
      return await sock.sendMessage(rawJid, {
        text: `Mohon maaf, format *${currentField}* belum sesuai. Silakan ketik ulang dengan jelas ya (atau ketik *menu* untuk kembali).`,
      });
    }

    // Deteksi jika pelanggan bertanya balik (?) sebelum menjawab data
    const isCustomerAskingBack =
      incomingText.includes("?") ||
      /\b(apa\s*aja|ada\s*apa|berapa|daftar|list|pilihan|tipe\s*apa|jenis\s*apa|info\s*harga)\b/i.test(
        incomingText
      );

    if (isCustomerAskingBack) {
      await sock.sendPresenceUpdate("composing", rawJid);
      const productList =
        botConfig.tenant?.products?.length > 0
          ? botConfig.tenant.products
              .map((p) => `- ${p.name} (Rp ${p.price?.toLocaleString("id-ID") || "-"})`)
              .join("\n")
          : "Belum ada daftar katalog spesifik di sistem (berikan penjelasan umum yang ramah sesuai profil perusahaan, lalu arahkan ke tim sales untuk brosur/detail lengkap).";

      const askBackPrompt = `Kamu adalah CS AI dari ${botConfig.tenant?.businessName || "perusahaan kami"}.
Profil Perusahaan: ${botConfig.openingMessage || "-"}
Katalog/Produk Tersedia:
${productList}
Pelanggan sedang mengisi data "${currentField}", tetapi bertanya balik: "${incomingText}".
Jawab pertanyaannya secara ramah & jujur berdasarkan info di atas, lalu tanyakan kembali data "${currentField}". JANGAN tulis [[DATA_COMPLETE]].`;

      const answerReply = await tryAskGemini(
        [{ role: "user", parts: [{ text: incomingText }] }],
        askBackPrompt
      );
      await sock.sendPresenceUpdate("paused", rawJid);

      return await sock.sendMessage(rawJid, {
        text:
          answerReply ||
          `Untuk pilihan *${currentField}*, tim sales kami akan mengirimkan katalog lengkapnya sebentar lagi. Boleh informasikan perkiraan *${currentField}* yang Anda minati terlebih dahulu?`,
      });
    }

    // Simpan jawaban & jalankan percabangan kondisional "(Jika Perusahaan)"
    savedData[currentField] = incomingText;
    const categoryAnswer =
      Object.entries(savedData).find(([key]) =>
        /kategori|jenis pembeli|atas nama|keperluan/i.test(key)
      )?.[1] || "";

    if (/\bpribadi\b|\bperorangan\b|\bindividu\b/i.test(String(categoryAnswer))) {
      fields.forEach((f) => {
        if (/\(\s*jika\s+perusahaan\s*\)/i.test(f) && !savedData[f]) {
          savedData[f] = "- (Pribadi)";
        }
      });
    }

    await prisma.lead.update({
      where: { leadId: currentLead.leadId },
      data: { formData: savedData },
    });
  }

  const remainingFields = fields.filter((f) => !savedData[f]);
  const nextField = remainingFields[0] || null;
  const closingText = sanitizeDbText(
    botConfig.closingMessage,
    "Terima kasih sudah menghubungi kami. Tim kami akan segera menindaklanjuti kebutuhan Anda."
  );

  await sock.sendPresenceUpdate("composing", rawJid);
  const userTurnContext = currentField
    ? `Jawaban pelanggan untuk "${currentField}": "${incomingText}". ${
        nextField
          ? `Data berikutnya yang harus ditanyakan: "${nextField}".`
          : "Semua data sudah terkumpul lengkap."
      }`
    : `Semua data sudah terkumpul lengkap. Pesan terakhir pelanggan: "${incomingText}".`;

  const aiReply = await tryAskGemini(
    [{ role: "user", parts: [{ text: userTurnContext }] }],
    buildSystemPrompt(botConfig, activeSubject, savedData, remainingFields, false)
  );
  await sock.sendPresenceUpdate("paused", rawJid);

  if (aiReply) {
    const isComplete = aiReply.includes("[[DATA_COMPLETE]]") || !nextField;
    const cleanAiReply = aiReply.replace("[[DATA_COMPLETE]]", "").trim();

    if (isComplete) {
      const finalClosingMsg = cleanAiReply ? `${cleanAiReply}\n\n${closingText}` : closingText;
      await sock.sendMessage(rawJid, { text: finalClosingMsg });
      await allocateLeadsToSales(sock, rawJid, tenantId, activeSubject, senderPhone, savedData);
      return await resetSessionToWelcome(tenantId, senderPhone);
    }
    return await sock.sendMessage(rawJid, { text: cleanAiReply });
  }

  // Cadangan instan jika AI limit/error
  if (nextField) {
    return await sock.sendMessage(rawJid, {
      text: `Baik, sudah dicatat. Selanjutnya, boleh informasikan *${nextField}* Anda?`,
    });
  }

  await sock.sendMessage(rawJid, { text: `Terima kasih atas informasinya.\n\n${closingText}` });
  await allocateLeadsToSales(sock, rawJid, tenantId, activeSubject, senderPhone, savedData);
  return await resetSessionToWelcome(tenantId, senderPhone);
}

async function allocateLeadsToSales(sock, rawJid, tenantId, sub, customerPhone, formData = {}) {
  let selectedSales = null;

  if (sub.routingType === "DIRECT" && sub.targetSalesId) {
    const directSales = await prisma.user.findUnique({ where: { userId: sub.targetSalesId } });
    // Pastikan sales tujuan masih berstatus aktif
    if (directSales && directSales.isActive !== false) {
      selectedSales = directSales;
    }
  } else if (sub.routingType === "ROUND_ROBIN") {
    // ✅ Hanya bagikan ke sales yang berstatus aktif (isActive: true)
    const team = await prisma.user.findMany({
      where: { tenantId, role: "SALES", isActive: true },
      orderBy: { createdAt: "asc" },
    });

    if (team.length > 0) {
      const lastAssignedLead = await prisma.lead.findFirst({
        where: { tenantId, assignedToSalesId: { not: null } },
        orderBy: { createdAt: "desc" },
      });
      const lastIndex = lastAssignedLead
        ? team.findIndex((s) => s.userId === lastAssignedLead.assignedToSalesId)
        : -1;
      const nextIndex = (lastIndex + 1) % team.length;
      selectedSales = team[nextIndex];
    }
  }

  // Update status lead terbaru
  const targetLead = await prisma.lead.findFirst({
    where: { tenantId, phoneNumber: customerPhone, status: "BOT_PROCESS" },
    orderBy: { createdAt: "desc" },
  });

  if (targetLead) {
    await prisma.lead.update({
      where: { leadId: targetLead.leadId },
      data: {
        status: selectedSales ? "ASSIGNED" : "UNASSIGNED",
        assignedToSalesId: selectedSales ? selectedSales.userId : null,
        assignedSalesName: selectedSales ? selectedSales.name : null,
      },
    });
  }

  // ✅ Sembunyikan field kondisional yang bernilai "- (Pribadi)" agar pesan ke sales tetap bersih
  const summaryLines = Object.entries(formData)
    .filter(([_, val]) => String(val || "").trim() !== "- (Pribadi)")
    .map(([key, val]) => `• *${key}:* ${val}`)
    .join("\n");

  if (selectedSales) {
    // Tampilkan HANYA nama sales ke customer
    await sock.sendMessage(rawJid, {
      text: `👤 *Tim Sales yang Menangani:* *${selectedSales.name}*\nPermintaan Anda telah diteruskan kepada *${selectedSales.name}* dan akan segera menghubungi Anda.`,
    });

    // Kirim notifikasi japri ke WhatsApp Sales yang bersangkutan
    const cleanSalesPhone = selectedSales.phoneNumber.replace(/[^0-9]/g, "");
    const salesJid = `${cleanSalesPhone}@s.whatsapp.net`;

    await sock
      .sendMessage(salesJid, {
        text: `👥 *[LEADS BARU - ${sub.name}]*\n\nHalo *${selectedSales.name}*, Anda mendapatkan prospek baru:\n${summaryLines || "• Tidak ada detail tambahan"}\n\nHubungi Customer: wa.me/${customerPhone}`,
      })
      .catch((err) => {
        console.error(`⚠️ Gagal mengirim notifikasi ke sales (${selectedSales.name}):`, err.message);
      });
  }

  // Ambil salesGroupJid dari botConfig dan kirim ke Grup Sales (jika diatur)
  const config = await prisma.aiBotConfig.findUnique({
    where: { tenantId },
    select: { salesGroupJid: true },
  });

  if (config?.salesGroupJid) {
    const groupJid = config.salesGroupJid.includes("@g.us")
      ? config.salesGroupJid.trim()
      : `${config.salesGroupJid.trim()}@g.us`;

    await sock
      .sendMessage(groupJid, {
        text:
          `📢 *[PROSPEK BARU - ${sub.name}]*\n\n` +
          `👤 *PIC Sales:* ${selectedSales ? selectedSales.name : "Belum ditentukan"}\n` +
          `📱 *No. Customer:* wa.me/${customerPhone}\n\n` +
          `*Detail Kebutuhan:*\n${summaryLines || "• Tidak ada detail tambahan"}\n\n` +
          `_Mohon segera ditindaklanjuti._`,
      })
      .catch((err) => {
        console.error("⚠️ Gagal mengirim notifikasi ke Grup Sales:", err.message);
      });
  }
}


async function sendSubjectMenu(sock, rawJid, botConfig, incomingText = "") {
  const companyName = botConfig.tenant?.businessName || "kami";
  const companyProfile = sanitizeDbText(
    botConfig.openingMessage,
    `Kami dari ${companyName} siap membantu kebutuhan Anda.`
  );

  // Format daftar menu dari database
  const menuList = botConfig.subjects
    .map((s, idx) => `${idx + 1}. *${s.name}*`)
    .join("\n");

  const menuBlock = `📋 *PILIHAN LAYANAN:*\n${menuList}\n\n_Balas dengan angka (contoh: *1*) atau ketik nama layanan di atas._`;

  // Cek apakah pesan masuk adalah sapaan atau pertanyaan umum (bukan perintah "menu")
  const isPureCommand = ["menu", "reset", "batal"].includes(incomingText.toLowerCase());
  let dynamicGreeting = `Halo! Selamat datang di *${companyName}*.\n${companyProfile}`;

  if (!isPureCommand && incomingText) {
    await sock.sendPresenceUpdate("composing", rawJid);
    const aiGreeting = await tryAskGemini(
      [
        {
          role: "user",
          parts: [
            {
              text: `Pelanggan baru mengirim pesan awal: "${incomingText}". Balas sapaan pelanggan ini dengan ramah dan natural, perkenalkan singkat perusahaan berdasarkan profil berikut: "${companyProfile}", lalu arahkan pelanggan untuk memilih layanan di bawah ini. Maksimal 2 kalimat singkat, jangan tulis daftar menunya karena daftar menu akan ditambahkan otomatis di bawah balasanmu.`,
            },
          ],
        },
      ],
      `Kamu adalah Customer Service WhatsApp yang ramah untuk "${companyName}". Gunakan bahasa Indonesia yang luwes, hangat, dan tidak kaku.`
    );
    await sock.sendPresenceUpdate("paused", rawJid);

    if (aiGreeting) {
      dynamicGreeting = aiGreeting.trim();
    }
  }

  // Gabungkan sapaan hangat AI dengan blok menu yang konsisten
  return await sock.sendMessage(rawJid, {
    text: `${dynamicGreeting}\n\n${menuBlock}`,
  });
}

module.exports = { handleIncomingMessage };