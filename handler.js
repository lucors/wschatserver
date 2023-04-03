const fs = require("fs");
const mysql = require('mysql2');
const config = require("./config.js");

// [wsClient, ...]
let db;
const clients = new Set();
let incomingHandlers = []; //[{mode: string, func: function()},...]
let flags = {
  debug: config.debug
}
let admins = {};
let rooms = [];
const historyPool = {
  prepare: function() {
    rooms.forEach((room, index) => {
      if (room.history) {
        historyPool[index] = {
          msg: [],
          blur: []
        };
      }
    });
    delete historyPool.prepare;
  }
}


//-----------------------------------------------------------------------------------
// EXPORTS
module.exports.prepare = function() {
  // admins = config.admins;
  // rooms = config.rooms;
  db = mysql.createConnection(config.db);
  db.query(
    "SELECT * FROM admins",
    function(err, results) {
      if (err) {
        console.error(err);
        return;
      }
      results.forEach((admin) => {
        admins[admin["name"]] = Number(admin["passhash"]);
      });
    }
  );
  db.query(
    "SELECT * FROM rooms",
    function(err, results) {
      if (err) {
        console.error(err);
        return;
      }
      results.forEach((room) => {
        rooms.push({
          title: room["title"],
          mems: new Set(),
          history: Boolean(room["history"]),
        })
      });
      historyPool.prepare();
      //Старт цикла среза истории
      historySlice(config.historySlice.count, config.historySlice.time);
    }
  );
  db.end();
}
module.exports.onConnect = function(client) {
  console.log("Пользователь подключился");
  // direct(client, "NOTIFY", "Выберите канал");
  client.on("message", (msg) => onMessage(client, msg));
  client.on("close", (msg) => onClose(client));
}



