const express = require("express");
const router = express.Router();
const { getAllLeads, getLeadById, updateLeadStatus, createSchedule, getSchedules, createLead, updatedLead, deleteLead } = require("../controllers/crmController");
const { authenticateToken, authenticateBotKey } = require("../middleware/authMiddleware");

// ====================================================================
// 💼 ENDPOINT DATA CRM
// ====================================================================
router.get("/leads", authenticateToken, getAllLeads);
router.get("/leads/:id", authenticateToken, getLeadById);
router.post("/leads", authenticateToken, createLead);
router.put("/leads/:id", authenticateToken, updatedLead);
router.delete("/leads/:id", authenticateToken, deleteLead);

// ====================================================================
// 🗓️ ENDPOINT JADWAL CRM
// ====================================================================
router.post("/crm/schedules", authenticateToken, createSchedule);
router.get("/crm/schedules", authenticateToken, getSchedules);

// ====================================================================
// 🤖 HUBUNGKAN SUB-ROUTER CHATBOT (Karena satu folder, gunakan ./botRoutes)
// ====================================================================
// const botRoutes = require("./botRoutes");
// router.use("/bot", botRoutes);

module.exports = router; // 👍 Ekspor tunggal objek router standar
