const WebSocketPort = 9000;
const WebSocket = require('ws');
const server = new WebSocket.Server({ port: WebSocketPort });

// [wsClient, ...]
const clients = new Set();

function broadcast(type, data) {
  for (let client of clients) {
    client.send(JSON.stringify({
      type: type,
      data: data
    }));
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
  client.send(JSON.stringify({
    type: "NOTIFY",
    data: "Добро пожаловать в чат!"
  }));

  client.on("message", function (message) {
    try {
      message = JSON.parse(message);
      switch (message.type) {
        case "MSG":
          if (!message.data.who) return;
          for (let cl of clients) {
            if (cl.who === message.data.who && cl.ws !== client) {
              return;
            }
          }
          message.data.msg = message.data.msg.slice(0, 2000);
          if (message.data.msg === "") return;
          broadcast("MSG", message.data);
          break;
        case "NEWMEM":
          if (!message.data.who) return;
          let who = message.data.who.slice(0, 50);

          for (let client of clients) {
            if (client.who === who) {
              client.send(JSON.stringify({
                type: "CHANGE_NICK",
                data: "Имя занято"
              }));
              return;
            }
          }
          client.who = who;
          client.send(JSON.stringify({
            type: "CLIENTS",
            data: getClientsNameList()
          }));
          clients.add(client);
          broadcast("NEWMEM", who);
          broadcast("COUNT", clients.size);
          break;
        default:
          client.send(JSON.stringify({
            type: "ERROR",
            data: `Неизвестный тип сообщения: ${message.type}`
          }));
          console.error(`Неизвестный тип сообщения: ${message.type}`);
      }
    }
    catch (error) {
      client.send(JSON.stringify({
        type: "ERROR",
        data: "Ошибка: " + error
      }));
      console.error("Ошибка: ", error);
    }
  });

  client.on("close", function () {
    clients.forEach((cl) => {
      if (cl === client) {
        broadcast("DELMEM", cl.who);
        clients.delete(cl);
        return;
      }
    });
    console.log("Пользователь отключился");
    broadcast("COUNT", clients.size);
  });
}

server.on('connection', onConnect);
console.log(`Сервер запущен на порту: ${WebSocketPort}`);