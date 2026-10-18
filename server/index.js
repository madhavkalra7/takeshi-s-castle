import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Server } from "socket.io";
import {
  createGame,
  tick,
  action,
  publicGame,
  roleFor,
  teamFor,
} from "../shared/game.js";
import { fileURLToPath } from "node:url";
const app = express(),
  http = createServer(app),
  io = new Server(http, { maxHttpBufferSize: 4096 });
const rooms = new Map(),
  now = () => performance.now() / 1000;
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
if (
  process.env.NODE_ENV === "production" ||
  process.argv.includes("--production")
)
  app.use(express.static(fileURLToPath(new URL("../dist", import.meta.url))));
else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const code = () => randomBytes(3).toString("hex").toUpperCase();
const cleanName = (n) =>
  typeof n === "string"
    ? n
        .trim()
        .replace(/[\x00-\x1f<>]/g, "")
        .slice(0, 18) || "Player"
    : "Player";
function reply(ack, data) {
  if (typeof ack === "function") ack(data);
}
function lobby(room) {
  return {
    code: room.code,
    host: room.host,
    practice: room.practice,
    started: !!room.game,
    members: room.members.map((p, slot) =>
      p
        ? {
            slot,
            name: p.name,
            bot: p.bot,
            connected: !!p.socket,
            team: teamFor(slot),
            role: roleFor(slot, room.game?.round || 1),
          }
        : null,
    ),
  };
}
function update(room) {
  io.to(room.code).emit("lobby", lobby(room));
}
function leave(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return;
  const slot = socket.data.slot,
    m = room.members[slot];
  if (m?.socket !== socket.id) return;
  socket.leave(room.code);
  delete socket.data.room;
  delete socket.data.slot;
  if (room.game && room.game.phase !== "finished") {
    m.socket = null;
    m.disconnectedAt = now();
    if (room.game.phase !== "paused") {
      room.resumePhase = room.game.phase;
      room.pauseAt = now();
      room.game.phase = "paused";
    }
  } else {
    room.members[slot] = null;
  }
  if (room.host === slot) {
    const next = room.members.findIndex((p) => p?.socket);
    if (next >= 0) room.host = next;
  }
  if (!room.members.some((p) => p?.socket)) {
    if (!room.game || room.game.phase === "finished") {
      rooms.delete(room.code);
      return;
    }
    room.emptySince = now();
  }
  update(room);
}
io.on("connection", (socket) => {
  let actions = [],
    packetCount = 0,
    packetWindow = now();
  socket.use((_packet, next) => {
    const t = now();
    if (t - packetWindow >= 1) {
      packetWindow = t;
      packetCount = 0;
    }
    if (++packetCount > 100) return;
    next();
  });
  socket.on("enter", (data, ack) => {
    if (typeof ack !== "function") return;
    if (!data || typeof data !== "object")
      return ack({ error: "Invalid room request." });
    const t = now();
    actions = actions.filter((a) => t - a < 10);
    if (actions.length >= 12)
      return ack({ error: "Too many requests. Please wait a moment." });
    actions.push(t);
    const requested =
      typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
    if (data.mode === "resume") {
      if (typeof data.token !== "string" || data.token.length !== 48)
        return ack({ error: "Your seat has expired. Join a new room." });
      const room = rooms.get(requested),
        slot = room?.members.findIndex(
          (m) => m && !m.bot && m.token === data.token,
        );
      if (!room || slot < 0 || room.members[slot].bot)
        return ack({ error: "Your seat has expired. Join a new room." });
      leave(socket);
      const member = room.members[slot];
      if (member.socket && member.socket !== socket.id) {
        const old = io.sockets.sockets.get(member.socket);
        if (old) {
          old.emit("replaced");
          old.leave(room.code);
          old.data = {};
        }
      }
      member.socket = socket.id;
      member.disconnectedAt = null;
      room.emptySince = null;
      socket.data = { room: room.code, slot };
      socket.join(room.code);
      resume(room);
      update(room);
      return ack({ ok: true, slot, token: member.token, lobby: lobby(room) });
    }
    let room;
    if (data.mode === "join") {
      room = rooms.get(requested);
      if (!room)
        return ack({ error: "Room not found. Check the six-character code." });
      if (room.game) return ack({ error: "This match has already started." });
      if (!room.members.includes(null))
        return ack({ error: "This room already has four players." });
    } else if (data.mode === "create" || data.mode === "practice") {
      if (rooms.size >= 150)
        return ack({ error: "Server is full. Please try again later." });
      let c;
      do {
        c = code();
      } while (rooms.has(c));
      room = {
        code: c,
        members: [null, null, null, null],
        host: 0,
        practice: data.mode === "practice",
        createdAt: now(),
      };
      rooms.set(c, room);
    } else return ack({ error: "Unknown room mode." });
    if (socket.data.room === room.code)
      return ack({ error: "You are already in this room." });
    leave(socket);
    const slot =
      room.practice && data.role === "controller"
        ? 1
        : room.members.indexOf(null);
    room.host = room.practice ? slot : room.host;
    const member = {
      name: cleanName(data.name),
      socket: socket.id,
      token: randomBytes(24).toString("hex"),
      bot: false,
    };
    room.members[slot] = member;
    socket.data = { room: room.code, slot };
    socket.join(room.code);
    if (room.practice) {
      ["Jet", "Nova", "Dash", "Echo"].forEach((n, i) => {
        if (!room.members[i])
          room.members[i] = { name: n + " [BOT]", bot: true };
      });
    }
    update(room);
    ack({ ok: true, slot, token: member.token, lobby: lobby(room) });
  });
  socket.on("seat", (slot, ack) => {
    const room = rooms.get(socket.data.room),
      old = socket.data.slot;
    if (
      !room ||
      room.game ||
      room.practice ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 3 ||
      room.members[slot]
    )
      return reply(ack, { error: "That seat is unavailable." });
    room.members[slot] = room.members[old];
    room.members[old] = null;
    socket.data.slot = slot;
    if (room.host === old) room.host = slot;
    update(room);
    reply(ack, { ok: true, slot });
  });
  socket.on("fill", (_, ack) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.game || room.host !== socket.data.slot)
      return reply(ack, { error: "Only the host can add practice bots." });
    ["Jet", "Nova", "Dash", "Echo"].forEach((n, i) => {
      if (!room.members[i]) room.members[i] = { name: n + " [BOT]", bot: true };
    });
    update(room);
    reply(ack, { ok: true });
  });
  socket.on("start", (_, ack) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.game || room.host !== socket.data.slot)
      return reply(ack, { error: "Only the host can start." });
    if (room.members.some((m) => !m))
      return reply(ack, { error: "Fill all four seats to start." });
    room.game = createGame(room.members, now());
    update(room);
    reply(ack, { ok: true });
  });
  socket.on("input", (input) => {
    const room = rooms.get(socket.data.room),
      p = room?.game?.players[socket.data.slot];
    if (!p || p.role !== "runner" || !input || typeof input !== "object")
      return;
    if (!Number.isFinite(input.x) || !Number.isFinite(input.z)) return;
    p.input = {
      x: Math.max(-1, Math.min(1, input.x)),
      z: Math.max(-1, Math.min(1, input.z)),
      jump: p.input.jump || input.jump === true,
      shove: p.input.shove || input.shove === true,
    };
    p.lastInput = now();
  });
  socket.on("action", (id, ack) => {
    const room = rooms.get(socket.data.room);
    if (!room?.game) return reply(ack, { error: "No active match." });
    const error = action(room.game, socket.data.slot, id, now());
    reply(ack, error ? { error } : { ok: true });
  });
  socket.on("rematch", (_, ack) => {
    const room = rooms.get(socket.data.room);
    if (
      !room ||
      room.game?.phase !== "finished" ||
      room.host !== socket.data.slot
    )
      return reply(ack, {
        error: "The host can request a rematch after the match.",
      });
    room.game = null;
    room.members = room.members.map((m) => (m?.socket || m?.bot ? m : null));
    update(room);
    reply(ack, { ok: true });
  });
  socket.on("leave", () => leave(socket));
  socket.on("disconnect", () => leave(socket));
});
function resume(room) {
  if (
    room.game?.phase === "paused" &&
    room.members.every((m) => m?.bot || m?.socket)
  ) {
    const delay = now() - room.pauseAt;
    room.game.phase = room.resumePhase;
    room.game.phaseUntil += delay;
    if (room.game.deadline) room.game.deadline += delay;
    for (const s of Object.values(room.game.devices)) {
      if (s.cooldown) s.cooldown += delay;
      if (s.until) s.until += delay;
      if (s.warning) s.warning += delay;
    }
    for (const p of room.game.pending) p.at += delay;
    for (const p of room.game.players) {
      p.stun += delay;
      p.shoveAt += delay;
      p.input = { x: 0, z: 0 };
    }
    update(room);
  }
}
let last = now(),
  acc = 0;
