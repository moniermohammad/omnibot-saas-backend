// const chatbotService = require("../services/chatbotService");
const chatbotService = require("../services/chatbotService");


const chatbotController = {

  // 1. AMBIL DATA CONFIG (GET) - Otomatis dipanggil saat halaman chatbot dibuka
  getEditorNodes: async (req, res) => {
    try {
      const tenantId = req.user?.tenantId; 
      if (!tenantId) {
        return res.status(400).json({ success: false, message: "Tenant ID tidak ditemukan dalam sesi." });
      }

      // Memanggil fungsi query database asli dari folder service
      const nodesData = await chatbotService.getConfig(tenantId);

      // Sesuai dengan format yang Anda minta: success, message, data
      return res.status(200).json({ 
        success: true, 
        message: "Endpoint getEditorNodes aktif.", 
        data: nodesData,
      });
    } catch (error) {
      console.error('Error Get Editor Nodes Controller:', error);
      return res.status(500).json({ success: false, error: "Gagal memuat data diagram dari database." });
    }
  },

  // 💾 2. POST: Simpan/Update Data Konfigurasi AI Global (Skema Overwrite Subjek Otomatis)
   saveConfig: async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant ID tidak sah dalam sesi.' });
      }

      if (!req.body.openingMessage || !req.body.openingMessage.trim()) {
        return res.status(400).json({ success: false, message: 'Data pesan pembuka wajib diisi.' });
      }

      const subjects = req.body.subjects;
      if (!Array.isArray(subjects) || subjects.length === 0) {
        return res.status(400).json({ success: false, message: 'Minimal harus ada 1 subjek layanan.' });
      }

      const hasEmptyClosing = subjects.some((sub) => !sub.closingMessage || !sub.closingMessage.trim());
      if (hasEmptyClosing) {
        return res.status(400).json({ success: false, message: 'Pesan penutup pada setiap subjek wajib diisi.' });
      }

      // 🌟 KUNCI UTAMA: Memanggil fungsi service murni database tanpa memikirkan req / res
      const result = await chatbotService.saveChatbotConfig(tenantId, req.body);

      return res.status(200).json({
        success: true,
        message: "🎉 Perubahan konfigurasi chatbot berhasil disimpan ke database!",
        data: result
      });
    } catch (error) {
      console.error('🚨 Error Save Config Controller:', error);
      return res.status(500).json({ success: false, message: 'Gagal menyimpan konfigurasi chatbot ke database.' });
    }
  },

};

module.exports = { chatbotController };
