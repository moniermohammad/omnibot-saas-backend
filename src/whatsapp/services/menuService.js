/**
 * Menyusun format tampilan teks menu chatbot WhatsApp secara otomatis
 * @param {Object} node - Objek data BotNode lengkap beserta array options-nya dari database
 * @returns {String} - Teks pesan rapi yang siap dikirimkan ke WhatsApp Customer
 */
function formatMenuText(node) {
    let text = node.messageText;

    // Jika data node memiliki opsi pilihan menu, susun daftar angkanya
    if (node.options && node.options.length > 0) {
        
        // FILTER: Hanya ambil opsi yang berupa angka (1, 2, 3, dst)
        // Ini bertujuan agar kata kunci sapaan (seperti 'halo', 'hai', 'p') tidak ikut terpajang di teks menu
        const numericOptions = node.options.filter(opt => !isNaN(opt.triggerKey));
        
        // KUNCI AMAN UUID: Urutkan daftar pilihan menu berdasarkan nilai string angka 'triggerKey'
        // Menggunakan localeCompare menjamin pengurutan teks angka (1, 2, 3) tetap presisi dan hemat RAM laptop i3 Anda
        const sortedOptions = numericOptions.sort((a, b) => 
            a.triggerKey.localeCompare(b.triggerKey, undefined, { numeric: true, sensitivity: 'base' })
        );
        
        // Satukan array menjadi baris teks berurutan menggunakan tanda baris baru (\n)
        const menuList = sortedOptions.map(opt => `*${opt.triggerKey}.* ${opt.label}`).join('\n');
        
        // Gabungkan teks pertanyaan utama dengan daftar menu pilihan
        text = `${node.messageText}\n\n${menuList}`;
    }
    
    return text;
}

module.exports = { 
    formatMenuText 
};
