// [wsClient, ...]
const clients = new Set();
let incomingHandlers = []; //[{mode: string, func: function()},...]
let flags = {
  debug: false
}
const rooms = [
  {title: "General", mems: new Set(), history: true},
  {title: "Без истории", mems: new Set(), history: false},
]
const historyPool = {
  "0": []
}
//Срез 50 каждые полчаса 
historySlice(50, 1800*1000);


//-----------------------------------------------------------------------------------
// EXPORTS
module.exports.onConnect = function(client) {
  console.log("Пользователь подключился");
  direct(client, "NOTIFY", "Выберите канал");
  client.on("message", (msg) => onMessage(client, msg));
  client.on("close", (msg) => onClose(client));
}



//-----------------------------------------------------------------------------------
// COMMON UTILS
function historySlice(maxlen, interval) {
  setInterval(() => {
    for (const key of Object.keys(historyPool)) {
      if (historyPool[key].length >= maxlen){
        historyPool[key] = historyPool[key].slice(historyPool[key].length-maxlen);
        console.log(`History pool (${key}) sliced`);
      }
    }
  }, interval);
}
function direct(client, mode, data = undefined) {
  let msg = [mode];
  if (data !== undefined) msg.push(data);
  client.send(JSON.stringify(msg));
}
function totalBroadcast(mode, data) {
  for (let client of clients) {
    direct(client, mode, data);
  }
}
function totalClientsNames() {
  const list = [];
  clients.forEach((client)=>{
    list.push(client.who);
  })
  return list;
}

// ROOMS UTILS
function checkRid(rid) {
  if (rid === undefined) return false;
  if (rooms.length === 0) return false;
  if (rid >= rooms.length || rid < 0) return false;
  return true;
}
function roomMembersNames(rid) {
  if (!checkRid(rid)) return;
  const list = [];
  rooms[rid].mems.forEach((member)=>{
    list.push(member.who);
  })
  return list;
}
function roomsData() {
  const list = [];
  rooms.forEach((room, rid)=>{
    list.push({title: room.title, rid: rid});
  })
  return list;
}
function roomBroadcast(rid, mode, data) {
  if (!checkRid(rid)) return;
  if (mode === "MSG" && rooms[rid].history) {
    historyPool[rid].push(data);
  }
  for (let member of rooms[rid].mems) {
    direct(member, mode, data);
  }
}
function roomHistory(rid) {
  if (rid in historyPool){
    return historyPool[rid];
  }
  return [];
}



//-----------------------------------------------------------------------------------
// WSS HANDLERS
function onClose(client){
  let who = "Null";
  clients.forEach((cl) => {
    if (cl === client) {
      leaveRoom(cl);
      clients.delete(cl);
      who = cl.who;
      return;
    }
  });
  console.log(`Пользователь отключился: ${who}`);
  totalBroadcast("COUNT", clients.size);
}

function onMessage(client, raw){
  try {
      if (flags.debug) console.log(`Получено: ` + raw);
      const message = JSON.parse(raw);
      let _done = false;
      incomingHandlers.forEach(handler => {
          if (handler.mode == message[0]) {
              handler.func(client, message);
              _done = true;
              return;
          }
      });
      if (!_done) {
          direct(client, "ERROR", `Неизвестный тип сообщения: ${message[0]}`);
          console.error(`Ошибка обработки сообщения. mode: ${message[0]}`);
      }
  }
  catch (error) {
      direct(client, "ERROR", `Ошибка: ${error}`);
      console.error("Ошибка: ", error);
  }
}

incomingHandlers.push({
  mode: "PING",
  func: function(client, message){
    direct(client, "PING", Date.now());
  }
});

incomingHandlers.push({
  mode: "MSG",
  func: function(client, message){
    if (!clients.has(client)) return;
    if (!("who" in client)) return;
    if (!("rid" in client)) return;
    if (message.length < 2) return;
    if (message[1].msg === "") return;

    message[1].msg = message[1].msg.slice(0, 2000);
    roomBroadcast(client.rid, "MSG", [client.who, message[1].msg]);
  }
});

incomingHandlers.push({
  mode: "AUTH",
  func: function(client, message){
    if (message.length < 2) return;
    if (!message[1].who) return;

    let who = message[1].who.slice(0, 50);
    for (let cl of clients) {
      if (cl.who === who) {
        direct(client, "AUTH_FAIL", "Имя занято");
        return;
      }
    }
    client.who = who;
    client.rid = undefined;
    direct(client, "ROOMS", roomsData());
    clients.add(client);
    direct(client, "AUTH_OK");
    totalBroadcast("COUNT", clients.size);
    enterRoom(client, 0);
  }
});

function forceLeaveRoom(client, rid){
  client.rid = undefined;
  if (!checkRid(rid)) return;
  if (rooms[rid].mems.delete(client)) {
    roomBroadcast(rid, "DEL_MEM", client.who);
    roomBroadcast(rid, "ROOM_COUNT", rooms[rid].mems.size);
  }
}
function leaveRoom(client){
  forceLeaveRoom(client, client.rid);
}
function enterRoom(client, rid){
  direct(client, "ROOM_CHANGE_OK", rid);
  // direct(client, "NOTIFY", "Добро пожаловать в чат!");
  direct(client, "MEMBERS", roomMembersNames(rid));
  client.rid = rid;
  rooms[rid].mems.add(client);
  direct(client, "HISTORY", roomHistory(rid));
  roomBroadcast(rid, "NEW_MEM", client.who);
  roomBroadcast(rid, "ROOM_COUNT", rooms[rid].mems.size);
}
incomingHandlers.push({
  mode: "ROOM_CHANGE",
  func: function(client, message){
    if (!client.who) return;
    if (message.length < 2) return;

    const rid = message[1];
    if (!checkRid(rid)) {
      direct(client, "ROOM_CHANGE_FAIL", "Комната не найдена");
      return;
    }
    if (rooms[rid].mems.has(client)) {
      direct(client, "ROOM_CHANGE_FAIL", "Вы уже в этой комнате");
      return;
    }
    leaveRoom(client);
    enterRoom(client, rid);
  }
});