import { onConnect } from './handler.js';
import { WebSocketServer } from 'ws';

const WebSocketPort = 9000;
const server = new WebSocketServer({ port: WebSocketPort });

server.on('connection', onConnect);
console.log(`Сервер запущен на порту: ${WebSocketPort}`);