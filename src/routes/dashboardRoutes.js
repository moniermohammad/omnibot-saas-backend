// src/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const { getDashboardOverviewData } = require('../controllers/dashboardController');
const { authenticateToken } = require("../middleware/authMiddleware"); // Gunakan middleware token Anda

// Endpoint terproteksi login untuk memuat ringkasan data dasbor
router.get('/overview', authenticateToken, getDashboardOverviewData);

module.exports = router;
