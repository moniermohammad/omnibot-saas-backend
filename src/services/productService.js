const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const createProduct = async (tenantId, productData) => {
  const { productName, description, costPrice, maxDiscount, status } = productData;
  return await prisma.product.create({
    data: {
      tenantId,
      productName,
      description,
      costPrice: parseFloat(costPrice),
      maxDiscount: maxDiscount ? parseFloat(maxDiscount) : 0.0,
      status: status || "ACTIVE",
    },
  });
};

const getAllProducts = async (tenantId) => {
  return await prisma.product.findMany({
    where: { tenantId },
    orderBy: { productName: "asc" },
  });
};

const getProductById = async (id, tenantId) => {
  return await prisma.product.findFirst({
    where: { productId: id, tenantId },
  });
};

const updateProduct = async (id, tenantId, updateData) => {
  const { productName, description, costPrice, maxDiscount, status } = updateData;
  return await prisma.product.update({
    where: { productId: id },
    data: {
      productName,
      description,
      costPrice: costPrice ? parseFloat(costPrice) : undefined,
      maxDiscount: maxDiscount ? parseFloat(maxDiscount) : undefined,
      status,
    },
  });
};

const deleteProduct = async (id, tenantId) => {
  return await prisma.product.deleteMany({
    where: {
      productId: id,
      tenantId: tenantId, // 👈 Mengunci keamanan agar tidak bisa hapus produk tenant lain
    },
  });
};

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
