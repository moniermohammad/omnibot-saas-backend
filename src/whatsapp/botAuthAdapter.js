// src/whatsapp/botAuthAdapter.js
const { PrismaClient } = require("@prisma/client");
const { getAuthValue, saveAuthValue, deleteAuthValue } = require("../services/botService");

const prisma = new PrismaClient();

async function usePrismaAuthState(tenantId) {
  const { BufferJSON, initAuthCreds, proto } = await import("@whiskeysockets/baileys");

  const rawCreds = await getAuthValue(tenantId, "creds");
  const creds = rawCreds ? JSON.parse(rawCreds, BufferJSON.reviver) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          // Jalankan pembacaan secara paralel agar jauh lebih cepat
          await Promise.all(
            ids.map(async (id) => {
              const rawValue = await getAuthValue(tenantId, `${type}-${id}`);
              let value = rawValue ? JSON.parse(rawValue, BufferJSON.reviver) : null;

              // Wajib konversi proto khusus app-state-sync-key
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              if (value) {
                const stringified = JSON.stringify(value, BufferJSON.replacer);
                tasks.push(saveAuthValue(tenantId, key, stringified));
              } else {
                tasks.push(deleteAuthValue(tenantId, key));
              }
            }
          }
          // Simpan/hapus semua kunci secara bersamaan
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      const stringifiedCreds = JSON.stringify(creds, BufferJSON.replacer);
      await saveAuthValue(tenantId, "creds", stringifiedCreds);
    },
  };
}

// Fungsi bersih-bersih otomatis saat Status 401 (Logged Out)
async function clearPrismaAuthState(tenantId) {
  try {
    const result = await prisma.whatsappAuth.deleteMany({
      where: { tenantId },
    });
    console.log(`🧹 [Prisma Auth] Berhasil menghapus ${result.count} sesi lama milik Tenant [${tenantId}].`);
  } catch (err) {
    console.error(`🚨 Gagal menghapus sesi Prisma untuk [${tenantId}]:`, err);
  }
}

module.exports = { usePrismaAuthState, clearPrismaAuthState };
