const express = require('express');
const router = express.Router();
const { getAllLeads, updateLeadStatus } = require('../controllers/leadController');
// const { protect } = require('../middlewares/authMiddleware'); // Sesuaikan nama/path middleware JWT kamu
const { authenticateToken } = require("../middleware/authMiddleware");

router.get('/', authenticateToken, getAllLeads);
router.put('/:id/status', authenticateToken, updateLeadStatus);

module.exports = router;

// const express = require("express");
// const router = express.Router();
// // 1. Impor Controller Autentikasi OTP Tanpa Sandi dari WhatsApp Master Bot
// const { requestLoginToken, verifyLoginToken } = require("../controllers/authController");
// // 2. Impor Controller Operasional Leads Milik Anda
// const { getDashboardLeads, updateLeadStatus, createSchedule, getSchedules } = require("../controllers/crmController");
// // 3. 🌟 SOLUSI BERSIH: Impor fungsi satpam keamanan dari file middleware terpisah
// const { authenticateToken } = require("../middleware/authMiddleware");

// // ====================================================================
// // 🔐 GRUP ENDPOINT A: GERBANG MASUK TANPA SANDI (PASSWORDLESS OTP)
// // ====================================================================
// // Pintu terbuka (Public API) -> Tidak boleh dipasangi authenticateToken
// router.post("/auth/request-token", requestLoginToken);
// router.post("/auth/verify-token", verifyLoginToken);

// // ====================================================================
// // 💼 GRUP ENDPOINT B: OPERASIONAL DATA CRM LEADS (DILINDUNGI JWT)
// // ====================================================================
// // Pintu terkunci (Protected API) -> Wajib dipasangi authenticateToken
// // router.get('/crm/leads', authenticateToken, getDashboardLeads);
// // router.put('/crm/leads/:id', authenticateToken, updateLeadStatus);

// // ====================================================================
// // 🗓️ GRUP ENDPOINT C: OPERASIONAL JADWAL KALENDER CRM (DILINDUNGI JWT)
// // ====================================================================
// // router.post('/crm/schedules', authenticateToken, createSchedule);
// // router.get('/crm/schedules', authenticateToken, getSchedules);

// // ====================================================================
// // 🤖 SUB-ROUTER CHATBOT DINAMIS BERCABANG (DILINDUNGI JWT)
// // ====================================================================
// // const botRoutes = require("./botRoutes");
// // router.use("/bot", botRoutes); // Mendaftarkannya dengan sub-prefix /bot

// // 🌟 EKSPOR STANDAR: Cukup ekspor objek router saja agar index.js kembali normal 100%
// module.exports = router;
