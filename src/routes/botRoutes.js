const express = require("express");
const router = express.Router();
const { authenticateToken, authenticateBotKey } = require("../middleware/authMiddleware");
const { saveBotConfiguration, getBotConfiguration,  } = require("../controllers/botConfigController");
const { checkBotStatus, disconnectBot, getBotQrCode, getWhatsAppGroups } = require("../controllers/botConfigController");
const { createLead } = require("../controllers/crmController");
// const chatbotController = require("../controllers/chatbotController");
const { chatbotController } = require("../controllers/chatbotController");

// ====================================================================
// 💼 ENDPOINT DATA CRM BOT
// ====================================================================
router.post("/crm/new-leads", authenticateBotKey, createLead);
router.get("/bot-cek", authenticateToken, checkBotStatus);
router.get("/bot-disconnect", authenticateToken, disconnectBot);
router.get("/get-qr-code", authenticateToken, getBotQrCode);
// Sesuaikan nama middleware auth kamu (misalnya verifyToken atau authenticate)
router.get("/wa/groups/:tenantId", authenticateToken, getWhatsAppGroups);


// ====================================================================
// 🤖 ENDPOINT SETING CHATBOT
// ====================================================================

router.get("/editor/get-config", authenticateToken, chatbotController.getEditorNodes);
router.post("/editor/save-config", authenticateToken, chatbotController.saveConfig);
// router.post("/editor/node", authenticateToken, chatbotController.saveNode);
// router.post("/editor/option", authenticateToken, chatbotController.saveOption);
// router.delete("/editor/node/:nodeId", authenticateToken, chatbotController.removeNode);
// router.delete("/editor/option/:optionId", authenticateToken, chatbotController.removeOption);

module.exports = router; // 👍 Pastikan mengekspor objek router standar
