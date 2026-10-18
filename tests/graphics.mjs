import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: "3293", NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3293/health")).ok) break;
    } catch {}
    if (i === 99) throw Error(output);
    await new Promise((r) => setTimeout(r, 50));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 750 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3293/tests/graphics-harness.html");
  await page.waitForFunction(() => window.harness);
  const baseline = await page.evaluate(() => {
    const h = window.harness,
      calls = [];
    for (let i = 0; i < 12; i++) calls.push(h.render());
    return {
      calls,
      visible: [...h.scene.avatars.values()].filter((a) => a.visible).length,
    };
  });
  console.log(JSON.stringify(baseline));
  if (!process.env.GRAPHICS_BASELINE) {
    assert.equal(
      baseline.visible,
      2,
      "controller sees both characters at opposite spawn points",
    );
    const result = await page.evaluate(async () => {
      const { Vector2, Raycaster } = window.harness;
      const h = window.harness,
        { scene, game } = h;
      Object.assign(game.players[0], { x: 0, z: 0, y: 0 });
      Object.assign(game.players[2], { x: 0, z: -1.4, y: 0 });
      scene.setMode("runner");
      scene.yaw = 0;
      scene.pitch = 0;
      h.render(0);
      const self = scene.avatars.get(10),
        enemy = scene.avatars.get(12);
      scene.scene.updateMatrixWorld(true);
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(0, 0), scene.camera);
      function visible(o) {
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      }
      const hit = ray
        .intersectObjects(scene.world.children, true)
        .find((h) => visible(h.object));
      let parent = hit?.object;
      while (
        parent &&
        !parent.userData.actorSlot &&
        parent.userData.actorSlot !== 0
      )
        parent = parent.parent;
      const frontSlot = parent?.userData.actorSlot;
      const hiddenSelf = !self.visible,
        visibleEnemy = enemy.visible;
      const w = h.ARENA.walls.find((w) => Math.max(w.w, w.d) > h.CELL),
        alongX = w.w > w.d;
      Object.assign(game.players[0], {
        x: w.x + (alongX ? 0 : -1),
        z: w.z + (alongX ? 1 : 0),
        y: 0,
      });
      Object.assign(game.players[2], {
        x: w.x + (alongX ? 0 : 1),
        z: w.z + (alongX ? -1 : 0),
        y: 0,
      });
      scene.yaw = alongX ? 0 : -Math.PI / 2;
      h.render(0);
      scene.scene.updateMatrixWorld(true);
      ray.setFromCamera(new Vector2(0, 0), scene.camera);
      const blocked = ray
        .intersectObjects(scene.world.children, true)
        .find((h) => visible(h.object));
      let blocker = blocked?.object;
      while (blocker && blocker.userData.actorSlot === undefined)
        blocker = blocker.parent;
      return {
        hiddenSelf,
        visibleEnemy,
        frontSlot,
        blockedByWall: !blocker,
        normalDepth: enemy.children
          .filter((o) => o.isMesh && !o.userData.marker)
          .every((o) => o.material.depthTest),
      };
    });
    assert.equal(result.hiddenSelf, true);
    assert.equal(result.visibleEnemy, true);
    assert.equal(result.frontSlot, 2, "opponent is visible in the FPP camera");
    assert.equal(
      result.blockedByWall,
      true,
      "FPP cannot see opponents through closed room walls",
    );
    assert.equal(result.normalDepth, true);
    const picked = await page.evaluate(() => {
      const h = window.harness,
        s = h.scene;
      s.setMode("controller");
      h.render(1);
      const d = h.ARENA.doors[0],
        p = s.project(d.x, 1.3, d.z);
      return { expected: d.id, picked: s.pick(p.x, p.y) };
    });
    assert.equal(
      picked.picked,
      picked.expected,
      "Instanced doors retain mouse interaction",
    );
    const quality = await page.evaluate(() => {
      const s = window.harness.scene;
      for (let i = 0; i < 180; i++) s.updateQuality("high", 0.04);
      const slowed = s.renderer.getPixelRatio();
      s.updateQuality("low", 1 / 60);
      return {
        slowed,
        lowRatio: s.renderer.getPixelRatio(),
        shadows: s.renderer.shadowMap.enabled,
      };
    });
    assert.ok(quality.slowed < 1);
    assert.ok(quality.slowed >= 0.8);
    assert.equal(quality.lowRatio, 1);
    assert.equal(quality.shadows, false);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: both controller characters, first-person opponent rendering, wall occlusion, and graphics initialization.",
    );
  }
} finally {
  await browser?.close();
  server.kill();
}
