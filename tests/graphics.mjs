import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
  const loaded = await page.evaluate(
    async () => !!(await window.harness.scene.characterReady),
  );
  assert.equal(
    loaded,
    true,
    "uploaded GLB and embedded textures load successfully",
  );
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
    const models = await page.evaluate(() => {
      const { scene } = window.harness;
      const actors = [...scene.avatars.values()];
      return {
        count: actors.filter((a) => a.userData.character).length,
        independent:
          actors[0].userData.character !== actors[1].userData.character,
        fallbackRemoved: actors.every(
          (a) => !a.children.includes(a.userData.fallback),
        ),
        textured: actors.every((a) => {
          let textured = false;
          a.userData.character.traverse((o) => {
            if (o.isMesh && o.material.map?.image?.width === 1024)
              textured = true;
          });
          return textured;
        }),
        overview: actors.every((a) => {
          let valid = true;
          a.userData.character.traverse((o) => {
            if (o.isMesh && o.material.depthTest) valid = false;
          });
          return valid;
        }),
      };
    });
    assert.equal(models.count, 2, "both runners use the uploaded character");
    assert.equal(
      models.independent,
      true,
      "runners have independent model transforms",
    );
    assert.equal(models.fallbackRemoved, true);
    assert.equal(
      models.textured,
      true,
      "embedded character textures are preserved",
    );
    assert.equal(
      models.overview,
      true,
      "spectators see both character meshes above maze walls",
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
        normalDepth: (() => {
          let valid = true;
          enemy.traverse((o) => {
            if (o.isMesh && !o.userData.marker && !o.material.depthTest)
              valid = false;
          });
          return valid;
        })(),
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
    await page.evaluate(() => {
      const h = window.harness;
      Object.assign(h.game.players[0], { x: 0, z: 0, y: 0 });
      Object.assign(h.game.players[2], { x: 0, z: -1.4, y: 0, yaw: 0 });
      h.scene.yaw = 0;
      h.scene.pitch = 0;
      for (let i = 0; i < 30; i++) h.render(0);
    });
    await mkdir("test-results", { recursive: true });
    const fppImage = await page.evaluate(() => {
      const h = window.harness;
      h.render(0);
      return h.scene.renderer.domElement.toDataURL("image/png").split(",")[1];
    });
    await writeFile(
      "test-results/character-fpp.png",
      Buffer.from(fppImage, "base64"),
    );
    const doors = await page.evaluate(() => {
      const h = window.harness,
        { scene, game, Raycaster, Vector2 } = h;
      const matrices = scene.doorPanels.instanceMatrix.array;
      const transforms = h.ARENA.doors.every((d, index) => {
        const alongX = d.w > d.d;
        return [-1, 1].every((sign, leaf) => {
          const start = (index * 2 + leaf) * 16;
          return (
            Array.from(matrices.slice(start, start + 16)).every(
              Number.isFinite,
            ) &&
            Math.abs(matrices[start + 12] - d.x - (alongX ? sign * 0.425 : 0)) <
              0.00001 &&
            Math.abs(matrices[start + 13] - 1.325) < 0.00001 &&
            Math.abs(matrices[start + 14] - d.z - (alongX ? 0 : sign * 0.425)) <
              0.00001
          );
        });
      });
      const visible = (o) => {
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
      const hits = [true, false].map((alongX) => {
        const d = h.ARENA.doors.find((d) => d.w > d.d === alongX);
        Object.assign(game.players[0], {
          x: d.x + (alongX ? 0.425 : -1.5),
          z: d.z + (alongX ? 1.5 : 0.425),
          y: 0,
        });
        scene.setMode("runner");
        scene.yaw = alongX ? 0 : -Math.PI / 2;
        scene.pitch = 0;
        h.render(0);
        scene.scene.updateMatrixWorld(true);
        const ray = new Raycaster();
        ray.setFromCamera(new Vector2(0, 0), scene.camera);
        const hit = ray
          .intersectObjects(scene.world.children, true)
          .find((h) => visible(h.object));
        return (
          hit?.object === scene.doorPanels &&
          hit.instanceId === h.ARENA.doors.indexOf(d) * 2 + 1
        );
      });
      const d = h.ARENA.doors[0],
        before = Array.from(matrices);
      game.devices[d.id] = { ...game.devices[d.id], openUntil: 5.5 };
      for (let i = 0; i < 60; i++) h.render(0);
      const axis = d.w > d.d ? 12 : 14;
      const opens =
        Math.abs(matrices[axis] - before[axis] + 0.85) < 0.00001 &&
        Math.abs(matrices[16 + axis] - before[16 + axis] - 0.85) < 0.00001;
      const isolated = Array.from(matrices.slice(32)).every(
        (v, i) => v === before[32 + i],
      );
      game.devices[d.id].openUntil = 0;
      for (let i = 0; i < 60; i++) h.render(0);
      return { transforms, hits, opens, isolated };
    });
    assert.equal(
      doors.transforms,
      true,
      "every door leaf has a finite world transform at its doorway",
    );
    assert.deepEqual(
      doors.hits,
      [true, true],
      "FPP sees the rendered door leaves in both wall orientations",
    );
    assert.equal(doors.opens, true, "opening moves both rendered leaves apart");
    assert.equal(
      doors.isolated,
      true,
      "opening one door does not move another door",
    );
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
    const overviewImage = await page.evaluate(() => {
      const h = window.harness;
      h.render(1);
      return h.scene.renderer.domElement.toDataURL("image/png").split(",")[1];
    });
    await writeFile(
      "test-results/character-overview.png",
      Buffer.from(overviewImage, "base64"),
    );
    const fallbackPage = await browser.newPage();
    await fallbackPage.route("**/models/community-character.glb", (route) =>
      route.abort(),
    );
    await fallbackPage.goto(
      "http://127.0.0.1:3293/tests/graphics-harness.html",
    );
    await fallbackPage.waitForFunction(() => window.harness);
    const fallback = await fallbackPage.evaluate(async () => {
      const h = window.harness;
      const loaded = await h.scene.characterReady;
      h.render();
      return (
        loaded === null &&
        [...h.scene.avatars.values()].every(
          (a) => a.visible && a.children.includes(a.userData.fallback),
        )
      );
    });
    assert.equal(
      fallback,
      true,
      "a failed asset download preserves playable fallback characters",
    );
    await fallbackPage.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: both controller characters, first-person opponent rendering, wall occlusion, and graphics initialization.",
    );
  }
} finally {
  await browser?.close();
  server.kill();
}
