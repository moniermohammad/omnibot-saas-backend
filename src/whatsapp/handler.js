// src/whatsapp/handler.js
const { PrismaClient } = require("@prisma/client");
const { GoogleGenAI } = require("@google/genai");

const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ✅ AI-04: Format Katalog Produk Lengkap sesuai schema Product (productName, costPrice, description, maxDiscount)
function formatProductCatalog(products = []) {
  if (!Array.isArray(products) || products.length === 0) return "";

  const activeProducts = products.filter((p) => p.status !== "INACTIVE");
  if (activeProducts.length === 0) return "";

  return activeProducts
    .map((p) => {
      const numericPrice = Number(p.costPrice || 0);
      const priceText =
        numericPrice > 0
          ? `Rp ${numericPrice.toLocaleString("id-ID")}`
          : "Harga hubungi tim sales";

      const descText = p.description ? ` | Info: ${p.description.trim()}` : "";

      const numericMaxDisc = Number(p.maxDiscount || 0);
      const discText =
        numericMaxDisc > 0
          ? ` | Batas Max Diskon AI: s/d ${numericMaxDisc}% (DILARANG menawarkan diskon melebihi ${numericMaxDisc}%; jika pelanggan minta diskon lebih besar, arahkan negosiasi ke tim sales)`
          : " | Harga Net (Tidak ada diskon otomatis dari AI; jika pelanggan menawar, sampaikan akan dibantu negosiasi oleh tim sales)";

      return `- ${p.productName}: ${priceText}${descText}${discText}`;
    })
    .join("\n");
}

function buildSystemPrompt(
  botConfig,
  subject,
  savedData,
  remainingFields,
  isFirstTurn = false,
) {
  const companyName = botConfig.tenant?.businessName || "Perusahaan Kami";
  const companyProfile = sanitizeDbText(botConfig.openingMessage, companyName);
  const toneStyle = subject.toneStyle || "Ramah dan sopan";
  const hasMultipleSubjects = (botConfig.subjects?.length || 0) > 1;
  const productList = formatProductCatalog(botConfig.tenant?.products);

  const subjectClosingHint = sanitizeDbText(
    subject.closingMessage,
    "Terima kasih, data Anda sudah kami catat dan akan segera ditindaklanjuti oleh tim terkait.",
  );

  // Bersihkan tanda bintang (*) dari aiPrompt agar AI fokus pada nama field bersih
  const cleanAiPrompt = (subject.aiPrompt || "").replace(/\*/g, "");

  const collectedEntries = Object.entries(savedData);
  const collectedSummary =
    collectedEntries.length > 0
      ? collectedEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n")
      : "Belum ada data terkumpul.";

  // ✅ ATURAN SALAM: Hanya menyapa jika subjek cuma 1 (karena belum ada menu sebelumnya)
  const greetingRule =
    isFirstTurn && !hasMultipleSubjects
      ? "Sapa pelanggan dengan sopan sesuai profil perusahaan, lalu langsung tanyakan data pertama."
      : "DILARANG mengucapkan salam pembuka ('Halo', 'Selamat datang', dll) dan DILARANG mengulang perkenalan profil/nama perusahaan lagi karena pelanggan sudah disapa sebelumnya. Langsung konfirmasi pilihan layanan secara singkat dan tanyakan data yang diminta.";

      return `
      Kamu adalah Customer Service WhatsApp resmi untuk "${companyName}".
      PROFIL PERUSAHAAN: ${companyProfile}
      ${productList ? `DAFTAR PRODUK TERSEDIA:\n${productList}` : ""}

      LAYANAN YANG DIPILIH: "${subject.name}"
      GAYA BICARA: ${toneStyle}
      ${cleanAiPrompt ? `INSTRUKSI KHUSUS LAYANAN: ${cleanAiPrompt}` : ""}

      DATA PELANGGAN YANG SUDAH TERKUMPUL:
      ${collectedSummary}

      DAFTAR DATA YANG MASIH HARUS DITANYAKAN (BERURUTAN):
      ${remainingFields.length > 0 ? remainingFields.join(", ") : "SEMUA DATA SUDAH LENGKAP"}

      ATURAN WAJIB BALASAN:
      1. ${greetingRule}
      2. Tanyakan HANYA SATU data paling depan dari daftar yang tersisa. Jangan menggabungkan dua pertanyaan sekaligus.
      3. ATURAN CABANG: Jika data berikutnya bersifat bersyarat (misal mengandung kata "(Jika Perusahaan)") dan pelanggan sebelumnya menjawab "Pribadi", LEWATI pertanyaan itu dan langsung tanyakan data berikutnya.
      4. Jika pelanggan bertanya seputar perusahaan atau produk, jawab singkat terlebih dahulu, lalu lanjutkan menanyakan data yang belum lengkap.
      5. Jangan pernah menuliskan label struktur seperti "Salam Pembuka:" atau "Pesan Penutup:".
      6. Maksimal 2 kalimat pendek agar nyaman dibaca di WhatsApp.
      7. ANTI-HALUSINASI: HANYA sebutkan fakta, harga, atau spesifikasi yang tertulis eksplisit pada "DATA PELANGGAN YANG SUDAH TERKUMPUL" dan "DAFTAR PRODUK TERSEDIA". DILARANG mengarang harga, promo, stok, atau berasumsi tentang kebutuhan yang tidak pernah diucapkan pelanggan.
      ${remainingFields.length === 0 ? `8. Semua data sudah lengkap. Buat kalimat penutup yang natural, hangat, dan sesuai konteks percakapan dengan menyampaikan inti pesan ini: "${subjectClosingHint}". Akhiri balasan dengan tag [[DATA_COMPLETE]].` : ""}
      `.trim();
}

