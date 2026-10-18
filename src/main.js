import { io } from "socket.io-client";
import { SnapshotBuffer } from "./snapshots.js";
import { Music } from "./music.js";
import { ArenaScene } from "./scene.js";
import {
  ARENA,
  doorIsOpen,
  COST,
  COOLDOWN,
  TEAM_NAMES,
  obstacles,
  move,
} from "../shared/game.js";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-900.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-700.css";
import "./style.css";
const app = document.querySelector("#app");
app.innerHTML =
  '<div id="world" aria-label="3D maze arena"></div><main id="ui"></main><div id="notifications" role="status" aria-live="polite"></div><div id="modal-root"></div>';
const ui = document.querySelector("#ui"),
  modalRoot = document.querySelector("#modal-root");
const socket = io({ autoConnect: true, reconnection: true });
let scene;
try {
  scene = new ArenaScene(document.querySelector("#world"));
} catch (error) {
  app.innerHTML =
    '<div style="padding:50px;font:18px system-ui;color:white"><h1>3D graphics unavailable</h1><p>MAZE RIOT needs WebGL. Enable hardware acceleration in your browser, then reload.</p></div>';
  throw error;
}
let state = null,
  lobby = null,
  slot = 0,
  token = "",
  connected = false,
  local = null,
  lastFrame = performance.now(),
  sendAt = 0,
  lastEvent = 0,
  screenKey = "",
  mute = localStorage.getItem("mr-mute") === "true",
  quality = localStorage.getItem("mr-quality") || "high",
  audio = null;
const music = new Music();
const snapshots = new SnapshotBuffer();
let visualPoses = null,
  clientWalls = [],
  markerTime = 0;
let roomActive = false;
let selectedTool = "door",
  nearDoor = null;
const keys = new Set();
let jump = false,
  shove = false,
  drag = false,
  lastPointer = { x: 0, y: 0 },
  toastTimer,
  requestBusy = false;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = '<span class="brand-icon">↱</span>';
