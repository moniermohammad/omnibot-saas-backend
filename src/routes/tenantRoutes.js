const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const { getTenantSettings, updateTenantProfile, deleteTenantAccount  } = require("../controllers/tenantController");
// ====================================================================
// 🔐 ENDPOINT AUTH
// ====================================================================
router.get("/get", authenticateToken, getTenantSettings);
router.put("/update", authenticateToken, updateTenantProfile);
router.delete("/delete", authenticateToken, deleteTenantAccount);

module.exports = router; // 👍 Ekspor tunggal objek router standar
