const WebSocketPort = 9000;
const WebSocket = require('ws');
const server = new WebSocket.Server({ port: WebSocketPort });

// [wsClient, ...]
const clients = new Set();

function direct(client, mode, data = undefined) {
  let msg = [mode];
  if (data) msg.push(data);
  client.send(JSON.stringify(msg));
}
function broadcast(mode, data) {
  for (let client of clients) {
    direct(client, mode, data);
  }
}
function getClientsNameList() {
  const list = [];
  clients.forEach((client)=>{
    list.push(client.who);
  })
  return list;
}

function onConnect(client) {
  console.log("Пользователь подключился");
  direct(client, "NOTIFY", "Добро пожаловать в чат!");

  client.on("message", function (message) {
    try {
      message = JSON.parse(message);
      switch (message[0]) {
        case "MSG":
          if (!clients.has(client)) return;
          if (!("who" in client)) return;
          if (message[1].msg === "") return;
          message[1].msg = message[1].msg.slice(0, 2000);
          broadcast("MSG", {who: client.who, msg: message[1].msg});
          break;
        case "NEWMEM":
          if (!message[1].who) return;
          let who = message[1].who.slice(0, 50);

          for (let cl of clients) {
            if (cl.who === who) {
              direct(client, "NEWMEM_CHANGE_NICK", "Имя занято");
              return;
            }
          }
          client.who = who;
          direct(client, "CLIENTS", getClientsNameList());
          clients.add(client);
          direct(client, "NEWMEM_OK");
          broadcast("NEWMEM", who);
          broadcast("COUNT", clients.size);
          break;
        default:
          direct(client, "ERROR", `Неизвестный тип сообщения: ${message[0]}`);
          console.error(`Неизвестный тип сообщения: ${message[0]}`);
      }
    }
    catch (error) {
      direct(client, "ERROR", `Ошибка: ${error}`);
      console.error("Ошибка: ", error);
    }
  });

  client.on("close", function () {
    let who = "Null";
    clients.forEach((cl) => {
      if (cl === client) {
        broadcast("DELMEM", cl.who);
        clients.delete(cl);
        who = cl.who;
        return;
      }
    });
    console.log(`Пользователь отключился: ${who}`);
    broadcast("COUNT", clients.size);
  });
}

server.on('connection', onConnect);
console.log(`Сервер запущен на порту: ${WebSocketPort}`);