const brand = `<div class="brand">${icon} MAZE<span>RIOT</span></div>`;
const devices = [
  ...ARENA.rotators,
  ...ARENA.gates,
  ...ARENA.bumpers,
  ...ARENA.doors,
];
function toast(message) {
  const root = document.querySelector("#notifications");
  root.innerHTML = `<div class="toast">${esc(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (root.innerHTML = ""), 3500);
}
function sound(frequency = 500, duration = 0.08) {
  music.unlock();
  if (mute) return;
  try {
    audio ||= new AudioContext();
    if (audio.state === "suspended") audio.resume();
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, audio.currentTime);
    gain.gain.setValueAtTime(0.055 * music.volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  } catch {}
}
function button(id, fn) {
  document.getElementById(id)?.addEventListener("click", fn);
}
function modal(content) {
  stopInput();
  document.exitPointerLock?.();
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><button class="close" aria-label="Close dialog">×</button>${content}</section></div>`;
  modalRoot.querySelector(".close").onclick = closeModal;
  modalRoot.querySelector("input,button:not(.close)")?.focus();
  modalRoot.querySelector(".modal-backdrop").onclick = (e) => {
    if (e.target === e.currentTarget) closeModal();
  };
}
function closeModal() {
  modalRoot.innerHTML = "";
}
function instructions() {
  modal(
    `<h2>Friends. Rivals. Chaos.</h2><p>Four players. Two teams. The first team to win three rounds takes the arena.</p><div class="instruction"><span class="num">01</span><div><strong>RUN THE MAZE</strong><p>Grab your team-coloured key, then race to the north EXIT. WASD to move, mouse to look, Space to jump, E to open doors, F to shove nearby rivals.</p></div></div><div class="instruction"><span class="num">02</span><div><strong>CONTROL THE CHAOS</strong><p>Click labelled devices to rotate walls (30 energy), close gates for 3 seconds (35), or fire bumpers (40). Energy regenerates. Devices have shared cooldowns.</p></div></div><div class="instruction"><span class="num">03</span><div><strong>PLAY AS A TEAM</strong><p>Talk using your favourite voice app. Controllers can track both runners across the entire maze. All traps affect both teams! Roles swap every round.</p></div></div><p>Traps flash before firing. Walls and gates refuse to close through a runner and refund the energy. Jump over an active bumper to avoid its hit.</p><button id="got-it" class="primary">LET’S GO →</button>`,
  );
  button("got-it", closeModal);
}
function topbar() {
  return `<header class="topbar">${brand}<div class="top-right"><span class="live-text"><i class="status-dot"></i>4 PLAYERS · 2 TEAMS</span><button id="how" class="quiet">How to play ↗</button></div></header>`;
}
function landing() {
  ui.style.overflowY = "auto";
  screenKey = "landing";
  ui.innerHTML = `<div class="landing-shade"></div>${topbar()}<section class="hero"><div class="eyebrow">THE FRIENDSHIP STRESS TEST</div><h1>RUN THE<br>MAZE.<br><em>RULE THE<br>CHAOS.</em></h1><p class="hero-description">Your friend runs. You pull the strings.<br>A 2v2 maze race where the arena fights back.</p><div class="tags"><span class="tag">REAL-TIME 3D</span><span class="tag">2V2 MULTIPLAYER</span><span class="tag">FREE TO PLAY</span></div><form id="entry" class="entry-form"><label class="field-label" for="name">WHAT SHOULD WE CALL YOU?</label><input id="name" name="name" maxlength="18" autocomplete="nickname" placeholder="Your player name" value="${esc(localStorage.getItem("mr-name") || "")}" required/><div class="entry-actions"><button id="create" type="submit" class="primary">CREATE ROOM ↗</button><button id="join" type="button" class="secondary">Join room</button></div><button id="practice" type="button" class="practice-link">Just exploring? Try solo with bots →</button><p class="small-screen">Best played on a computer with a keyboard and mouse.</p></form></section><div class="hero-note"><strong>ONE ARENA.<br>ZERO TRUST.</strong><br>Rotate walls. Drop gates.<br>Try not to trap your teammate.</div><footer class="footer"><div class="steps"><span><b>01</b> INVITE YOUR CREW</span><span><b>02</b> PICK YOUR SIDE</span><span><b>03</b> CAUSE SOME CHAOS</span></div><span>HEADPHONES ON. FRIENDSHIPS OPTIONAL.</span></footer>`;
  button("how", instructions);
  document.querySelector("#entry").onsubmit = (e) => {
    e.preventDefault();
    enter("create");
  };
  button("join", joinDialog);
  button("practice", practiceDialog);
}
function playerName() {
  const value =
    document.querySelector("#name")?.value.trim() ||
    localStorage.getItem("mr-name") ||
    "Player";
  localStorage.setItem("mr-name", value);
  return value;
}
function joinDialog() {
  playerName();
  modal(
    '<h2>Join your crew.</h2><p>Get the six-character code from your host.</p><form id="join-form"><label class="field-label" for="code">ROOM CODE</label><input id="code" maxlength="6" autocomplete="off" placeholder="A1B2C3" style="text-transform:uppercase;letter-spacing:4px" required/><button class="primary" type="submit">JOIN ROOM →</button></form>',
  );
  document.querySelector("#join-form").onsubmit = (e) => {
    e.preventDefault();
    enter("join", { code: document.querySelector("#code").value });
  };
}
function practiceDialog() {
  playerName();
  modal(
    '<h2>Pick your playground.</h2><p>Three bots fill the other seats. Your role swaps after each round, just like a real match.</p><div class="choice-row"><button id="practice-runner" class="secondary">🏃 Start as runner</button><button id="practice-controller" class="secondary">⌘ Start as controller</button></div>',
  );
  button("practice-runner", () => enter("practice", { role: "runner" }));
  button("practice-controller", () =>
    enter("practice", { role: "controller" }),
  );
}
async function request(event, data = {}) {
  return new Promise((resolve) =>
    socket.timeout(6000).emit(event, data, (error, result) =>
      resolve(
        error
          ? {
              error:
                "Server did not respond. Check your connection and try again.",
            }
          : result || { error: "Unexpected server response." },
      ),
    ),
  );
}
async function enter(mode, extra = {}) {
  if (requestBusy) return;
  if (!connected)
    return toast("Connecting to the arena server. Try again in a moment.");
  requestBusy = true;
  const result = await request("enter", { mode, name: playerName(), ...extra });
  requestBusy = false;
  if (result.error) return toast(result.error);
  roomActive = true;
  slot = result.slot;
  token = result.token;
  lobby = result.lobby;
  state = null;
  local = null;
  lastEvent = 0;
  closeModal();
  sessionStorage.setItem(
    "mr-session",
    JSON.stringify({ code: lobby.code, token }),
  );
  history.replaceState({}, "", `?room=${lobby.code}`);
  renderLobby();
  sound(660);
}
function renderLobby() {
  if (!lobby || state) return;
  ui.style.overflowY = "auto";
  screenKey = "lobby";
  const host = lobby.host === slot;
  ui.innerHTML = `<div class="landing-shade" style="background:#07132177"></div>${topbar()}<div class="lobby-wrap"><section class="lobby"><div class="lobby-head"><div><div class="lobby-kicker">${lobby.practice ? "PRACTICE ARENA" : "PRIVATE ROOM · INVITE YOUR FRIENDS"}</div><h2>ASSEMBLE YOUR CREW.</h2></div><div class="room-code"><small>CLICK TO COPY INVITE</small><button id="copy-room" title="Copy room invite">${lobby.code}</button></div></div><div class="teams">${[
    0, 1,
  ]
    .map(
      (team) =>
        `<div class="${team ? "orange-team" : ""}"><div class="team-title ${team ? "orange" : ""}"><span>TEAM ${TEAM_NAMES[team]}</span><span>${team ? "◆" : "◈"}</span></div><div class="team-seats">${[
          team * 2,
          team * 2 + 1,
        ]
          .map((i) => {
            const m = lobby.members[i];
            return `<div class="seat"><span class="seat-icon">${i % 2 ? "⌘" : "↟"}</span><div><strong>${m ? esc(m.name) : "Open seat"}</strong><small>${i % 2 ? "CONTROLLER" : "RUNNER"}${i === lobby.host ? " · HOST" : ""}</small></div>${i === slot ? '<span class="you">YOU</span>' : !m ? `<button data-seat="${i}">Take seat</button>` : ""}</div>`;
          })
          .join("")}</div></div>`,
    )
    .join(
      "",
    )}</div><div class="lobby-bottom"><p>${lobby.members.filter(Boolean).length}/4 seats filled · Roles swap each round.<br>${host ? "Invite friends or add bots to fill the arena." : "Waiting for the host to start the match."}</p><div class="buttons"><button id="leave-lobby" class="quiet">Leave</button>${host ? `${lobby.members.some((m) => !m) ? '<button id="fill" class="secondary">Add bots</button>' : ""}<button id="start" class="primary" ${lobby.members.some((m) => !m) ? "disabled" : ""}>ENTER ARENA →</button>` : ""}</div></div></section></div>`;
  button("how", instructions);
  button("copy-room", copyInvite);
  button("leave-lobby", leaveRoom);
  button("fill", async () => {
    const r = await request("fill");
    if (r.error) toast(r.error);
  });
  button("start", async () => {
    const r = await request("start");
    if (r.error) toast(r.error);
  });
  ui.querySelectorAll("[data-seat]").forEach(
    (b) =>
      (b.onclick = async () => {
        const r = await request("seat", Number(b.dataset.seat));
        if (r.error) toast(r.error);
        else {
          roomActive = true;
          slot = r.slot;
          renderLobby();
        }
      }),
  );
}
async function copyInvite() {
  try {
    await navigator.clipboard.writeText(
      `${location.origin}${location.pathname}?room=${lobby.code}`,
    );
    toast("Invite link copied. Send it to your crew.");
  } catch {
    toast(`Room code: ${lobby.code}`);
  }
}
function leaveRoom() {
  snapshots.clear();
  visualPoses = null;
  roomActive = false;
  socket.emit("leave");
  sessionStorage.removeItem("mr-session");
  history.replaceState({}, "", location.pathname);
  state = null;
  music.setActive(false);
  lobby = null;
  local = null;
  stopInput();
  document.exitPointerLock?.();
  closeModal();
  landing();
}
function leaveDialog() {
  modal(
    '<h2>Leave the arena?</h2><p>Your match pauses briefly if you disconnect. After 20 seconds, a bot takes your seat.</p><div class="choice-row"><button id="stay" class="secondary">Keep playing</button><button id="leave-now" class="primary">Leave match</button></div>',
  );
  button("stay", closeModal);
  button("leave-now", leaveRoom);
}
function gameUI() {
  ui.style.overflowY = "hidden";
  const own = state.players[slot],
    controller = own.role === "controller";
  screenKey = `game-${own.role}-${state.round}`;
  ui.dataset.role = own.role;
  ui.innerHTML = `<header class="game-top"><div class="scoreboard"><div class="score-team">TIDAL<strong id="score0">0</strong></div><div class="clock" id="clock-wrap"><strong id="clock">3:00</strong><small id="round-label">ROUND 1</small></div><div class="score-team orange">EMBER<strong id="score1">0</strong></div></div><div class="game-tools"><button class="quiet" id="audio" aria-label="Toggle music">${mute ? "Music off" : "Music on"}</button><button class="quiet" id="settings">Settings</button><button class="quiet" id="exit-game">Leave</button></div></header><aside class="role-card ${own.team ? "ember" : ""}"><small>${TEAM_NAMES[own.team]}</small><strong>${controller ? "CONTROLLER" : "RUNNER"}</strong></aside><aside class="objective"><small>${controller ? "TEAM OBJECTIVE" : "OBJECTIVE"}</small><div id="key-objective">◇ Find your key</div><div id="exit-objective">↟ Reach the exit</div><div class="compass" id="compass"></div></aside><div id="markers"></div><div id="player-labels"></div><div id="phase-message"></div><div id="connection"></div><div class="event-feed" id="event-feed"></div><div class="game-bottom"><div class="controls-hint">${controller ? '<div class="tool-tabs"><button data-tool="door" class="active">Doors</button><button data-tool="rotate">Walls</button><button data-tool="bumper">Bumpers</button></div>' : "<span><kbd>WASD</kbd> Move</span><span><kbd>E</kbd> Door</span><span><kbd>F</kbd> Shove</span><span><kbd>SPACE</kbd> Jump</span>"}</div>${controller ? '<div class="energy-card"><div class="label"><span>ENERGY</span><b id="energy-value">100 / 100</b></div><div class="energy-track"><div class="energy-fill" id="energy-fill"></div></div></div>' : '<div class="energy-card"><div class="label"><span>SHOVE · F</span><b id="shove-value">READY</b></div><div class="energy-track"><div class="energy-fill" id="shove-fill"></div></div></div>'}</div><div id="door-prompt"></div>${controller ? "" : '<div class="reticle"></div><div class="look-hint" id="look-hint">Click to look around · Esc releases mouse</div>'}`;
  selectedTool = "door";
  ui.querySelectorAll("[data-tool]").forEach(
    (b) =>
      (b.onclick = () => {
        selectedTool = b.dataset.tool;
        ui.querySelectorAll("[data-tool]").forEach((t) =>
          t.classList.toggle("active", t === b),
        );
        positionOverlays();
      }),
  );
  button("audio", () => {
    mute = !mute;
    localStorage.setItem("mr-mute", mute);
    music.setMuted(mute);
    document.querySelector("#audio").textContent = mute
      ? "Music off"
      : "Music on";
    music.unlock();
  });
  button("settings", settingsDialog);
  button("exit-game", leaveDialog);
  if (controller) {
    const markers = document.querySelector("#markers");
    for (const d of devices) {
      const b = document.createElement("button");
      b.id = `device-${d.id}`;
      b.className = `device-marker ${d.type}`;
      b.title = `${d.type.toUpperCase()} · ${COST[d.type]} energy · ${COOLDOWN[d.type]}s cooldown`;
      b.setAttribute("aria-label", `${d.type} ${d.id.toUpperCase()}`);
      b.onclick = (e) => {
        e.stopPropagation();
        activate(d.id);
      };
      markers.append(b);
    }
  }
  const labels = document.querySelector("#player-labels");
  for (const p of state.players.filter((p) => p.role === "runner")) {
    const label = document.createElement("div");
    label.id = `label-${p.slot}`;
    label.className = "player-label";
    label.style.color = p.team ? "var(--orange)" : "var(--cyan)";
    label.textContent = `${p.name}${p.slot === slot ? " · YOU" : ""}`;
    labels.append(label);
  }
}
let phaseKey = "";
function updateHUD() {
  if (!state) return;
  const own = state.players[slot],
    runner = state.players.find(
      (p) => p.team === own.team && p.role === "runner",
    ),
    controller = own.role === "controller";
  if (screenKey !== `game-${own.role}-${state.round}`) {
    gameUI();
    phaseKey = "";
  }
  for (let i = 0; i < 2; i++)
    document.querySelector(`#score${i}`).textContent = state.scores[i];
  const seconds = Math.ceil(state.remaining);
  document.querySelector("#clock").textContent =
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  document
    .querySelector("#clock-wrap")
    .classList.toggle("urgent", seconds <= 15);
  document.querySelector("#round-label").textContent =
    `ROUND ${state.round} · FIRST TO 3`;
  document.querySelector("#key-objective").textContent = runner.key
    ? "✓ Key collected"
    : "◇ Find your key";
  document.querySelector("#key-objective").classList.toggle("done", runner.key);
  document.querySelector("#exit-objective").style.color = runner.key
    ? "var(--gold)"
    : "";
  const target = runner.key ? ARENA.exit : ARENA.keys[own.team],
    distance = Math.hypot(target.x - runner.x, target.z - runner.z);
  document.querySelector("#compass").textContent =
    `${runner.key ? "EXIT" : "KEY"} · ${Math.round(distance)}m`;
  if (controller) {
    const e = state.energy[own.team];
    document.querySelector("#energy-value").textContent =
      `${Math.floor(e)} / 100`;
    document.querySelector("#energy-fill").style.width = `${e}%`;
  } else {
    const remaining = Math.max(0, own.shoveAt - state.serverTime);
    document.querySelector("#shove-value").textContent = remaining
      ? `${remaining.toFixed(1)}s`
      : "READY";
    document.querySelector("#shove-fill").style.width =
      `${(1 - remaining / 2.5) * 100}%`;
  }
  const pk = `${state.phase}-${state.round}-${state.roundWinner}-${state.winner}`;
  if (pk !== phaseKey) {
    phaseKey = pk;
    const root = document.querySelector("#phase-message");
    if (state.phase === "countdown")
      root.innerHTML = `<section class="center-message"><div class="eyebrow" style="justify-content:center">ROUND ${state.round}</div><h2>${controller ? "PULL THE STRINGS." : "FIND YOUR WAY OUT."}</h2><div class="big" id="countdown">3</div><p>${controller ? "Your runner needs you. Watch for the enemy." : "Your key matches your team colour. Exit is at the north end."}</p></section>`;
    else if (state.phase === "roundOver")
      root.innerHTML = `<section class="center-message"><div class="big">${state.roundWinner === null ? "TIME UP" : state.roundWinner === own.team ? "NICE ESCAPE!" : "THEY GOT OUT."}</div><p>${state.roundWinner === null ? "Round drawn. Nobody scores." : "Point to " + TEAM_NAMES[state.roundWinner] + "."}<br>Swap seats. Your next role: <b>${controller ? "RUNNER" : "CONTROLLER"}</b></p></section>`;
    else if (state.phase === "paused")
      root.innerHTML =
        '<section class="center-message"><h2>HOLD THAT THOUGHT.</h2><p>A player disconnected. Waiting up to 20 seconds<br>before a bot takes their seat.</p></section>';
    else if (state.phase === "finished") {
      document.exitPointerLock?.();
      root.innerHTML = `<section class="center-message"><div class="eyebrow" style="justify-content:center">MATCH COMPLETE</div><div class="big">${state.winner === own.team ? "VICTORY!" : "REMATCH?"}</div><h2>TEAM ${TEAM_NAMES[state.winner]} WINS</h2><p>${state.scores[0]} — ${state.scores[1]}<br>${lobby.host === slot ? "Ready for another round of chaos?" : "Waiting for the host to request a rematch."}</p>${lobby.host === slot ? '<button id="rematch" class="primary">PLAY AGAIN →</button>' : ""}<button id="back-home" class="secondary">Back home</button></section>`;
      button("rematch", async () => {
        const r = await request("rematch");
        if (r.error) toast(r.error);
      });
      button("back-home", leaveRoom);
    } else root.innerHTML = "";
  }
  if (state.phase === "countdown")
    document.querySelector("#countdown").textContent = Math.max(
      1,
      Math.ceil(state.phaseUntil - state.serverTime),
    );
  document.querySelector("#connection").innerHTML = connected
    ? ""
    : '<div class="connection-banner">Connection lost · reconnecting…</div>';
  document.querySelector("#event-feed").innerHTML = state.events
    .filter((e) => state.serverTime - e.at < 4 && e.id > 0)
    .filter((e) => /key|escaped|wins/i.test(e.text))
    .slice(-1)
    .map((e) => `<div>${esc(e.text)}</div>`)
    .join("");
  const event = state.events.at(-1);
  if (event && event.id > lastEvent) {
    lastEvent = event.id;
    sound(event.text.includes("escaped") ? 880 : 440, 0.1);
  }
}
function positionOverlays() {
  if (!state) return;
  const own = state.players[slot],
    runner = (visualPoses?.players || state.players).find(
      (p) => p.role === "runner" && p.team === own.team,
    );
  if (own.role === "controller" && performance.now() - markerTime > 50) {
    markerTime = performance.now();
    const candidates = devices
      .filter((d) =>
        selectedTool === "door"
          ? ["door", "gate"].includes(d.type)
          : d.type === selectedTool,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - runner.x, a.z - runner.z) -
          Math.hypot(b.x - runner.x, b.z - runner.z),
      );
    const visible = new Set(
      candidates.slice(0, selectedTool === "door" ? 6 : 4).map((d) => d.id),
    );
    for (const d of devices) {
      const b = document.getElementById(`device-${d.id}`);
      if (!b) continue;
      const p = scene.project(d.x, d.type === "rotate" ? 3.4 : 3.1, d.z),
        s = state.devices[d.id] || {},
        cd = Math.max(0, (s.cooldown || 0) - state.serverTime),
        warning = s.warning > state.serverTime;
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
      b.style.display = p.visible && visible.has(d.id) ? "" : "none";
      b.disabled =
        state.phase !== "playing" ||
        cd > 0 ||
        state.energy[own.team] < COST[d.type];
      b.classList.toggle("warning", warning);
      b.textContent = warning
        ? "!"
        : cd > 0
          ? Math.ceil(cd)
          : d.type === "rotate"
            ? "↻"
            : d.type === "bumper"
              ? "✦"
              : "▥";
      b.title = `${d.type === "door" ? "Lock door" : d.type} · ${COST[d.type]} energy`;
    }
  }
  for (const p of (visualPoses?.players || state.players).filter(
    (p) => p.role === "runner",
  )) {
    const label = document.getElementById(`label-${p.slot}`);
    if (!label) continue;
    const projected =
      own.role === "runner" || p.hidden
        ? { visible: false }
        : scene.project(p.x, (p.y || 0) + 2.55, p.z);
    label.style.display = projected.visible ? "" : "none";
    label.style.left = `${projected.x}px`;
    label.style.top = `${projected.y}px`;
  }
  nearDoor = null;
  const prompt = document.querySelector("#door-prompt");
  if (own.role === "runner" && state.phase === "playing") {
    const p = local || own;
    nearDoor = ARENA.doors
      .filter(
        (d) =>
          Math.hypot(p.x - d.x, p.z - d.z) < 2.4 &&
          !doorIsOpen(state, d.id, state.serverTime),
      )
      .sort(
        (a, b) =>
          Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z),
      )[0];
    if (nearDoor) {
      const locked =
        (state.devices[nearDoor.id]?.lockedUntil || 0) > state.serverTime;
      prompt.innerHTML = locked
        ? '<span class="locked">Door locked · try another route</span>'
        : "<kbd>E</kbd> Open door";
    } else prompt.innerHTML = "";
  } else if (prompt) prompt.innerHTML = "";
  const look = document.querySelector("#look-hint");
  if (look)
    look.style.display =
      document.pointerLockElement || state.phase !== "playing" ? "none" : "";
}
function settingsDialog() {
  modal(
    `<h2>Make it yours.</h2><label class="field-label" for="volume">MUSIC VOLUME <span id="volume-number">${Math.round(music.volume * 100)}%</span></label><input id="volume" type="range" min="0" max="100" value="${Math.round(music.volume * 100)}"/><label class="field-label" for="quality">GRAPHICS</label><select id="quality" class="quality-select"><option value="high">High graphics</option><option value="low">Low graphics</option></select><p>WASD to move · mouse to look · E to open doors · F to shove · Space to jump. Tell your controller what you see.</p><button id="help" class="secondary">How to play</button><button id="settings-done" class="primary">Back to game</button>`,
  );
  document.querySelector("#quality").value = quality;
  document.querySelector("#quality").onchange = (e) => {
    quality = e.target.value;
    localStorage.setItem("mr-quality", quality);
  };
  document.querySelector("#volume").oninput = (e) => {
    music.unlock();
    music.setVolume(Number(e.target.value) / 100);
    document.querySelector("#volume-number").textContent = e.target.value + "%";
  };
  button("help", instructions);
  button("settings-done", closeModal);
}
async function activate(id) {
  if (!state || state.phase !== "playing") return;
  const r = await request("action", id);
  if (r.error) toast(r.error);
  else sound(660);
}
function stopInput() {
  keys.clear();
  jump = false;
  shove = false;
  drag = false;
  if (state) socket.emit("input", { x: 0, z: 0, jump: false, shove: false });
}
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input,select,textarea") || modalRoot.innerHTML) return;
  if (
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "Space",
      "KeyE",
      "KeyF",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(e.code)
  ) {
    if (state) e.preventDefault();
    keys.add(e.code);
    if (!e.repeat && e.code === "Space") jump = true;
    if (!e.repeat && e.code === "KeyF") shove = true;
    if (!e.repeat && e.code === "KeyE" && nearDoor)
      request("door", nearDoor.id).then((r) => {
        if (r.error) toast(r.error);
        else sound(330, 0.12);
      });
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", stopInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopInput();
  music.apply();
});
scene.renderer.domElement.addEventListener("pointerdown", (e) => {
  sound(250, 0.02);
  if (!state || state.phase !== "playing" || modalRoot.innerHTML) return;
  if (state.players[slot].role === "controller") {
    const id = scene.pick(e.clientX, e.clientY);
    if (id) activate(id);
  } else {
    drag = true;
    lastPointer = { x: e.clientX, y: e.clientY };
    const result = scene.renderer.domElement.requestPointerLock?.();
    result?.catch(() => {});
  }
});
window.addEventListener("pointerup", () => (drag = false));
window.addEventListener("mousemove", (e) => {
  if (!state || state.players[slot].role !== "runner" || modalRoot.innerHTML)
    return;
  const locked = document.pointerLockElement === scene.renderer.domElement;
  if (!locked && !drag) return;
  const dx = locked ? e.movementX : e.clientX - lastPointer.x,
    dy = locked ? e.movementY : e.clientY - lastPointer.y;
  scene.yaw -= dx * 0.003;
  scene.pitch = Math.max(-1.35, Math.min(1.35, scene.pitch + dy * 0.003));
  lastPointer = { x: e.clientX, y: e.clientY };
});
scene.renderer.domElement.addEventListener(
  "wheel",
  (e) => {
    if (state?.players[slot].role === "controller") {
      e.preventDefault();
      scene.zoom = Math.max(
        0.75,
        Math.min(1.6, scene.zoom + e.deltaY * 0.0006),
      );
    }
  },
  { passive: false },
);
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") closeModal();
});
socket.on("connect", async () => {
  connected = true;
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem("mr-session"));
  } catch {}
  if (saved) {
    toast("Restoring your arena seat…");
    const r = await request("enter", { mode: "resume", ...saved });
    if (r.ok) {
      clearTimeout(toastTimer);
      document.querySelector("#notifications").innerHTML = "";
      roomActive = true;
      slot = r.slot;
      token = r.token;
      lobby = r.lobby;
      if (!lobby.started) {
        state = null;
        renderLobby();
      }
    } else {
      sessionStorage.removeItem("mr-session");
      state = null;
      lobby = null;
      landing();
      toast(r.error);
    }
  }
});
socket.on("disconnect", () => {
  connected = false;
  stopInput();
  toast("Connection lost. Reconnecting to your seat…");
});
socket.on("replaced", () => {
  roomActive = false;
  sessionStorage.removeItem("mr-session");
  state = null;
  lobby = null;
  socket.disconnect();
  landing();
  toast("Your seat was opened in another tab. Reload to join again.");
});
socket.on("lobby", (data) => {
  if (!roomActive || lobby?.code !== data.code) return;
  lobby = data;
  if (!data.started) {
    state = null;
    local = null;
    renderLobby();
  }
});
socket.on("state", (data) => {
  if (!roomActive || !lobby?.started || data.room !== lobby.code) return;
  const changed =
    !state ||
    state.round !== data.round ||
    state.players[slot]?.role !== data.players[slot]?.role;
  if (changed) snapshots.clear();
  snapshots.push(data, performance.now());
  clientWalls = obstacles(data, data.serverTime);
  state = data;
  music.setActive(state.phase !== "finished" && state.phase !== "paused");
  const own = state.players[slot];
  if (changed || !local || Math.hypot(local.x - own.x, local.z - own.z) > 2)
    local = { x: own.x, z: own.z, y: own.y };
  updateHUD();
});
function inputVector() {
  const f =
      Number(keys.has("KeyW") || keys.has("ArrowUp")) -
      Number(keys.has("KeyS") || keys.has("ArrowDown")),
    r =
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
      Number(keys.has("KeyA") || keys.has("ArrowLeft"));
  return {
    x: r * Math.cos(scene.yaw) - f * Math.sin(scene.yaw),
    z: -f * Math.cos(scene.yaw) - r * Math.sin(scene.yaw),
  };
}
function animate(time) {
  const frameTime = (time - lastFrame) / 1000;
  const dt = Math.min(0.05, frameTime);
  visualPoses = snapshots.sample(time);
  lastFrame = time;
  if (state && local) {
    const own = state.players[slot],
      input = inputVector(),
      active = connected && state.phase === "playing" && !modalRoot.innerHTML;
    if (own.role === "runner") {
      if (active && own.stun <= state.serverTime) {
        const n = Math.max(1, Math.hypot(input.x, input.z));
        move(
          local,
          (input.x / n) * 5.4 * dt,
          (input.z / n) * 5.4 * dt,
          clientWalls,
        );
      }
      const correction = 1 - Math.exp(-dt * 8);
      local.x += (own.x - local.x) * correction;
      local.z += (own.z - local.z) * correction;
      local.y += (own.y - local.y) * (1 - Math.exp(-dt * 24));
      if (own.y === 0 && local.y < 0.015) local.y = 0;
      if (time - sendAt > 33) {
        socket.emit("input", {
          x: active ? input.x : 0,
          z: active ? input.z : 0,
          jump: active && jump,
          shove: active && shove,
        });
        jump = false;
        shove = false;
        sendAt = time;
      }
    }
  }
  scene.render(dt, state, slot, local, quality, visualPoses, frameTime);
  positionOverlays();
  requestAnimationFrame(animate);
}
landing();
requestAnimationFrame(animate);
const invite = new URLSearchParams(location.search).get("room");
if (invite && !sessionStorage.getItem("mr-session")) {
  setTimeout(() => {
    joinDialog();
    document.querySelector("#code").value = invite.slice(0, 6);
  }, 150);
}
