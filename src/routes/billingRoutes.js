const express = require("express");
const router = express.Router();
const {
  getBillingPlans,
  createCheckoutTransaction,
  approveTransaction,
  getAllTransactions,
  rejectTransaction,
  getTenantWaMonitor,    // <-- Tambahkan ini
  forceReconnectTenant,  // <-- Tambahkan ini
  suspendTenant
} = require("../controllers/billingController");

const {
  getMasterBotQrCode,
  disconnectMasterBot,
} = require("../controllers/masterBotController");

// Middleware proteksi khusus Super Admin (menggunakan ADMIN_SECRET_KEY dari .env)
const verifySuperAdmin = (req, res, next) => {
  const adminKey = req.headers["x-admin-key"];
  const validKey = process.env.ADMIN_SECRET_KEY || "Danton8Paskib!";

  if (adminKey !== validKey && req.user?.role?.toUpperCase() !== "SUPERADMIN") {
    return res.status(403).json({
      success: false,
      message: "Akses ditolak: Kunci Super Admin tidak valid.",
    });
  }
  next();
};

// Rute untuk Tenant
router.get("/plans", getBillingPlans);
router.post("/checkout", createCheckoutTransaction);

// Rute Khusus Super Admin (Pemilik SaaS)
router.get("/transactions", verifySuperAdmin, getAllTransactions);
router.post("/approve/:orderId", verifySuperAdmin, approveTransaction);
router.post("/reject/:orderId", verifySuperAdmin, rejectTransaction);
// Rute Monitor Tenant & Koneksi WA (T2-13)
router.get("/tenants-monitor", verifySuperAdmin, getTenantWaMonitor);
router.post("/tenants/:tenantId/reconnect", verifySuperAdmin, forceReconnectTenant);
router.post("/tenants/:tenantId/suspend", verifySuperAdmin, suspendTenant);


// Pasang middleware otorisasi Superadmin yang sama dengan endpoint billing Anda
router.get("/master-bot/qr", verifySuperAdmin, getMasterBotQrCode);
router.post("/master-bot/disconnect", verifySuperAdmin, disconnectMasterBot);

module.exports = router;
