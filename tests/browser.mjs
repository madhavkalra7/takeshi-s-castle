import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
const started = Date.now();
const log = (s) =>
  console.log(`${Math.round((Date.now() - started) / 1000)}s ${s}`);
const port = 3198,
  url = `http://127.0.0.1:${port}`,
  errors = [],
  contexts = [];
const server = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/health")).ok) break;
    } catch {}
    if (i === 99) throw Error(logs);
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
  await fs.mkdir("test-results", { recursive: true });
  async function pageAt(width = 1280, height = 800) {
    const context = await browser.newContext({ viewport: { width, height } });
    contexts.push(context);
    await context.addInitScript(() =>
      localStorage.setItem("mr-quality", "low"),
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.locator("#practice").waitFor();
    return page;
  }
  const host = await pageAt();
  await host.screenshot({ path: "test-results/landing.png" });
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await host.setViewportSize(size);
    const button = await host.locator("#practice").boundingBox();
    assert.ok(
      button.y >= 0 && button.y + button.height <= size.height,
      `practice button offscreen at ${size.width}x${size.height}`,
    );
    assert.ok(
      await host.evaluate(
        () => document.querySelector("#ui").scrollWidth <= innerWidth,
      ),
      "horizontal overflow",
    );
  }
  await host.setViewportSize({ width: 1280, height: 800 });
  await host.locator("#name").fill("Test Host");
  await host.locator("#create").click();
  await host.locator(".room-code button").waitFor();
  const room = (await host.locator(".room-code button").textContent()).trim();
  assert.match(room, /^[A-F0-9]{6}$/);
  assert.equal(await host.locator("#start").isDisabled(), true);
  const pages = [host];
  for (let i = 1; i < 4; i++) {
    const page = await pageAt(1000, 750);
    pages.push(page);
    await page.locator("#name").fill(`Friend ${i}`);
    await page.locator("#join").click();
    await page.locator("#code").fill(room);
    await page.locator("#join-form button").click();
    await page.getByText("ASSEMBLE YOUR CREW.").waitFor();
  }
  assert.equal(await host.locator(".lobby .teams .seat").count(), 4);
  log("Four-player lobby ready");
  await host.screenshot({ path: "test-results/lobby.png" });
  await host.locator("#start").click();
  await Promise.all(pages.map((p) => p.locator(".role-card").waitFor()));
  await host
    .locator("#countdown")
    .waitFor({ state: "detached", timeout: 12000 });
  assert.match(await host.locator(".role-card strong").textContent(), /RUNNER/);
  assert.match(
    await pages[1].locator(".role-card strong").textContent(),
    /CONTROLLER/,
  );
  log("Match live");
  const controller = pages[1];
  await controller.screenshot({ path: "test-results/controller.png" });
  assert.equal(await controller.locator(".device-marker").count(), 11);
  await controller.locator("#device-g0").click();
  await controller.waitForFunction(
    () => parseInt(document.querySelector("#energy-value").textContent) < 90,
  );
  assert.equal(await controller.locator("#device-g0").isDisabled(), true);
  const before = await host.locator("#compass").textContent();
  await host.keyboard.down("KeyW");
  await host.waitForTimeout(450);
  await host.keyboard.up("KeyW");
  await host.waitForTimeout(250);
  assert.notEqual(
    await host.locator("#compass").textContent(),
    before,
    "runner movement should change target distance",
  );
  await host.keyboard.press("Space");
  await host.waitForTimeout(160);
  await host.screenshot({ path: "test-results/runner.png" });
  await host.locator("#audio").click();
  assert.equal(await host.locator("#audio").textContent(), "Sound off");
  await host.selectOption("#quality", "low");
  await host.locator("#help").click();
  await host.locator("#got-it").click();
  // Refresh preserves a seat and resumes a paused live match.
  log("Reloading host");
  await host.reload();
  await host.locator(".role-card").waitFor({ timeout: 25000 });
  log("Seat recovered");
  assert.match(await host.locator(".role-card strong").textContent(), /RUNNER/);
  for (const p of pages) {
    await p.locator("#exit-game").click();
    await p.locator("#leave-now").click();
    await p.locator("#practice").waitFor();
  }
  // A controller practice game progresses, scores, and swaps the human into runner.
  log("Testing solo practice");
  await host.locator("#practice").click();
  await host.locator("#practice-controller").click();
  await host.locator("#start").click();
  await host.locator(".role-card strong").waitFor();
  assert.equal(
    await host.locator(".role-card strong").textContent(),
    "CONTROLLER",
  );
  await host.waitForFunction(
    () =>
      document.querySelector("#round-label")?.textContent.includes("ROUND 2"),
    {},
    { timeout: 105000 },
  );
  assert.equal(await host.locator(".role-card strong").textContent(), "RUNNER");
  assert.equal(errors.length, 0, `Browser errors: ${errors.join("\n")}`);
  console.log(
    "PASS: responsive menu, four-player room, live roles, controller actions, keyboard movement, jump, audio, graphics, help, reconnect, leaving, bot scoring, and role swap.",
  );
} catch (error) {
  for (let i = 0; i < contexts.length; i++) {
    const p = contexts[i].pages()[0];
    if (p) {
      await p
        .screenshot({ path: `test-results/failure-${i}.png` })
        .catch(() => {});
      console.error(
        `PAGE ${i}:`,
        await p
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
    }
  }
  console.error("SERVER", logs);
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
