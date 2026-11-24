const express = require("express");
const router = express.Router();
const { authenticateToken, authenticateBotKey } = require("../middleware/authMiddleware");
const { createProduct, getAllProducts, getProductById, updateProduct, deleteProduct } = require("../controllers/productController");
// ====================================================================
// 🔐 ENDPOINT master produk
// ====================================================================
router.post("/products", authenticateToken, createProduct);
router.get("/products", authenticateToken, getAllProducts);
router.get("/products/:id", authenticateToken, getProductById);
router.put("/products/:id", authenticateToken, updateProduct);
router.delete("/products/:id", authenticateToken, deleteProduct);

module.exports = router; // 👍 Ekspor tunggal objek router standar
