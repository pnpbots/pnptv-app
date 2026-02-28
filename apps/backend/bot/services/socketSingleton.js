let _io = null;
module.exports = { set: (io) => { _io = io; }, get: () => _io };
