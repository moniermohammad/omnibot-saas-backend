// File terisolasi khusus menampung instance nomor yang sedang aktif di RAM
// const activeSockets = {};
// module.exports = { activeSockets };

if (!global.activeSockets) {
  global.activeSockets = {};
}

module.exports = {
  activeSockets: global.activeSockets,
};
