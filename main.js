const handler = require('./handler.js');
const WebSocket = require('ws');
const WebSocketPort = 9000;
const server = new WebSocket.Server({ port: WebSocketPort });

handler.prepare();
server.on('connection', handler.onConnect);
console.log(`Сервер запущен на порту: ${WebSocketPort}`);