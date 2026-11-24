// ⚠️ Note: Import static Baileys require() dihapus dari bagian atas file
// untuk menghindari error ERR_REQUIRE_ESM.

const LID_MAP = {
  275655463817301: "628558836680",
};

// 🌟 Diubah menjadi async function agar bisa mengimpor Baileys secara dinamis
async function extractRealSender(msg) {
  // Dynamic import Baileys saat fungsi dijalankan
  const { jidNormalizedUser } = await import("@whiskeysockets/baileys");

  const participantJid = msg.key.participant || msg.participant || msg.key.remoteJid;
  const msgType = Object.keys(msg.message || {})[0];
  const contextInfo = msg.message?.[msgType]?.contextInfo;
  const realSenderJid = contextInfo?.sender || participantJid;

  const cleanJid = jidNormalizedUser(realSenderJid);
  let senderPhoneNumber = cleanJid.split("@")[0];

  // Anti-LID Number Strategy
  if (senderPhoneNumber.length >= 15 || senderPhoneNumber.startsWith("275")) {
    const alternateJid = jidNormalizedUser(msg.key.remoteJid).split("@")[0];
    if (alternateJid && alternateJid.length < 15 && !alternateJid.startsWith("275")) {
      senderPhoneNumber = alternateJid;
    } else if (LID_MAP[senderPhoneNumber]) {
      senderPhoneNumber = LID_MAP[senderPhoneNumber];
    }
  }
  return senderPhoneNumber;
}

function getBotNumber(sock) {
  return sock.user.id.split(":")[0].replace(/[^0-9]/g, "");
}

module.exports = { extractRealSender, getBotNumber };

// const { jidNormalizedUser } = require('@whiskeysockets/baileys');

// const LID_MAP = {
//     "275655463817301": "628558836680"
// };

// function extractRealSender(msg) {
//     const participantJid = msg.key.participant || msg.participant || msg.key.remoteJid;
//     const msgType = Object.keys(msg.message || {})[0];
//     const contextInfo = msg.message?.[msgType]?.contextInfo;
//     const realSenderJid = contextInfo?.sender || participantJid;

//     const cleanJid = jidNormalizedUser(realSenderJid);
//     let senderPhoneNumber = cleanJid.split('@')[0];

//     // Anti-LID Number Strategy
//     if (senderPhoneNumber.length >= 15 || senderPhoneNumber.startsWith('275')) {
//         const alternateJid = jidNormalizedUser(msg.key.remoteJid).split('@')[0];
//         if (alternateJid && alternateJid.length < 15 && !alternateJid.startsWith('275')) {
//             senderPhoneNumber = alternateJid;
//         } else if (LID_MAP[senderPhoneNumber]) {
//             senderPhoneNumber = LID_MAP[senderPhoneNumber];
//         }
//     }
//     return senderPhoneNumber;
// }

// function getBotNumber(sock) {
//     return sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
// }

// module.exports = { extractRealSender, getBotNumber };
