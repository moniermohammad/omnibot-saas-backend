const prisma = require('../../../config/prisma');

/**
 * Menyimpan input jawaban formulir kuesioner dinamis dari pembeli
 * @param {String} phoneNumber - Nomor WhatsApp Customer/Pembeli
 * @param {String} field - Nama kolom database tujuan (contoh: customerName, address, specification, dll)
 * @param {String} value - Teks jawaban dari pembeli
 * @param {String} tenantId - UUID Pengikat Bisnis Klien
 */
async function saveFormInput(phoneNumber, field, value, tenantId) {
    return await prisma.lead.upsert({
        where: {
            tenantId_phoneNumber: {
                tenantId: tenantId,
                phoneNumber: phoneNumber
            }
        },
        update: { 
            [field]: value 
        },
        create: { 
            tenantId: tenantId,
            phoneNumber: phoneNumber, 
            [field]: value, 
            status: "BOT_PROCESS" 
        }
    });
}

/**
 * Menyimpan label kategori pilihan menu utama pembeli secara otomatis
 * @param {String} phoneNumber - Nomor WhatsApp Customer/Pembeli
 * @param {String} optionLabel - Label teks dari menu opsi yang dipilih (contoh: 'Layanan Jasa Kebersihan')
 * @param {String} tenantId - UUID Pengikat Bisnis Klien
 */
async function saveLeadCategory(phoneNumber, optionLabel, tenantId) {
    // Menyimpan label teks opsi murni dari database seed secara fleksibel untuk semua lini bisnis
    await prisma.lead.upsert({
        where: {
            tenantId_phoneNumber: {
                tenantId: tenantId,
                phoneNumber: phoneNumber
            }
        },
        update: { 
            category: optionLabel 
        },
        create: { 
            tenantId: tenantId,
            phoneNumber: phoneNumber, 
            category: optionLabel, 
            status: "BOT_PROCESS" 
        }
    });
}

module.exports = { 
    saveFormInput, 
    saveLeadCategory 
};
