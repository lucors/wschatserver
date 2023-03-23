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
          if (!clients.has(client)) return;
          if (!("who" in client)) return;
          if (message.data.msg === "") return;
          message.data.msg = message.data.msg.slice(0, 2000);
          broadcast("MSG", {who: client.who, msg: message.data.msg});
          break;
        case "NEWMEM":
          if (!message.data.who) return;
          let who = message.data.who.slice(0, 50);

          for (let cl of clients) {
            if (cl.who === who) {
              client.send(JSON.stringify({
                type: "NEWMEM_CHANGE_NICK",
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
          client.send(JSON.stringify({
            type: "NEWMEM_OK",
            data: getClientsNameList()
          }));
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