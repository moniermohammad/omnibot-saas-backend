const productService = require("../services/productService");

// ==========================================
// 1. POST /api/master/products
// ==========================================
const createProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;
    const currentUserId = req.user?.id || req.user?.userId;

    const { productName, description, costPrice, maxDiscount, status } = req.body;

    if (!productName || !costPrice) {
      return res.status(400).json({
        status: "Error",
        message: "Nama produk dan harga HPP wajib diisi.",
      });
    }

    const productData = {
      productName,
      description,
      costPrice,
      maxDiscount,
      status,
    };

    const newProduct = await productService.createProduct(tenantId, productData);

    res.status(201).json({
      status: "Sukses",
      message: "Produk berhasil ditambahkan.",
      data: newProduct,
    });
  } catch (error) {
    console.error("❌ Error Create Product Controller:", error);
    res.status(500).json({ status: "Error", message: "Gagal menambahkan produk." });
  }
};

// ==========================================
// 2. GET /api/master/products
// ==========================================
const getAllProducts = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    const products = await productService.getAllProducts(tenantId);

    res.status(200).json({ status: "Sukses", total: products.length, data: products });
  } catch (error) {
    console.error("❌ Error Get All Products Controller:", error);
    res.status(500).json({ status: "Error", message: "Gagal mengambil data produk." });
  }
};

// ==========================================
// 3. GET /api/master/products/:id
// ==========================================
const getProductById = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const { id } = req.params; // 🌟 PERBAIKAN: Bongkar id dari parameter URL agar tidak undefined

    const product = await productService.getProductById(id, tenantId);

    if (!product) {
      return res.status(404).json({ status: "Error", message: "Produk tidak ditemukan." });
    }

    res.status(200).json({ status: "Sukses", data: product });
  } catch (error) {
    console.error("❌ Error Get Product By ID Controller:", error);
    res.status(500).json({ status: "Error", message: "Gagal mengambil detail produk." });
  }
};

// ==========================================
// 4. PUT /api/master/products/:id
// ==========================================
const updateProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const { id } = req.params; // 🌟 PERBAIKAN: Bongkar id dari parameter URL

    const checkProduct = await productService.getProductById(id, tenantId);

    if (!checkProduct) {
      return res.status(404).json({ status: "Error", message: "Produk tidak ditemukan." });
    }

    const { productName, description, costPrice, maxDiscount, status } = req.body;
    const updateData = { productName, description, costPrice, maxDiscount, status };

    const updatedProduct = await productService.updateProduct(id, tenantId, updateData);

    res.status(200).json({ status: "Sukses", message: "Produk berhasil diperbarui.", data: updatedProduct });
  } catch (error) {
    console.error("❌ Error Update Product Controller:", error);
    res.status(500).json({ status: "Error", message: "Gagal memperbarui produk." });
  }
};

// ==========================================
// 5. DELETE /api/master/products/:id
// ==========================================
const deleteProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId; // 🌟 PERBAIKAN: Gunakan satu deklarasi tenantId yang aman
    const { id } = req.params;

    const checkProduct = await productService.getProductById(id, tenantId);

    if (!checkProduct) {
      return res.status(404).json({ status: "Error", message: "Produk tidak ditemukan." });
    }

    await productService.deleteProduct(id);

    res.status(200).json({ status: "Sukses", message: "Produk berhasil dihapus." });
  } catch (error) {
    console.error("❌ Error Delete Product Controller:", error);

    if (error.code === "P2003") {
      return res.status(400).json({
        status: "Error",
        message: "Produk gagal dihapus karena masih digunakan dalam dokumen penawaran harga (Quotation) yang aktif.",
      });
    }

    res.status(500).json({ status: "Error", message: "Gagal menghapus produk." });
  }
};

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
