import test from "node:test";
import assert from "node:assert/strict";
import {
  ARENA,
  HALF,
  COST,
  createGame,
  tick,
  action,
  obstacles,
  isFree,
  move,
  findPath,
  roleFor,
  publicGame,
} from "../shared/game.js";
const members = () =>
  [0, 1, 2, 3].map((i) => ({ name: `Player ${i}`, bot: false }));
function playing() {
  const game = createGame(members(), 0);
  tick(game, 1 / 30, 3.01, members());
  return game;
}

test("every spawn, key, and exit is connected for all 16 rotating-wall configurations", () => {
  for (let mask = 0; mask < 16; mask++) {
    const g = playing();
    ARENA.rotators.forEach(
      (r, i) => (g.devices[r.id] = { orientation: (mask >> i) & 1 }),
    );
    const walls = obstacles(g, 4);
    for (let team = 0; team < 2; team++) {
      assert.ok(
        findPath(ARENA.spawns[team], ARENA.keys[team], walls).length,
        `spawn route missing for team ${team}, config ${mask}`,
      );
      assert.ok(
        findPath(ARENA.keys[team], ARENA.exit, walls).length,
        `exit route missing for team ${team}, config ${mask}`,
      );
    }
  }
});
test("movement cannot tunnel through walls or leave the arena", () => {
  const g = playing(),
    walls = obstacles(g, 4),
    wall = ARENA.walls.find((w) => w.w < 1),
    p = { x: wall.x - 1, z: wall.z };
  move(p, 15, 0, [wall]);
  assert.ok(p.x < wall.x);
  assert.ok(isFree(p.x, p.z, [wall]));
  const edge = { x: 0, z: 0 };
  move(edge, 10000, 10000, []);
  assert.ok(Math.abs(edge.x) < HALF);
  assert.ok(Math.abs(edge.z) < HALF);
});
test("diagonal inputs have the same speed as axial movement", () => {
  const a = playing(),
    b = playing();
  a.players[0].input = { x: 1, z: 0 };
  b.players[0].input = { x: 1, z: 1 };
  const x = a.players[0].x,
    z = a.players[0].z;
  tick(a, 1 / 30, 4, members());
  tick(b, 1 / 30, 4, members());
  assert.ok(
    Math.abs(
      Math.hypot(a.players[0].x - x, a.players[0].z - z) -
        Math.hypot(b.players[0].x - x, b.players[0].z - z),
    ) < 0.001,
  );
});
test("controllers are role-authorized, energy limited and share device cooldowns", () => {
  const g = playing(),
    id = ARENA.gates[0].id;
  assert.match(action(g, 0, id, 4), /controllers/);
  assert.match(action(g, 1, "nonexistent", 4), /Unknown/);
  assert.equal(action(g, 1, id, 4), null);
  assert.equal(g.energy[0], 100 - COST.gate);
  assert.match(action(g, 3, id, 4.1), /recharging/);
  g.energy[1] = 0;
  assert.match(action(g, 3, ARENA.rotators[0].id, 4), /energy/);
});
test("gates warn, close temporarily, and reopen", () => {
  const g = playing(),
    id = ARENA.gates[0].id;
  action(g, 1, id, 4);
  assert.equal(obstacles(g, 4.5).length, ARENA.walls.length + 4);
  tick(g, 0.03, 4.8, members());
  assert.ok(g.devices[id].until > 7);
  assert.equal(obstacles(g, 5).length, ARENA.walls.length + 5);
  assert.equal(obstacles(g, 8).length, ARENA.walls.length + 4);
});
test("occupied gates and rotating walls refund energy rather than clipping players", () => {
  for (const device of [ARENA.gates[0], ARENA.rotators[0]]) {
    const g = playing();
    Object.assign(g.players[0], { x: device.x, z: device.z });
    action(g, 1, device.id, 4);
    tick(g, 0.03, 4.8, members());
    assert.equal(g.energy[0], 100);
    assert.ok(!g.devices[device.id].until);
    assert.ok(!g.devices[device.id].orientation);
  }
});
test("jump returns to ground and cannot bypass wall collisions", () => {
  const g = playing();
  g.players[0].input.jump = true;
  let high = 0;
  for (let i = 0; i < 90; i++) {
    tick(g, 1 / 30, 4 + i / 30, members());
    high = Math.max(high, g.players[0].y);
  }
  assert.ok(high > 1);
  assert.equal(g.players[0].y, 0);
  assert.equal(g.players[0].vy, 0);
});
test("a runner must collect their own key before exiting", () => {
  const g = playing();
  Object.assign(g.players[0], ARENA.exit);
  tick(g, 0.03, 4, members());
  assert.equal(g.phase, "playing");
  Object.assign(g.players[0], ARENA.keys[1]);
  tick(g, 0.03, 4.1, members());
  assert.equal(g.players[0].key, false);
  Object.assign(g.players[0], ARENA.keys[0]);
  tick(g, 0.03, 4.2, members());
  assert.equal(g.players[0].key, true);
  Object.assign(g.players[0], ARENA.exit);
  tick(g, 0.03, 4.3, members());
  assert.equal(g.phase, "roundOver");
  assert.deepEqual(g.scores, [1, 0]);
});
test("simultaneous finishes and timeouts are draws", () => {
  const g = playing();
  for (const i of [0, 2])
    Object.assign(g.players[i], ARENA.exit, { key: true });
  tick(g, 0.03, 4, members());
  assert.equal(g.roundWinner, null);
  assert.deepEqual(g.scores, [0, 0]);
  const timeout = playing();
  tick(timeout, 0.03, 95, members());
  assert.equal(timeout.phase, "roundOver");
  assert.equal(timeout.roundWinner, null);
});
test("roles swap, rounds reset, and first to three ends the match", () => {
  const g = playing();
  let t = 4;
  for (let round = 1; round <= 3; round++) {
    assert.equal(g.players[0].role, roleFor(0, round));
    const p = g.players.find((p) => p.team === 0 && p.role === "runner");
    Object.assign(p, ARENA.exit, { key: true });
    tick(g, 0.03, t, members());
    tick(g, 0.03, t + 5.1, members());
    if (round < 3) {
      assert.equal(g.phase, "countdown");
      assert.ok(g.players.every((p) => !p.key));
      tick(g, 0.03, t + 8.2, members());
      t += 9;
    }
  }
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
  assert.deepEqual(g.scores, [3, 0]);
});
test("controller snapshots conceal distant opponent locations", () => {
  const g = playing(),
    view = publicGame(g, 1, 4);
  assert.equal(view.players[2].hidden, true);
  assert.equal(view.players[2].x, null);
  Object.assign(g.players[2], { x: g.players[0].x + 2, z: g.players[0].z });
  assert.equal(publicGame(g, 1, 4).players[2].hidden, false);
});
test("practice bots complete a full match without getting stuck", () => {
  const m = members().map((p) => ({ ...p, bot: true })),
    g = createGame(m, 0);
  for (let i = 0; i < 18000 && g.phase !== "finished"; i++)
    tick(g, 1 / 30, i / 30, m);
  assert.equal(g.phase, "finished");
  assert.ok(g.scores.includes(3));
});
test("paused matches do not advance simulation", () => {
  const g = playing();
  g.phase = "paused";
  const before = JSON.stringify(g);
  tick(g, 1, 100, members());
  assert.equal(JSON.stringify(g), before);
});

