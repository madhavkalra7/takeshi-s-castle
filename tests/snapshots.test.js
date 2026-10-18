import test from "node:test";
import assert from "node:assert/strict";
import { SnapshotBuffer } from "../src/snapshots.js";
const frame = (t, x, yaw = 0, round = 1) => ({
  serverTime: t,
  round,
  phase: "playing",
  players: [{ slot: 2, role: "runner", x, z: 0, y: x / 2, yaw, hidden: false }],
});
test("remote movement interpolates halfway between network updates", () => {
  const b = new SnapshotBuffer(0.05);
  b.push(frame(1, 0), 1000);
  b.push(frame(1.1, 1), 1100);
  const p = b.sample(1100).players[0];
  assert.ok(Math.abs(p.x - 0.5) < 1e-8);
  assert.ok(Math.abs(p.y - 0.25) < 1e-8);
});
test("heading interpolation takes the short path across the angle boundary", () => {
  const b = new SnapshotBuffer(0.05);
  b.push(frame(1, 0, Math.PI - 0.1), 1000);
  b.push(frame(1.1, 1, -Math.PI + 0.1), 1100);
  assert.ok(Math.abs(Math.abs(b.sample(1100).players[0].yaw) - Math.PI) < 1e-8);
});
test("round resets and teleports snap instead of moving through maze walls", () => {
  const b = new SnapshotBuffer(0.05);
  b.push(frame(1, 0), 1000);
  b.push(frame(1.1, 20), 1100);
  assert.equal(b.sample(1100).players[0].x, 20);
  b.push(frame(1.2, -10, 0, 2), 1200);
  assert.equal(b.sample(1200).players[0].x, -10);
  assert.equal(b.frames.length, 1);
});
test("out-of-order packets and packet loss cannot extrapolate characters indefinitely", () => {
  const b = new SnapshotBuffer(0.05);
  b.push(frame(1, 0), 1000);
  b.push(frame(1.1, 1), 1100);
  b.push(frame(1.05, 99), 1200);
  assert.equal(b.sample(5000).players[0].x, 1);
  b.clear();
  assert.equal(b.sample(5000), null);
});