setInterval(() => {
  const t = now(),
    elapsed = Math.min(0.2, t - last);
  last = t;
  acc += elapsed;
  while (acc >= 1 / 30) {
    for (const room of rooms.values())
      if (room.game) {
        for (const p of room.game.players)
          if (!p.bot && t - (p.lastInput || 0) > 0.3) p.input = { x: 0, z: 0 };
        tick(room.game, 1 / 30, t, room.members);
      }
    acc -= 1 / 30;
  }
  for (const room of rooms.values()) {
    if (room.emptySince && t - room.emptySince > 20) {
      rooms.delete(room.code);
      continue;
    }
    if (room.game?.phase === "paused") {
      room.members.forEach((m, i) => {
        if (m && !m.bot && !m.socket && t - m.disconnectedAt > 20) {
          room.members[i] = { name: m.name + " [BOT]", bot: true };
          room.game.players[i].bot = true;
          room.game.players[i].name = room.members[i].name;
        }
      });
      resume(room);
    }
    if (room.game)
      for (let slot = 0; slot < 4; slot++) {
        const id = room.members[slot]?.socket;
        if (id) io.to(id).emit("state", publicGame(room.game, slot, t));
      }
  }
}, 1000 / 20);
const port = Number(process.env.PORT) || 3000;
http.listen(port, "0.0.0.0", () =>
  console.log(`MAZE RIOT ready · http://localhost:${port}`),
);
