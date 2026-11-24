const express = require('express');
const router = express.Router();
const {
  getBillingPlans,
  createCheckoutTransaction,
  approveTransaction,
  getAllTransactions,
  rejectTransaction
} = require('../controllers/billingController');

// Middleware proteksi khusus Super Admin (menggunakan ADMIN_SECRET_KEY dari .env)
const verifySuperAdmin = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  const validKey = process.env.ADMIN_SECRET_KEY || 'Danton8Paskib!';

  if (adminKey !== validKey && req.user?.role?.toUpperCase() !== 'SUPERADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak: Kunci Super Admin tidak valid.',
    });
  }
  next();
};

// Rute untuk Tenant
router.get('/plans', getBillingPlans);
router.post('/checkout', createCheckoutTransaction);

// Rute Khusus Super Admin (Pemilik SaaS)
router.get('/transactions', verifySuperAdmin, getAllTransactions);
router.post('/approve/:orderId', verifySuperAdmin, approveTransaction);
router.post('/reject/:orderId', verifySuperAdmin, rejectTransaction);


module.exports = router;


// const express = require('express');
// const router = express.Router();
// const {
//   getBillingPlans,
//   createCheckoutTransaction,
//   approveTransaction,
//   getAllTransactions,
// } = require('../controllers/billingController');

// router.get('/plans', getBillingPlans);
// router.post('/checkout', createCheckoutTransaction);
// router.get('/transactions', getAllTransactions);
// router.post('/approve/:orderId', approveTransaction);

// module.exports = router;