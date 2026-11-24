// src/config/saasPlans.js

// Tentukan batasan kuota sales untuk masing-masing jenis tenant
const SAAS_PLANS = {
  PERSONAL: {
    name: "Paket Personal",
    maxSales: 2, // Hanya boleh punya maksimal 2 sales
  },
  BUSINESS: {
    name: "Paket Bisnis Premium",
    maxSales: 10, // Boleh punya maksimal 10 sales
  },
  ENTERPRISE: {
    name: "Paket Enterprise Skala Besar",
    maxSales: 9999, // Kuota tidak terbatas / unlimited
  }
};

module.exports = { SAAS_PLANS };
