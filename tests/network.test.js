import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
const port = 3187,
  url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
async function ready() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(url + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(logs);
}
const ack = (s, event, data = {}) =>
  new Promise((resolve, reject) =>
    s.timeout(3000).emit(event, data, (e, r) => (e ? reject(e) : resolve(r))),
  );
const until = (s, event, predicate = () => true, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off(event, on);
      reject(Error(`Timed out: ${event}`));
    }, timeout);
    function on(data) {
      if (predicate(data)) {
        clearTimeout(timer);
        s.off(event, on);
        resolve(data);
      }
    }
    s.on(event, on);
  });
async function connect() {
  const s = io(url, { forceNew: true, reconnection: false });
  await until(s, "connect");
  return s;
}
await ready();
test(
  "four-player room lifecycle, permissions, input validation, and seat recovery",
  { timeout: 20000 },
  async () => {
    const clients = [];
    try {
      for (let i = 0; i < 5; i++) clients.push(await connect());
      const host = await ack(clients[0], "enter", {
        mode: "create",
        name: "<Host>",
      });
      assert.equal(host.slot, 0);
      assert.equal(host.lobby.members[0].name, "Host");
      for (let i = 1; i < 4; i++) {
        const r = await ack(clients[i], "enter", {
          mode: "join",
          code: host.lobby.code,
          name: `Player ${i}`,
        });
        assert.equal(r.slot, i);
      }
      const full = await ack(clients[4], "enter", {
        mode: "join",
        code: host.lobby.code,
      });
      assert.match(full.error, /four players/);
      assert.match((await ack(clients[1], "start")).error, /host/);
      const live = until(clients[0], "state", (s) => s.phase === "playing");
      assert.ok((await ack(clients[0], "start")).ok);
      const state = await live;
      assert.equal(state.players.length, 4);
      assert.match(
        (await ack(clients[0], "action", "g0")).error,
        /controllers/,
      );
      assert.ok((await ack(clients[1], "action", "g0")).ok);
      const initial = state.players[0];
      clients[0].emit("input", { x: 10000, z: 0 });
      await new Promise((r) => setTimeout(r, 160));
      clients[0].emit("input", { x: 0, z: 0 });
      const after = await until(clients[0], "state");
      assert.ok(Math.abs(after.players[0].x - initial.x) < 2);
      clients[0].emit("input", { x: "malicious", z: Infinity });
      const sane = await until(clients[0], "state");
      assert.ok(Number.isFinite(sane.players[0].x));
      const paused = until(clients[1], "state", (s) => s.phase === "paused");
      clients[0].disconnect();
      await paused;
      const replacement = await connect();
      clients.push(replacement);
      const resumed = until(clients[1], "state", (s) => s.phase === "playing");
      const resume = await ack(replacement, "enter", {
        mode: "resume",
        code: host.lobby.code,
        token: host.token,
      });
      assert.equal(resume.slot, 0);
      await resumed;
      assert.match(
        (
          await ack(clients[4], "enter", {
            mode: "join",
            code: host.lobby.code,
          })
        ).error,
        /already started/,
      );
      const invalid = await ack(clients[4], "enter", {
        mode: "resume",
        code: host.lobby.code,
        token: "wrong",
      });
      assert.match(invalid.error, /expired/);
    } finally {
      clients.forEach((s) => s.disconnect());
    }
  },
);
test(
  "practice, seat selection, host migration and fill-bots work",
  { timeout: 10000 },
  async () => {
    const a = await connect(),
      b = await connect();
    try {
      const invalidResume = await ack(a, "enter", {
        mode: "resume",
        code: "ABCDEF",
      });
      assert.match(invalidResume.error, /expired/);
      a.emit("seat", null, {});
      a.emit("fill", null, {});
      a.emit("action", null, {});
      const practice = await ack(a, "enter", {
        mode: "practice",
        name: "Solo",
        role: "controller",
      });
      assert.equal(practice.slot, 1);
      assert.equal(practice.lobby.members.filter((m) => m.bot).length, 3);
      a.emit("leave");
      const host = await ack(a, "enter", { mode: "create" });
      const joined = await ack(b, "enter", {
        mode: "join",
        code: host.lobby.code,
      });
      assert.equal(joined.slot, 1);
      const seat = await ack(b, "seat", 3);
      assert.equal(seat.slot, 3);
      assert.match((await ack(b, "seat", 0)).error, /unavailable/);
      const migrate = until(b, "lobby", (r) => r.host === 3);
      a.emit("leave");
      await migrate;
      assert.ok((await ack(b, "fill")).ok);
      assert.ok((await ack(b, "start")).ok);
    } finally {
      a.disconnect();
      b.disconnect();
    }
  },
);
test(
  "a solo practice seat survives a reload with no other humans online",
  { timeout: 10000 },
  async () => {
    const first = await connect();
    let second;
    try {
      const room = await ack(first, "enter", {
        mode: "practice",
        name: "Solo",
        role: "runner",
      });
      await ack(first, "start");
      await until(first, "state");
      first.disconnect();
      await new Promise((r) => setTimeout(r, 100));
      second = await connect();
      const resumed = await ack(second, "enter", {
        mode: "resume",
        code: room.lobby.code,
        token: room.token,
      });
      assert.ok(resumed.ok);
      assert.equal(resumed.slot, 0);
      assert.notEqual((await until(second, "state")).phase, "paused");
    } finally {
      first.disconnect();
      second?.disconnect();
    }
  },
);
test.after(() => server.kill());
