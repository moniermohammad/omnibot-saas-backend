const express = require("express");
const http = require("http"); // 🌟 TAMBAHAN: Untuk mendukung WebSocket
const { Server } = require("socket.io"); // 🌟 TAMBAHAN: Import Socket.io
const cors = require("cors"); // 🚀 TAMBAHAN: Import library CORS untuk Express
require("dotenv").config();

const { connectToWhatsApp, restoreAllTenantSessions } = require("./src/whatsapp/connection");
const crmRoutes = require("./src/routes/crmRoutes"); // Impor rute CRM terpadu
const botRoutes = require("./src/routes/botRoutes"); // 👈 Tambahkan ini
// const leadRoutes = require("./src/routes/leadRoutes");
const authRoutes = require("./src/routes/authRoutes"); // 👈 Tambahkan
const produckRoutes = require("./src/routes/produkRoutes"); // 👈 Tambahkan
const salesRoutes = require("./src/routes/salesRoutes"); // 👈 Tambahkan
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const billingRoutes = require('./src/routes/billingRoutes');

const leadRoutes = require('./src/routes/leadRoutes'); // Sesuaikan path relative-nya
const tenantRoutes = require('./src/routes/tenantRoutes'); // Sesuaikan path relative-nya

// const { connectToWhatsApp, restoreAllTenantSessions } = require("./path/ke/baileysEngine");


const app = express();
const PORT = process.env.PORT || 3000;

// ?? KUNCI UTAMA: Aktifkan CORS dinamis agar aman saat IP server berubah
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));


app.use(express.json());

// Buat server HTTP menggunakan Express
const server = http.createServer(app);

// Inisialisasi Socket.io dengan konfigurasi CORS bebas untuk Flutter / Web Frontend
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// 🌟 KUNCI EMAS: Simpan object 'io' ke global variable Node.js
// agar bisa dipanggil secara instan dari file controller atau file connection.js manapun
global.io = io;

// Pasang Event Listener WebSocket untuk Dashboard Klien
io.on("connection", (socket) => {
  console.log(`🔌 Client Dashboard Terhubung ke WebSocket ID: ${socket.id}`);

  // Aplikasi Flutter harus menembak event ini agar masuk ke kamar datanya sendiri (Zonasi QR)
  socket.on("join-tenant-room", (tenantId) => {
    socket.join(tenantId);
    console.log(`🔒 Socket ${socket.id} aman bergabung ke Room Tenant: ${tenantId}`);
  });

  socket.on("disconnect", () => {
    console.log(`❌ Client WebSocket ID: ${socket.id} terputus.`);
  });
});

// Daftarkan endpoint API CRM (Mencakup Auth OTP Tanpa Sandi & Operasional Leads)
app.use("/api/crm", crmRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/lead", leadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/master", produckRoutes);
app.use("/api/users", salesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/tenant', tenantRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "Aktif",
    message: "Server SaaS WA CRM berjalan sukses.",
  });
});

// 🌟 JALANKAN SERVER: Menggunakan server.listen (Hanya 1 kali)
server.listen(PORT, async () => {
  console.log(`🚀 Server Express & WebSocket aktif melayani API di http://localhost:${PORT}`);
  
  // 1. Jalankan Master Bot (OTP & Notifikasi SaaS)
  await connectToWhatsApp("MASTER_SYSTEM");
  
  // 2. Pulihkan otomatis seluruh sesi WhatsApp Tenant aktif tanpa perlu buka web
  await restoreAllTenantSessions();
});




// app.get("/", (req, res) => {
//   res.json({
//     status: "Aktif",
//     message: "Server SaaS WA CRM berjalan sukses.",
//   });
// });

// connectToWhatsApp("MASTER_SYSTEM");

// // 🌟 JALANKAN SERVER: Menggunakan server.listen (Bukan app.listen lagi)
// server.listen(PORT, () => {
//   console.log(`🚀 Server Express & WebSocket aktif melayani API di http://localhost:${PORT}`);
// });

// // 🌟 JALANKAN SERVER: Menggunakan server.listen
// server.listen(PORT, async () => {
//   console.log(`🚀 Server Express & WebSocket aktif melayani API di http://localhost:${PORT}`);
  
//   // 1. Jalankan Master Bot (OTP & Notifikasi SaaS)
//   await connectToWhatsApp("MASTER_SYSTEM");
  
//   // 2. Pulihkan otomatis seluruh sesi WhatsApp Tenant aktif tanpa perlu buka web
//   await restoreAllTenantSessions();
// });
































































































// const express = require("express");
// const http = require("http"); // 🌟 TAMBAHAN: Untuk mendukung WebSocket
// const { Server } = require("socket.io"); // 🌟 TAMBAHAN: Import Socket.io
// require("dotenv").config();

// const { connectToWhatsApp } = require("./src/whatsapp/connection");
// const crmRoutes = require("./src/routes/crmRoutes"); // Impor rute CRM terpadu
// const botRoutes = require("./src/routes/botRoutes"); // 👈 Tambahkan ini
// const leadRoutes = require("./src/routes/leadRoutes");
// const authRoutes = require("./src/routes/authRoutes"); // 👈 Tambahkan
// const produckRoutes = require("./src/routes/produkRoutes"); // 👈 Tambahkan

// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(express.json());

// // Buat server HTTP menggunakan Express
// const server = http.createServer(app);

// // Inisialisasi Socket.io dengan konfigurasi CORS bebas untuk Flutter / Web Frontend
// const io = new Server(server, {
//   cors: {
//     origin: "*",
//     methods: ["GET", "POST"],
//   },
// });

// // 🌟 KUNCI EMAS: Simpan object 'io' ke global variable Node.js
// // agar bisa dipanggil secara instan dari file controller atau file connection.js manapun
// global.io = io;

// // Pasang Event Listener WebSocket untuk Dashboard Klien
// io.on("connection", (socket) => {
//   console.log(`🔌 Client Dashboard Terhubung ke WebSocket ID: ${socket.id}`);

//   // Aplikasi Flutter harus menembak event ini agar masuk ke kamar datanya sendiri (Zonasi QR)
//   socket.on("join-tenant-room", (tenantId) => {
//     socket.join(tenantId);
//     console.log(`🔒 Socket ${socket.id} aman bergabung ke Room Tenant: ${tenantId}`);
//   });

//   socket.on("disconnect", () => {
//     console.log(`❌ Client WebSocket ID: ${socket.id} terputus.`);
//   });
// });

// // Daftarkan endpoint API CRM (Mencakup Auth OTP Tanpa Sandi & Operasional Leads)
// // app.use("/api", crmRoutes);
// app.use("/api/crm", crmRoutes);
// app.use("/api/bot", botRoutes);
// app.use("/api/lead", leadRoutes);
// app.use("/api/auth", authRoutes);
// app.use("/api/master", produckRoutes);

// app.get("/", (req, res) => {
//   res.json({
//     status: "Aktif",
//     message: "Server SaaS WA CRM berjalan sukses.",
//   });
// });

// connectToWhatsApp("MASTER_SYSTEM");

// // 🌟 JALANKAN SERVER: Menggunakan server.listen (Bukan app.listen lagi)
// server.listen(PORT, () => {
//   console.log(`🚀 Server Express & WebSocket aktif melayani API di http://localhost:${PORT}`);
// });
