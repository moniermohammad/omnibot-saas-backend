const express = require("express");
const router = express.Router();
const { requestLoginToken, verifyLoginToken,  } = require("../controllers/authController");
const { executeRegister,renewTenantSubscription } = require("../controllers/registerController");
const { authenticateToken } = require("../middleware/authMiddleware");
// ====================================================================
// 🔐 ENDPOINT AUTH
// ====================================================================
router.post("/request-token", requestLoginToken);
router.post("/verify-token", verifyLoginToken);
router.post("/register", executeRegister);
router.post("/renew", authenticateToken, renewTenantSubscription);

module.exports = router; // 👍 Ekspor tunggal objek router standar
