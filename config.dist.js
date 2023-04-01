const config = {};

config.debug = false;
config.db = {
    host: "localhost",
    user: "root",
    database: "wsc",
    password: "root"
};
config.historySlice = {
    count: 50,
    time: 1800*1000,
};

module.exports = config;