// function buildSystemPrompt(
//   botConfig,
//   subject,
//   savedData,
//   remainingFields,
//   isFirstTurn = false,
// ) {
//   const companyName = botConfig.tenant?.businessName || "Perusahaan Kami";
//   const companyProfile = sanitizeDbText(botConfig.openingMessage, companyName);
//   const toneStyle = subject.toneStyle || "Ramah dan sopan";
//   const hasMultipleSubjects = (botConfig.subjects?.length || 0) > 1;
//   const productList = formatProductCatalog(botConfig.tenant?.products);

//   const subjectClosingHint = sanitizeDbText(
//     subject.closingMessage,
//     "Terima kasih, data Anda sudah kami catat dan akan segera ditindaklanjuti oleh tim terkait."
//   );

//   // Bersihkan tanda bintang (*) dari aiPrompt agar AI fokus pada nama field bersih
//   const cleanAiPrompt = (subject.aiPrompt || "").replace(/\*/g, "");

//   const productList = (botConfig.tenant?.products || [])
//     .map((p) => `- ${p.name}${p.price ? ` (Rp${p.price})` : ""}`)
//     .join("\n");

//   const collectedEntries = Object.entries(savedData);
//   const collectedSummary =
//     collectedEntries.length > 0
//       ? collectedEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n")
//       : "Belum ada data terkumpul.";

//   // ✅ ATURAN SALAM: Hanya menyapa jika subjek cuma 1 (karena belum ada menu sebelumnya)
//   const greetingRule =
//     isFirstTurn && !hasMultipleSubjects
//       ? "Sapa pelanggan dengan sopan sesuai profil perusahaan, lalu langsung tanyakan data pertama."
//       : "DILARANG mengucapkan salam pembuka ('Halo', 'Selamat datang', dll) dan DILARANG mengulang perkenalan profil/nama perusahaan lagi karena pelanggan sudah disapa sebelumnya. Langsung konfirmasi pilihan layanan secara singkat dan tanyakan data yang diminta.";

//   return `
//       Kamu adalah Customer Service WhatsApp resmi untuk "${companyName}".
//       PROFIL PERUSAHAAN: ${companyProfile}
//       ${productList ? `DAFTAR PRODUK TERSEDIA:\n${productList}` : ""}

//       LAYANAN YANG DIPILIH: "${subject.name}"
//       GAYA BICARA: ${toneStyle}
//       ${cleanAiPrompt ? `INSTRUKSI KHUSUS LAYANAN: ${cleanAiPrompt}` : ""}

//       DATA PELANGGAN YANG SUDAH TERKUMPUL:
//       ${collectedSummary}

//       DAFTAR DATA YANG MASIH HARUS DITANYAKAN (BERURUTAN):
//       ${remainingFields.length > 0 ? remainingFields.join(", ") : "SEMUA DATA SUDAH LENGKAP"}

//       ATURAN WAJIB BALASAN:
//       1. ${greetingRule}
//       2. Tanyakan HANYA SATU data paling depan dari daftar yang tersisa. Jangan menggabungkan dua pertanyaan sekaligus.
//       3. ATURAN CABANG: Jika data berikutnya bersifat bersyarat (misal mengandung kata "(Jika Perusahaan)") dan pelanggan sebelumnya menjawab "Pribadi", LEWATI pertanyaan itu dan langsung tanyakan data berikutnya.
//       4. Jika pelanggan bertanya seputar perusahaan atau produk, jawab singkat terlebih dahulu, lalu lanjutkan menanyakan data yang belum lengkap.
//       5. Jangan pernah menuliskan label struktur seperti "Salam Pembuka:" atau "Pesan Penutup:".
//       6. Maksimal 2 kalimat pendek agar nyaman dibaca di WhatsApp.
//       7. ANTI-HALUSINASI: HANYA sebutkan fakta, harga, atau spesifikasi yang tertulis eksplisit pada "DATA PELANGGAN YANG SUDAH TERKUMPUL" dan "DAFTAR PRODUK TERSEDIA". DILARANG mengarang harga, promo, stok, atau berasumsi tentang kebutuhan yang tidak pernah diucapkan pelanggan.
//       ${remainingFields.length === 0 ? `8. Semua data sudah lengkap. Buat kalimat penutup yang natural, hangat, dan sesuai konteks percakapan dengan menyampaikan inti pesan ini: "${subjectClosingHint}". Akhiri balasan dengan tag [[DATA_COMPLETE]].` : ""}
//       `.trim();

// }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryAskGemini(contents, systemInstruction) {
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "🚨 [Gemini Config] GEMINI_API_KEY tidak ditemukan di process.env!",
    );
    return null;
  }

  const modelFallbackList = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    // "gemini-2.5-flash",
    // "gemini-2.5-flash-lite",
  ];


  for (let i = 0; i < modelFallbackList.length; i++) {
    const currentModel = modelFallbackList[i];
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT_4S")), 4000),
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

      console.warn(
        `⚠️ [${currentModel}] Response diterima tetapi text kosong.`,
      );
    } catch (err) {
      const status = err?.status;
      console.warn(
        `⏳ [${currentModel}] Gagal (${status || err?.message}), lanjut ke cadangan...`,
      );

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
  return (
    text.replace(/^(salam pembuka|pesan penutup)\s*:?\s*/i, "").trim() ||
    fallback
  );
}