//-----------------------------------------------------------------------------------
// COMMON UTILS
function historySlice(maxlen, interval) {
  // if (!fs.existsSync("./history")) fs.mkdirSync("./history");
  setInterval(() => {
    for (const rid of Object.keys(historyPool)) {
      if (historyPool[rid].msg.length > maxlen){
        // const longhistory = JSON.stringify(historyPool[rid].slice(0, historyPool[rid].length-maxlen))+'\n';
        // fs.appendFile(`./history/${rid}.txt`, longhistory, function(error){
        //   if (error) console.error(`Ошибка записи истории. Комната ${rid}`);
        // });
        historyPool[rid].msg = historyPool[rid].msg.slice(historyPool[rid].msg.length-maxlen);
        console.log(`History pool (${rid}:msg) sliced`);
      }
      if (historyPool[rid].blur.length > maxlen){
        historyPool[rid].blur = historyPool[rid].blur.slice(historyPool[rid].blur.length-maxlen);
        console.log(`History pool (${rid}:blur) sliced`);
      }
    }
  }, interval);
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
function roomMemberByWho(rid, who) {
  if (!checkRid(rid)) return undefined;
  for (let member of rooms[rid].mems) {
    if (member.who === who) {
      return member;
    } 
  }
  return undefined;
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
    historyPool[rid].msg.push(data);
  }
  else if (mode === "MSG_BLUR" && rooms[rid].history) {
    historyPool[rid].blur.push(data);
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

// USERS UTILS
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
function clientByWho(who) {
  for (let client of clients) {
    if (client.who === who) {
      return client;
    } 
  }
  return undefined;
}

// ADMINS UTILS
function isAdmin(who) {
  return (who in admins);
}
function adminCheckPass(who, hashpass) {
  if (!isAdmin(who)) return false;
  return (admins[who] === hashpass);
}
function adminBroadcast(mode, data) {
  for (let client of clients) {
    if (isAdmin(client.who)){
      direct(client, mode, data);
    }
  }
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
  adminBroadcast("DEL_CLI", who);
  console.log(`Пользователь отключился: ${who}`);
  totalBroadcast("COUNT", clients.size);
}

function onMessage(client, raw){
  try {
      if (flags.debug) console.log(`Получено (${client.who}:${client.admin}): ` + raw);
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
    if (message[1] === "") return;

    message[1] = message[1].slice(0, 2000);
    roomBroadcast(client.rid, "MSG", [client.who, message[1]]);
  }
});

incomingHandlers.push({
  mode: "MSG_BLUR",
  func: function(client, message){
    if (!clients.has(client)) return;
    if (!("who" in client)) return;
    if (!("rid" in client)) return;
    if (message.length < 2) return;
    if (message[1] === "") return;

    message[1] = message[1].slice(0, 2000);
    roomBroadcast(client.rid, "MSG_BLUR", [client.who, message[1]]);
  }
});

incomingHandlers.push({
  mode: "MSG_DIRECT",
  func: function(client, message){
    if (!clients.has(client)) return;
    if (!("who" in client)) return;
    if (!("rid" in client)) return;
    if (message.length < 2) return;
    if (message[1].length < 2) return;
    if (!message[1][0] || !message[1][1]) return;

    if (message[1][0] === client.who) {
      direct(client, "ERROR", "Отправка самому себе недоступна");
      return;
    }
    const whom = roomMemberByWho(client.rid, message[1][0]);
    if (!whom) {
      direct(client, "ERROR", "Пользователь не найден");
      return;
    }
    message[1][1] = message[1][1].slice(0, 2000);
    direct(client, "MSG_DIRECT", [client.who, whom.who, message[1][1]]);
    direct(whom, "MSG_DIRECT", [client.who, whom.who, message[1][1]]);
  }
});

function authUser(client, who, admin = false) {
  client.admin = admin;
  client.who = who;
  client.rid = undefined;
  if (admin) {
    direct(client, "CLIENTS", totalClientsNames());
  }
  direct(client, "ROOMS", roomsData());
  clients.add(client);
  direct(client, "AUTH_OK", admin);
  adminBroadcast("NEW_CLI", who);
  totalBroadcast("COUNT", clients.size);
  enterRoom(client, 0);
  console.log(`${admin ? "Админ." : "Пользователь"} авторизован: ${who}`);
}
incomingHandlers.push({
  mode: "AUTH",
  func: function(client, message){
    if (message.length < 2) return;
    if (!message[1]) return;
    let who = message[1].slice(0, 50);
    for (let cl of clients) {
      if (cl.who === who) {
        direct(client, "AUTH_FAIL", "Имя занято");
        return;
      }
    }
    if (isAdmin(who)) {
      direct(client, "AUTH_PASS", "Требуется пароль");
      return;
    }
    authUser(client, who);
  }
});
incomingHandlers.push({
  mode: "AUTH_PASS",
  func: function(client, message){
    if (message.length < 2) return;
    if (!message[1]) return;
    if (message[1].length < 2) return;
    let who = message[1][0].slice(0, 50);
    let hashpass = message[1][1];
    for (let cl of clients) {
      if (cl.who === who) {
        direct(client, "AUTH_FAIL", "Имя занято");
        return;
      }
    }
    if (!adminCheckPass(who, hashpass)) {
      direct(client, "AUTH_FAIL", "Ошибка авторизации");
      return;
    }
    authUser(client, who, true);
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
  if (rid in historyPool){
    direct(client, "HISTORY", roomHistory(rid));
  }
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

//-----------------------------------------------------------------------------------
// ADMINS WSS HANDLERS
incomingHandlers.push({
  mode: "BROADCAST_R",
  func: function(client, message){
    if (!client.admin) return;
    if (message.length < 2) return;
    
    if (typeof message[1] === "string") {
      if (!message[1] || (client.rid === undefined)) return;
      roomBroadcast(client.rid, "NOTIFY", message[1]);
    }
    else {
      if (message[1].length < 2) return;
      if (!message[1][0] || !message[1][1]) return;
      roomBroadcast(message[1][0], "NOTIFY", message[1][1]);
    }
  }
});
incomingHandlers.push({
  mode: "BROADCAST",
  func: function(client, message){
    if (!client.admin) return;
    if (message.length < 2) return;
    if (!message[1]) return;
    
    totalBroadcast("NOTIFY", message[1]);
  }
});