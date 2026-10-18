import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

// Exercise the actual npm dev command, including its Node startup flags.
test(
  "development startup stays alive while Vite generates and serves modules",
  { timeout: 15000 },
  async () => {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const [command, ...args] = pkg.scripts.dev.split(" ");
    assert.equal(command, "node");
    const server = spawn(process.execPath, args, {
      env: { ...process.env, NODE_ENV: "development", PORT: "3289" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    server.stdout.on("data", (data) => (output += data));
    server.stderr.on("data", (data) => (output += data));
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw Error(output);
        try {
          if ((await fetch("http://127.0.0.1:3289/health")).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(ready, output);
      for (const path of [
        "/",
        "/src/main.js",
        "/src/scene.js",
        "/src/style.css",
      ]) {
        const response = await fetch("http://127.0.0.1:3289" + path);
        assert.equal(response.status, 200, path);
        await response.text();
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
      assert.equal(server.exitCode, null, output);
      assert.equal((output.match(/MAZE RIOT ready/g) || []).length, 1, output);
      assert.doesNotMatch(output, /Restarting|Change detected/);
      assert.equal((await fetch("http://127.0.0.1:3289/health")).status, 200);
    } finally {
      server.kill();
    }
  },
);