function isValidInput(text) {
  const clean = text.trim();
  if (clean.length < 1) return false;
  if (/^[^a-zA-Z0-9]+$/.test(clean)) return false;
  if (/[bcdfghjklmnpqrstvwxyz]{6,}/i.test(clean) || /(.)\1{4,}/i.test(clean))
    return false;
  return true;
}

// 1. HELPER: Reset sesi pelanggan kembali ke WELCOME
async function resetSessionToWelcome(
  tenantId,
  customerPhoneNumber,
  leadStatusToSet = null,
) {
  if (leadStatusToSet) {
    await prisma.lead.updateMany({
      where: {
        tenantId,
        phoneNumber: customerPhoneNumber,
        status: "BOT_PROCESS",
      },
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
// Helper deteksi keinginan langsung terhubung ke sales/admin (tahan typo & kata sisipan)
function checkDirectSalesIntent(text) {
  return /\b((boleh|bisa|mau|ingin|minta|tolong|hubungkan|sambungkan|oper|lempar|alihkan|bicara|ngobrol|chat)\b.{0,25}\b(sales|sale|admin|cs|marketing|agen|operator|orang|manusia)|jangan\s*(pakai\s*)?(bot|ai|robot))/i.test(
    text,
  );
}

async function handleIncomingMessage(sock, msg, tenantId) {
  if (!msg || !msg.message || msg.key.fromMe) return;
  const rawJid = msg.key.remoteJid;
  if (!rawJid || rawJid === "status@broadcast") return;

  const cleanJidForPhone =
    msg.key.remoteJidAlt || msg.key.participant || rawJid;
  const senderPhone = cleanJidForPhone
    .split("@")[0]
    .split(":")[0]
    .replace(/[^0-9]/g, "");

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
      `📩 [SaaS WA] Chat Masuk [Tenant: ${tenantId}] dari [${senderPhone}]: "${incomingText}"`,
    );

    const botConfig = await prisma.aiBotConfig.findUnique({
      where: { tenantId },
      include: {
        tenant: { include: { products: true } },
        subjects: { orderBy: { orderIndex: "asc" } },
      },
    });
    if (!botConfig) return;

    // Cek masa aktif paket tenant
    if (
      botConfig.tenant.status === "EXPIRED" ||
      (botConfig.tenant.subscriptionEnd &&
        new Date() > new Date(botConfig.tenant.subscriptionEnd))
    ) {
      if (botConfig.tenant.status !== "EXPIRED") {
        await prisma.tenant.update({
          where: { tenantId },
          data: { status: "EXPIRED" },
        });
      }
      return;
    }

    let session = await prisma.botSession.findUnique({
      where: {
        tenantId_customerPhoneNumber: {
          tenantId,
          customerPhoneNumber: senderPhone,
        },
      },
    });

    const isFirstTimeSession = !session;

    if (!session) {
      session = await prisma.botSession.create({
        data: {
          tenantId,
          customerPhoneNumber: senderPhone,
          currentNodeId: "WELCOME",
        },
      });
    }

    // Auto-reset sesi jika lebih dari 24 jam tidak ada balasan
    if (session.currentNodeId !== "WELCOME" && session.updatedAt) {
      const hoursInactive =
        (Date.now() - new Date(session.updatedAt).getTime()) / (1000 * 60 * 60);
      if (hoursInactive >= 24) {
        session = await resetSessionToWelcome(
          tenantId,
          senderPhone,
          "EXPIRED_SESSION",
        );
      }
    }

    // Perintah reset manual oleh pelanggan
    if (["menu", "reset", "batal"].includes(incomingText.toLowerCase())) {
      await resetSessionToWelcome(tenantId, senderPhone, "CANCELLED");
      if (botConfig.subjects.length === 1) {
        const companyIntro = sanitizeDbText(
          botConfig.openingMessage,
          `Halo! Selamat datang di *${botConfig.tenant?.businessName || "Layanan Kami"}*.`,
        );
        return await startSubjectInterview(
          sock,
          rawJid,
          tenantId,
          senderPhone,
          botConfig,
          botConfig.subjects[0],
          companyIntro,
        );
      }
      return await sendSubjectMenu(sock, rawJid, botConfig, incomingText);
    }

    // Jika sedang di dalam wawancara subjek aktif -> panggil processActiveInterview
    const activeSubject = botConfig.subjects.find(
      (s) => s.subjectId === session.currentNodeId,
    );

    if (activeSubject) {
      return await processActiveInterview(
        sock,
        rawJid,
        tenantId,
        senderPhone,
        incomingText,
        botConfig,
        activeSubject,
      );
    }

    // Jika subjek hanya ada 1 -> langsung sapa profil perusahaan & mulai pertanyaan pertama tanpa pilih angka 1
    if (botConfig.subjects.length === 1) {
      const companyIntro = sanitizeDbText(
        botConfig.openingMessage,
        `Halo! Selamat datang di *${botConfig.tenant?.businessName || "Layanan Kami"}*.`,
      );
      return await startSubjectInterview(
        sock,
        rawJid,
        tenantId,
        senderPhone,
        botConfig,
        botConfig.subjects[0],
        companyIntro,
      );
    }

    // Jika pelanggan minta langsung ke sales/admin di menu awal -> langsung lempar ke processActiveInterview
    const wantsDirectSales = checkDirectSalesIntent(incomingText);
    if (wantsDirectSales && botConfig.subjects.length > 0) {
      const defaultSubject = botConfig.subjects[0]; // Pilihan 1 (INFO PRODUK & HARGA)
      await prisma.botSession.update({
        where: {
          tenantId_customerPhoneNumber: {
            tenantId,
            customerPhoneNumber: senderPhone,
          },
        },
        data: { currentNodeId: defaultSubject.subjectId },
      });

      return await processActiveInterview(
        sock,
        rawJid,
        tenantId,
        senderPhone,
        incomingText,
        botConfig,
        defaultSubject,
      );
    }

    // Jika subjek >= 2 -> cocokkan pilihan nomor/nama layanan
    const numericChoice = parseInt(incomingText, 10);
    const matchedSubject =
      botConfig.subjects.find(
        (s) => s.name.toLowerCase() === incomingText.toLowerCase(),
      ) ||
      (!Number.isNaN(numericChoice) &&
      numericChoice > 0 &&
      numericChoice <= botConfig.subjects.length
        ? botConfig.subjects[numericChoice - 1]
        : null);

    if (matchedSubject) {
      return await startSubjectInterview(
        sock,
        rawJid,
        tenantId,
        senderPhone,
        botConfig,
        matchedSubject,
      );
    }

    // Bedakan antara sapaan awal/sesi baru vs balasan yang belum sesuai pilihan menu
    const isGreetingOnly =
      /^((halo|hallo|hai|hi|hey|permisi|misi|p|ping|assalamu['\s]?alaikum)\s*)?(selamat\s*)?(pagi|siang|sore|malam|kak|min|admin|gan|bos|pak|bu)?[\s!?,.*]*$/i.test(
        incomingText,
      );

    if (!isFirstTimeSession && !isGreetingOnly) {
      const menuList = botConfig.subjects
        .map((s, idx) => `${idx + 1}. *${s.name}*`)
        .join("\n");

      return await sock.sendMessage(rawJid, {
        text:
          `Mohon maaf Kak, agar kami dapat menghubungkan ke tim yang tepat, silakan balas dengan *angka* pilihan layanan berikut ya:\n\n` +
          `${menuList}\n\n` +
          `_Contoh: balas *1* atau *2*_`,
      });
    }

    return await sendSubjectMenu(sock, rawJid, botConfig, incomingText);
  } catch (error) {
    console.error("🚨 [Bot Handler Error]:", error);
  }
}


// async function handleIncomingMessage(sock, msg, tenantId) {
//   if (!msg || !msg.message || msg.key.fromMe) return;
//   const rawJid = msg.key.remoteJid;
//   if (!rawJid || rawJid === "status@broadcast") return;

//   const cleanJidForPhone =
//     msg.key.remoteJidAlt || msg.key.participant || rawJid;
//   const senderPhone = cleanJidForPhone
//     .split("@")[0]
//     .split(":")[0]
//     .replace(/[^0-9]/g, "");

//   const actualMessage = msg.message?.ephemeralMessage?.message || msg.message;
//   const incomingText = (
//     actualMessage?.conversation ||
//     actualMessage?.extendedTextMessage?.text ||
//     ""
//   ).trim();

//   if (!incomingText || !senderPhone) return;

//   if (rawJid.endsWith("@g.us")) {
//     if (incomingText.toLowerCase() === "!idgrup") {
//       return await sock.sendMessage(rawJid, {
//         text: `🆔 *ID Grup WhatsApp ini:*\n\`${rawJid}\`\n\nSalin ID di atas ke pengaturan Bot CRM Anda.`,
//       });
//     }
//     return;
//   }

//   try {
//     console.log(
//       `📩 [SaaS WA] Chat Masuk [Tenant: ${tenantId}] dari [${senderPhone}]: "${incomingText}"`,
//     );

//     const botConfig = await prisma.aiBotConfig.findUnique({
//     where: { tenantId },
//       include: {
//         tenant: { include: { products: true } },
//         subjects: { orderBy: { orderIndex: "asc" } }, // <-- Ubah dari name ke orderIndex
//       },
//     });
//     if (!botConfig) return;


//     // Cek masa aktif paket tenant
//     if (
//       botConfig.tenant.status === "EXPIRED" ||
//       (botConfig.tenant.subscriptionEnd &&
//         new Date() > new Date(botConfig.tenant.subscriptionEnd))
//     ) {
//       if (botConfig.tenant.status !== "EXPIRED") {
//         await prisma.tenant.update({
//           where: { tenantId },
//           data: { status: "EXPIRED" },
//         });
//       }
//       return;
//     }

//     let session = await prisma.botSession.findUnique({
//       where: {
//         tenantId_customerPhoneNumber: {
//           tenantId,
//           customerPhoneNumber: senderPhone,
//         },
//       },
//     });

//     if (!session) {
//       session = await prisma.botSession.create({
//         data: {
//           tenantId,
//           customerPhoneNumber: senderPhone,
//           currentNodeId: "WELCOME",
//         },
//       });
//     }

//     // Auto-reset sesi jika lebih dari 24 jam tidak ada balasan
//     if (session.currentNodeId !== "WELCOME" && session.updatedAt) {
//       const hoursInactive =
//         (Date.now() - new Date(session.updatedAt).getTime()) / (1000 * 60 * 60);
//       if (hoursInactive >= 24) {
//         session = await resetSessionToWelcome(
//           tenantId,
//           senderPhone,
//           "EXPIRED_SESSION",
//         );
//       }
//     }

//     // Perintah reset manual oleh pelanggan
//     if (["menu", "reset", "batal"].includes(incomingText.toLowerCase())) {
//       await resetSessionToWelcome(tenantId, senderPhone, "CANCELLED");
//       if (botConfig.subjects.length === 1) {
//         const companyIntro = sanitizeDbText(
//           botConfig.openingMessage,
//           `Halo! Selamat datang di *${botConfig.tenant?.businessName || "Layanan Kami"}*.`,
//         );
//         return await startSubjectInterview(
//           sock,
//           rawJid,
//           tenantId,
//           senderPhone,
//           botConfig,
//           botConfig.subjects[0],
//           companyIntro,
//         );
//       }
//       return await sendSubjectMenu(sock, rawJid, botConfig, incomingText);
//     }

//     // Jika sedang di dalam wawancara subjek aktif -> panggil processActiveInterview
//     const activeSubject = botConfig.subjects.find(
//       (s) => s.subjectId === session.currentNodeId,
//     );

//     if (activeSubject) {
//       return await processActiveInterview(
//         sock,
//         rawJid,
//         tenantId,
//         senderPhone,
//         incomingText,
//         botConfig,
//         activeSubject,
//       );
//     }

//     // Jika subjek hanya ada 1 -> langsung sapa profil perusahaan & mulai pertanyaan pertama tanpa pilih angka 1
//     if (botConfig.subjects.length === 1) {
//       const companyIntro = sanitizeDbText(
//         botConfig.openingMessage,
//         `Halo! Selamat datang di *${botConfig.tenant?.businessName || "Layanan Kami"}*.`,
//       );
//       return await startSubjectInterview(
//         sock,
//         rawJid,
//         tenantId,
//         senderPhone,
//         botConfig,
//         botConfig.subjects[0],
//         companyIntro,
//       );
//     }

//     // Jika subjek >= 2 -> cocokkan pilihan nomor/nama layanan, atau tampilkan daftar menu
//     const numericChoice = parseInt(incomingText, 10);
//     const matchedSubject =
//       botConfig.subjects.find(
//         (s) => s.name.toLowerCase() === incomingText.toLowerCase(),
//       ) ||
//       (!Number.isNaN(numericChoice) &&
//       numericChoice > 0 &&
//       numericChoice <= botConfig.subjects.length
//         ? botConfig.subjects[numericChoice - 1]
//         : null);

//     if (matchedSubject) {
//       return await startSubjectInterview(
//         sock,
//         rawJid,
//         tenantId,
//         senderPhone,
//         botConfig,
//         matchedSubject,
//       );
//     }

//     return await sendSubjectMenu(sock, rawJid, botConfig, incomingText);
//   } catch (error) {
//     console.error("🚨 [Bot Handler Error]:", error);
//   }
// }


// 2. SUB-PROSES A: Memulai wawancara subjek (Bisa dipanggil langsung jika subjek cuma 1, atau setelah pilih menu)

async function startSubjectInterview(
  sock,
  rawJid,
  tenantId,
  senderPhone,
  botConfig,
  subject,
  initialGreeting = "",
) {
  await prisma.botSession.update({
    where: {
      tenantId_customerPhoneNumber: {
        tenantId,
        customerPhoneNumber: senderPhone,
      },
    },
    data: { currentNodeId: subject.subjectId },
  });

  await prisma.lead.create({
    data: {
      tenantId,
      phoneNumber: senderPhone,
      status: "BOT_PROCESS",
      formData: {},
    },
  });

  const fields = (subject.targetData || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const closingText = sanitizeDbText(
    botConfig.closingMessage,
    "Baik, kami hubungkan Anda dengan tim kami.",
  );

  // Jika subjek tidak memiliki pertanyaan data wajib, langsung teruskan ke sales
  if (fields.length === 0) {
    const introPrefix = initialGreeting ? `${initialGreeting}\n\n` : "";
    await sock.sendMessage(rawJid, { text: `${introPrefix}${closingText}` });
    await allocateLeadsToSales(
      sock,
      rawJid,
      tenantId,
      subject,
      senderPhone,
      {},
    );
    return await resetSessionToWelcome(tenantId, senderPhone);
  }

  const firstField = fields[0];

  await sock.sendPresenceUpdate("composing", rawJid);
  const promptInstruction = initialGreeting
    ? `Pelanggan baru menyapa. Sapa pelanggan menggunakan profil perusahaan ini: "${initialGreeting}", lalu langsung lanjutkan menanyakan "${firstField}" untuk layanan "${subject.name}".`
    : `Pelanggan memilih layanan "${subject.name}". Mulai wawancara dengan menanyakan "${firstField}".`;

  const initialAi = await tryAskGemini(
    [{ role: "user", parts: [{ text: promptInstruction }] }],
    buildSystemPrompt(botConfig, subject, {}, fields, true),
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

async function processActiveInterview(
  sock,
  rawJid,
  tenantId,
  senderPhone,
  incomingText,
  botConfig,
  activeSubject,
) {
  const rawFields = (activeSubject.targetData || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const isMandatoryField = (field) => field.endsWith("*");
  const cleanFieldName = (field) => field.replace(/\*+$/, "").trim();
  const fields = rawFields.map(cleanFieldName);

  // Ambil atau buat sesi lead aktif
  let currentLead = await prisma.lead.findFirst({
    where: { tenantId, phoneNumber: senderPhone, status: "BOT_PROCESS" },
    orderBy: { createdAt: "desc" },
  });

  if (!currentLead) {
    currentLead = await prisma.lead.create({
      data: {
        tenantId,
        phoneNumber: senderPhone,
        status: "BOT_PROCESS",
        formData: {},
      },
    });
  }

  const savedData =
    typeof currentLead.formData === "object" && currentLead.formData !== null
      ? { ...currentLead.formData }
      : {};

  // Siapkan pesan penutup dari subjek aktif
  const closingText = sanitizeDbText(
    activeSubject.closingMessage,
    "Terima kasih sudah menghubungi kami. Tim kami akan segera menindaklanjuti kebutuhan Anda.",
  );

  // 2. DETEKSI JIKA PELANGGAN MINTA LANGSUNG TERHUBUNG KE SALES / ADMIN (Tahan typo)
  const isRequestingDirectSales =
    /\b((boleh\s*)?(la[a-z]{2,7}\s*)?(ke\s*|sama\s*|dengan\s*)?(sales|sale|admin|cs|orang|manusia|marketing|agen|staff)\b|minta\s*(kontak|nomor|no|wa|tlp|telp|telepon|chat)\s*(sales|admin|cs|marketing|agen|orang)?|hubungkan\s*(ke\s*|dengan\s*)?(sales|admin|cs|marketing|orang)|bicara\s*(dengan\s*|sama\s*)?(sales|admin|cs|orang|manusia)|ngobrol\s*(dengan\s*|sama\s*)?(sales|admin|cs|orang)|ada\s*(sales|admin|cs|orangnya)\b|jangan\s*(pakai\s*)?(bot|ai|robot))/i.test(
      incomingText,
    );

  if (isRequestingDirectSales) {
    // Tandai semua field NON-PRIORITAS (tanpa *) sebagai dilewati
    rawFields.forEach((rawField) => {
      const key = cleanFieldName(rawField);
      if (!isMandatoryField(rawField) && !savedData[key]) {
        savedData[key] = "- (Minta langsung ke Sales)";
      }
    });

    await prisma.lead.update({
      where: { leadId: currentLead.leadId },
      data: { formData: savedData },
    });

    // Cek apakah masih ada field PRIORITAS (*) yang belum terisi
    const remainingMandatory = rawFields
      .filter((f) => isMandatoryField(f))
      .map((f) => cleanFieldName(f))
      .filter((key) => !savedData[key]);

    // Jika tidak ada field prioritas tersisa -> Langsung kirim 1 bubble penutup + info sales!
    if (remainingMandatory.length === 0) {
      await allocateLeadsToSales(
        sock,
        rawJid,
        tenantId,
        activeSubject,
        senderPhone,
        savedData,
        closingText,
      );
      return await resetSessionToWelcome(tenantId, senderPhone);
    }

    // ✅ Perbaikan: Ambil 1 pertanyaan prioritas paling depan
    const nextMandatory = remainingMandatory[0];
    return await sock.sendMessage(rawJid, {
      text: `Tentu, kami akan segera menghubungkan Anda dengan tim kami. Sebagai syarat pengalihan ke tim terkait, mohon informasikan *${nextMandatory}* Anda terlebih dahulu ya:`,
    });
  }

  // 3. ALUR WAWANCARA NORMAL PER PERTANYAAN
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
      /\b(apa\s*aja|ada\s*apa|berapa|daftar|list|pilihan|tipe\s*apa|jenis\s*apa|info\s*harga|diskon|nego|potongan)\b/i.test(
        incomingText,
      );

    if (isCustomerAskingBack) {
      await sock.sendPresenceUpdate("composing", rawJid);

      // ✅ Gunakan helper formatProductCatalog (productName, costPrice, description, maxDiscount)
      const formattedCatalog = formatProductCatalog(botConfig.tenant?.products);
      const productList =
        formattedCatalog ||
        "Belum ada daftar katalog spesifik di sistem (berikan penjelasan umum yang ramah sesuai profil perusahaan, lalu arahkan ke tim sales untuk brosur/detail lengkap).";

      const askBackPrompt = `Kamu adalah CS AI dari ${botConfig.tenant?.businessName || "perusahaan kami"}.
      Profil Perusahaan: ${botConfig.openingMessage || "-"} 
      Katalog/Produk Tersedia:
      ${productList}
      Pelanggan sedang mengisi data "${currentField}", tetapi bertanya balik: "${incomingText}".
      ATURAN WAJIB:
      1. DILARANG mengucapkan salam pembuka ("Halo", "Selamat datang", dll) dan DILARANG mengulang perkenalan nama perusahaan lagi karena percakapan sudah berjalan.
      2. Jawab pertanyaannya secara ramah, singkat (maksimal 2 kalimat), dan jujur berdasarkan info katalog di atas. Patuhi batas max diskon masing-masing produk (jangan mengarang harga/diskon).
      3. Setelah menjawab singkat, langsung tanyakan kembali data "${currentField}".
      4. JANGAN tulis [[DATA_COMPLETE]].`;

      const answerReply = await tryAskGemini(
        [{ role: "user", parts: [{ text: incomingText }] }],
        askBackPrompt,
      );
      await sock.sendPresenceUpdate("paused", rawJid);

      return await sock.sendMessage(rawJid, {
        text:
          answerReply ||
          `Untuk pilihan *${currentField}*, tim sales kami akan mengirimkan katalog lengkapnya sebentar lagi. Boleh informasikan perkiraan *${currentField}* yang Anda minati terlebih dahulu?`,
      });
    }


    // ✅ Perbaikan AI-02: Normalkan jawaban mengelak (tanpa ditimpa ulang oleh incomingText)
    const isWindowShopping =
      !/nama/i.test(currentField) &&
      /\b(lihat[\s-]*lihat|liat[\s-]*liat|tanya[\s-]*tanya|belum\s*(tahu|tau|pasti|menentukan)|masih\s*bingung|cek\s*harga\s*dulu)\b/i.test(
        incomingText,
      );

    savedData[currentField] = isWindowShopping
      ? "Belum menentukan (Masih melihat-lihat)"
      : incomingText.trim();

    // 4. PERCABANGAN KONDISIONAL "(Jika Perusahaan)"
    const categoryEntry = Object.entries(savedData).find(([key]) =>
      /kategori|jenis pembeli|atas nama|keperluan/i.test(key),
    );
    // ✅ Perbaikan: Ambil value jawaban dari pasangan [key, value]
    const categoryAnswer = categoryEntry ? categoryEntry[1] : "";

    const isPribadi =
      /\b(pribadi|perorangan|individu|personal|sendiri|rumah\s*tangga)\b/i.test(
        String(categoryAnswer),
      ) &&
      !/\b(perusahaan|pt|cv|kantor|instansi|korporasi|b2b)\b/i.test(
        String(categoryAnswer),
      );

    if (isPribadi) {
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

  // 5. CEK SISA PERTANYAAN & PENUTUPAN
  const remainingFields = fields.filter((f) => !savedData[f]);
  // ✅ Perbaikan: Ambil 1 pertanyaan berikutnya paling depan
  const nextField = remainingFields.length > 0 ? remainingFields[0] : null;

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
    buildSystemPrompt(
      botConfig,
      activeSubject,
      savedData,
      remainingFields,
      false,
    ),
  );

  await sock.sendPresenceUpdate("paused", rawJid);

  if (aiReply) {
    const isComplete = aiReply.includes("[[DATA_COMPLETE]]") || !nextField;
    const cleanAiReply = aiReply.replace("[[DATA_COMPLETE]]", "").trim();

    if (isComplete) {
      const finalClosingMsg = cleanAiReply || closingText;
      await allocateLeadsToSales(
        sock,
        rawJid,
        tenantId,
        activeSubject,
        senderPhone,
        savedData,
        finalClosingMsg,
      );
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

  await allocateLeadsToSales(
    sock,
    rawJid,
    tenantId,
    activeSubject,
    senderPhone,
    savedData,
    closingText,
  );
  return await resetSessionToWelcome(tenantId, senderPhone);
}

async function allocateLeadsToSales(
  sock,
  rawJid,
  tenantId,
  sub,
  customerPhone,
  formData = {},
  closingMessage = "",
) {
  // ✅ 1. ATOMIC LOCK (B1-01): Cari & kunci sesi lead aktif secara atomik agar anti-duplikasi
  const targetLead = await prisma.lead.findFirst({
    where: { tenantId, phoneNumber: customerPhone, status: "BOT_PROCESS" },
    orderBy: { createdAt: "desc" },
  });

  if (!targetLead) {
    console.log(
      `⏭️ [B1-01 Skip Duplikat] Lead aktif tidak ditemukan atau sudah diproses untuk [${customerPhone}].`,
    );
    return;
  }

  // Kunci langsung statusnya menjadi "ASSIGNING" agar request paralel lain tertolak
  const lockResult = await prisma.lead.updateMany({
    where: {
      leadId: targetLead.leadId,
      status: "BOT_PROCESS",
    },
    data: {
      status: "ASSIGNING",
    },
  });

  if (lockResult.count === 0) {
    console.log(
      `⏭️ [B1-01 Race Condition Blocked] Penugasan ganda dicegah untuk [${customerPhone}].`,
    );
    return;
  }

  // 2. Pilih Sales berdasarkan skema DIRECT atau ROUND_ROBIN
  let selectedSales = null;
  if (sub.routingType === "DIRECT" && sub.targetSalesId) {
    const directSales = await prisma.user.findUnique({
      where: { userId: sub.targetSalesId },
    });
    if (directSales && directSales.isActive !== false) {
      selectedSales = directSales;
    }
  } else if (sub.routingType === "ROUND_ROBIN") {
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

  // 3. Finalisasi status lead menjadi ASSIGNED / UNASSIGNED
  await prisma.lead.update({
    where: { leadId: targetLead.leadId },
    data: {
      status: selectedSales ? "ASSIGNED" : "UNASSIGNED",
      assignedToSalesId: selectedSales ? selectedSales.userId : null,
      assignedSalesName: selectedSales ? selectedSales.name : null,
    },
  });

  const summaryLines = Object.entries(formData)
    .filter(([_, val]) => {
      const cleanVal = String(val || "").trim();
      return (
        cleanVal !== "" &&
        cleanVal !== "- (Pribadi)" &&
        cleanVal !== "- (Minta langsung ke Sales)"
      );
    })
    .map(([key, val]) => `• *${key}:* ${val}`)
    .join("\n");

  // ✅ Siapkan nama pelanggan & link WhatsApp dengan sapaan otomatis (?text=)
  const nameEntry = Object.entries(formData).find(
    ([key, val]) =>
      /nama/i.test(key) &&
      !/perusahaan|pt|cv|instansi/i.test(key) &&
      val &&
      !String(val).startsWith("- ("),
  );
  const customerName = nameEntry
    ? String(nameEntry[1]).trim().replace(/\b\w/g, (c) => c.toUpperCase())
    : "Kak";

  const salesGreeting = encodeURIComponent(
    `Halo Kak ${customerName}, perkenalkan saya ${selectedSales?.name || "Tim"} menindaklanjuti permintaan Anda terkait *${sub.name}*. Ada yang bisa kami bantu lebih lanjut?`,
  );

  const cleanPhone = String(customerPhone || "").replace(/[^0-9]/g, "").replace(/^0/, "62");
  const waCustomerLink = ["https://wa.me", cleanPhone].join("/") + "?text=" + salesGreeting;
  const waCustomerLinkGroup = ["wa.me", cleanPhone].join("/");

  // ✅ Siapkan nomor & JID Sales sekali saja agar bisa dipakai untuk japri & mention grup
  const cleanSalesPhone = selectedSales?.phoneNumber
    ? String(selectedSales.phoneNumber).replace(/[^0-9]/g, "").replace(/^0/, "62")
    : "";
  const salesJid = cleanSalesPhone ? `${cleanSalesPhone}@s.whatsapp.net` : null;

  // 4. Gabungkan pesan penutup + info nama sales dalam 1 gelembung chat ke customer
  if (selectedSales && salesJid) {
    const salesInfoText = `👤 *Tim Sales yang Menangani:* *${selectedSales.name}*\nPermintaan Anda telah diteruskan kepada *${selectedSales.name}* dan akan segera menghubungi Anda.`;
    const finalBubbleToCustomer = closingMessage
      ? `${closingMessage}\n\n${salesInfoText}`
      : salesInfoText;

    await sock.sendMessage(rawJid, { text: finalBubbleToCustomer });

    // Kirim notifikasi japri ke WhatsApp Sales yang bersangkutan
    await sock
      .sendMessage(salesJid, {
        text: `👥 *[LEADS BARU - ${sub.name}]*\n\nHalo *${selectedSales.name}*, Anda mendapatkan prospek baru:\n${summaryLines || "• Pelanggan meminta langsung terhubung ke tim sales"}\n\nHubungi Customer:\n${waCustomerLink}`,
      })
      .catch((err) => {
        console.error(
          `⚠️ Gagal mengirim notifikasi ke sales (${selectedSales.name}):`,
          err.message,
        );
      });
  } else if (closingMessage) {
    await sock.sendMessage(rawJid, { text: closingMessage });
  }

  // 5. Ambil salesGroupJid dari botConfig dan kirim ke Grup Sales (jika diatur)
  const config = await prisma.aiBotConfig.findUnique({
    where: { tenantId },
    select: { salesGroupJid: true },
  });

  if (config?.salesGroupJid) {

    const groupJid = config.salesGroupJid.includes("@g.us")
      ? config.salesGroupJid.trim()
      : `${config.salesGroupJid.trim()}@g.us`;

    const picSalesText =
      selectedSales && cleanSalesPhone
        ? `@${cleanSalesPhone}`
        : "Belum ditentukan";

    await sock
      .sendMessage(groupJid, {
        text:
          `📢 *[PROSPEK BARU - ${sub.name}]*\n\n` +
          `👤  *PIC Sales:* ${picSalesText}\n` +
          `📱  *Nomor Customer:* ${waCustomerLinkGroup}\n\n` +
          `*Detail Kebutuhan:*\n${summaryLines || "• Pelanggan meminta langsung terhubung ke tim sales"}\n\n` +
          `_Mohon segera ditindaklanjuti._`,
        mentions: salesJid ? [salesJid] : [],
      })
      .catch((err) => {
        console.error(
          "⚠️ Gagal mengirim notifikasi ke Grup Sales:",
          err.message,
        );
      });
  }
}

async function sendSubjectMenu(sock, rawJid, botConfig, incomingText = "") {
  const companyName = botConfig.tenant?.businessName || "kami";
  const companyProfile = sanitizeDbText(
    botConfig.openingMessage,
    `Kami dari ${companyName} siap membantu kebutuhan Anda.`,
  );

  // Format daftar menu dari database
  const menuList = botConfig.subjects
    .map((s, idx) => `${idx + 1}. *${s.name}*`)
    .join("\n");

  const menuBlock = `📋 *PILIHAN LAYANAN:*\n${menuList}\n\n_Balas dengan angka (contoh: *1*) atau ketik nama layanan di atas._`;

  // Cek apakah pesan masuk adalah sapaan atau pertanyaan umum (bukan perintah "menu")
  const isPureCommand = ["menu", "reset", "batal"].includes(
    incomingText.toLowerCase(),
  );
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
      `Kamu adalah Customer Service WhatsApp yang ramah untuk "${companyName}". Gunakan bahasa Indonesia yang luwes, hangat, dan tidak kaku.`,
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
