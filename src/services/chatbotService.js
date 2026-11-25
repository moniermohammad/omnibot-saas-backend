const prisma = require("../../config/prisma");

async function getConfig(tenantId) {
  try {
    return await prisma.aiBotConfig.findUnique({
      where: { tenantId },
      include: { 
        subjects: {
          orderBy: { orderIndex: 'asc' }
        }
      } 
    });
  } catch (error) {
    console.error('🚨 [Chatbot Service] Error Get Config:', error);
    throw error;
  }
}


/**
 * 💾 Simpan atau Update Data Konfigurasi AI Global dengan Skema Overwrite Otomatis
 */
async function saveChatbotConfig(tenantId, configData) {
  const { openingMessage, keywordTrigger, salesGroupJid, subjects } = configData;

  try {
    return await prisma.$transaction(async (tx) => {
      
      // A. Upsert konfigurasi utama (tanpa closingMessage)
      const config = await tx.aiBotConfig.upsert({
        where: { tenantId },
        update: { 
          openingMessage, 
          keywordTrigger: keywordTrigger || "GLOBAL_FLOW",
          salesGroupJid: salesGroupJid || null 
        },
        create: { 
          tenantId, 
          openingMessage, 
          keywordTrigger: keywordTrigger || "GLOBAL_FLOW",
          salesGroupJid: salesGroupJid || null 
        }
      });

      // B. Hapus seluruh opsi subjek lama milik tenant ini
      await tx.aiBotSubject.deleteMany({
        where: { configId: config.configId }
      });

      // C. Masukkan secara masal data opsi subjek baru beserta orderIndex
      if (subjects && subjects.length > 0) {
        const preparedSubjects = subjects.map((sub, index) => {
          let finalSalesId = null;

          if (sub.routingType === 'DIRECT' && sub.targetSalesId) {
            if (!sub.targetSalesId.startsWith('sales_')) {
              finalSalesId = sub.targetSalesId;
            }
          }

          return {
            configId: config.configId,
            orderIndex: index, // <-- 1. Simpan urutan persis sesuai posisi di Web (#1 = 0, #2 = 1)
            name: sub.name || "Subjek Tanpa Nama",
            targetData: sub.targetData || "",
            toneStyle: sub.toneStyle || "Ramah",
            closingMessage: sub.closingMessage || "",
            routingType: sub.routingType || 'ROUND_ROBIN',
            targetSalesId: finalSalesId,
            aiPrompt: sub.aiPrompt || ""
          };
        });

        await tx.aiBotSubject.createMany({
          data: preparedSubjects
        });
      }

      // 2. Kembalikan data dengan urutan orderIndex ascending
      return await tx.aiBotConfig.findUnique({
        where: { configId: config.configId },
        include: {
          subjects: {
            orderBy: { orderIndex: 'asc' }
          }
        }
      });
    });
  } catch (error) {
    console.error('🚨 [Chatbot Service] Gagal memproses transaksi saveChatbotConfig:', error.message);
    throw error;
  }
}


async function upsertChatbotNode(tenantId, data) {
  const { nodeId, nodeType, messageText, isFormInput, saveToField, nextDefaultNodeId } = data;

  try {
    // Jika nodeId dikirim dari Flutter, artinya UPDATE. Jika kosong, gunakan id gres.
    const targetNodeId = nodeId || undefined;

    return await prisma.botNode.upsert({
      where: { nodeId: targetNodeId || "NEW_NODE_PLACEHOLDER" },
      update: {
        nodeType: nodeType || "STANDARD",
        messageText,
        isFormInput: isFormInput || false,
        saveToField: isFormInput ? saveToField : null, // Hanya isi field jika berupa input formulir
        nextDefaultNodeId,
      },
      create: {
        nodeId: nodeId, // Jika dari Flutter kosong, Prisma otomatis menembak @default(uuid())
        tenantId,
        nodeType: nodeType || "STANDARD",
        messageText,
        isFormInput: isFormInput || false,
        saveToField: isFormInput ? saveToField : null,
        nextDefaultNodeId,
      },
    });
  } catch (error) {
    console.error(`🚨 [Chatbot Service] Gagal melakukan upsert BotNode:`, error.message);
    throw error;
  }
}

/**
 * 3. Simpan / Update Tombol Menu Pilihan (BotOption)
 */
async function upsertBotOption(nodeId, data) {
  const { optionId, triggerKey, label, nextNodeId } = data;
  const cleanKey = triggerKey.toLowerCase().trim();

  try {
    if (optionId) {
      return await prisma.botOption.update({
        where: { optionId },
        data: { triggerKey: cleanKey, label, nextNodeId },
      });
    }
    return await prisma.botOption.upsert({
      where: {
        nodeId_triggerKey: {
          nodeId,
          triggerKey: cleanKey,
        },
      },
      update: {
        label,
        nextNodeId,
      },
      create: {
        nodeId,
        triggerKey: cleanKey,
        label,
        nextNodeId,
      },
    });
  } catch (error) {
    console.error(`🚨 [Chatbot Service] Gagal mengunci data BotOption:`, error.message);
    throw error;
  }
}

/**
 * 4. Hapus Pertanyaan (BotNode) dari Database Klien
 * Efek Cascade: Seluruh BotOption di dalamnya otomatis ikut terhapus bersih oleh PostgreSQL!
 */
async function deleteTenantNode(nodeId, tenantId) {
  try {
    return await prisma.botNode.delete({
      where: { nodeId, tenantId },
    });
  } catch (error) {
    console.error(`🚨 [Chatbot Service] Gagal menghapus BotNode [${nodeId}]:`, error.message);
    throw error;
  }
}

/**
 * 5. Menghapus Opsi Tombol Menu Pilihan secara mandiri
 */
async function deleteBotOption(optionId) {
  try {
    return await prisma.botOption.delete({
      where: { optionId },
    });
  } catch (error) {
    console.error(`🚨 [Chatbot Service] Gagal menghapus BotOption [${optionId}]:`, error.message);
    throw error;
  }
}

async function getAllTenantNodes(tenantId) {
  try {
    return await prisma.botNode.findMany({
      where: { tenantId },
      include: { options: true },
      orderBy: { nodeType: "desc" }, // Membuat node WELCOME otomatis di baris paling atas
    });
  } catch (error) {
    console.error(`🚨 [Chatbot Service] Gagal mengambil list node tenant [${tenantId}]:`, error.message);
    throw error;
  }
}

module.exports = {
  getAllTenantNodes,
  upsertChatbotNode,
  upsertBotOption,
  deleteTenantNode,
  deleteBotOption,
  getConfig,
  saveChatbotConfig
};
