// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { addSalesByOwner, getTenantSalesList, deleteSales, toggleSalesStatus } = require('../controllers/salesController');
const { authenticateToken } = require("../middleware/authMiddleware");

router.post('/sales', authenticateToken, addSalesByOwner);
router.get('/sales/list', authenticateToken, getTenantSalesList);
router.patch('/sales/:userId/toggle-status', authenticateToken, toggleSalesStatus); // <-- Tambahkan baris ini
router.delete('/sales/:id', authenticateToken, deleteSales);

module.exports = router;

// // src/routes/userRoutes.js
// const express = require('express');
// const router = express.Router();
// const { addSalesByOwner, getTenantSalesList, deleteSales, toggleSalesStatus  } = require('../controllers/salesController');
// const { authenticateToken } = require("../middleware/authMiddleware");

// router.post('/sales', authenticateToken, addSalesByOwner);
// router.get('/sales/list', authenticateToken, getTenantSalesList);
// router.delete('/sales/:id', authenticateToken, deleteSales);

// module.exports = router;