test("symmetric layout gives both teams identical baseline key and exit routes", () => {
  const g = playing(),
    walls = obstacles(g, 4);
  assert.equal(
    findPath(ARENA.spawns[0], ARENA.keys[0], walls).length,
    findPath(ARENA.spawns[1], ARENA.keys[1], walls).length,
  );
  assert.equal(
    findPath(ARENA.keys[0], ARENA.exit, walls).length,
    findPath(ARENA.keys[1], ARENA.exit, walls).length,
  );
  for (const gate of ARENA.gates)
    assert.ok(
      ARENA.gates.some((other) => other.x === -gate.x && other.z === gate.z),
    );
});
test("shove knocks a nearby rival, respects cooldown and never clips walls", () => {
  const g = playing(),
    a = g.players[0],
    b = g.players[2];
  Object.assign(a, ARENA.spawns[0]);
  Object.assign(b, { x: a.x + 0.9, z: a.z });
  a.input.shove = true;
  tick(g, 0.03, 4, members());
  assert.ok(b.vx > 0);
  assert.equal(a.shoveAt, 6.5);
  a.input.shove = true;
  tick(g, 0.03, 4.1, members());
  assert.equal(a.shoveAt, 6.5);
  for (let i = 0; i < 30; i++) tick(g, 1 / 30, 4.2 + i / 30, members());
  assert.ok(isFree(b.x, b.z, obstacles(g, 5.2)));
});
test("bumper hits grounded players while airborne players can dodge it", () => {
  const g = playing(),
    bumper = ARENA.bumpers[0];
  action(g, 1, bumper.id, 4);
  Object.assign(g.players[0], { x: bumper.x + 0.6, z: bumper.z });
  Object.assign(g.players[2], {
    x: bumper.x - 0.6,
    z: bumper.z,
    y: 1.1,
    vy: 0,
  });
  tick(g, 0.03, 4.8, members());
  assert.ok(g.players[0].stun > 4.8);
  assert.ok(g.players[0].vx > 0);
  assert.equal(g.players[2].stun, 0);
});
