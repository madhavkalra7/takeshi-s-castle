export const CELL = 4.4,
  SIZE = 11,
  HALF = (CELL * SIZE) / 2,
  RADIUS = 0.38,
  MID = (SIZE - 1) / 2;
export const ROUND_SECONDS = 180;
export const TEAM_NAMES = ["TIDAL", "EMBER"];
export const COST = { rotate: 30, gate: 35, bumper: 40, door: 18 };
export const COOLDOWN = { rotate: 5, gate: 7, bumper: 6, door: 5 };
export const center = (row, col) => ({
  x: (col - MID) * CELL,
  z: (row - MID) * CELL,
});
const edgeKey = (a, b) => [a, b].sort((x, y) => x - y).join("-");
export const roleFor = (slot, round = 1) =>
  slot % 2 === (round - 1) % 2 ? "runner" : "controller";
export const teamFor = (slot) => Math.floor(slot / 2);
export function createArena() {
  let seed = 74;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const passages = new Set(),
    seen = new Set([0]),
    stack = [0];
  while (stack.length) {
    const a = stack.at(-1),
      r = Math.floor(a / SIZE),
      c = a % SIZE;
    const next = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]
      .filter(([r, c]) => r >= 0 && r < SIZE && c >= 0 && c <= MID)
      .map(([r, c]) => r * SIZE + c)
      .filter((b) => !seen.has(b));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const b = next[Math.floor(random() * next.length)];
    passages.add(edgeKey(a, b));
    seen.add(b);
    stack.push(b);
  }
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c <= MID; c++)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ])
        if (r + dr < SIZE && c + dc <= MID && random() < 0.07)
          passages.add(edgeKey(r * SIZE + c, (r + dr) * SIZE + c + dc));
  const pivots = [
    [3, 3],
    [3, SIZE - 3],
    [SIZE - 3, 3],
    [SIZE - 3, SIZE - 3],
  ];
  for (const [r, c] of pivots)
    for (const [a, b] of [
      [
        [r - 1, c - 1],
        [r - 1, c],
      ],
      [
        [r, c - 1],
        [r, c],
      ],
      [
        [r - 1, c - 1],
        [r, c - 1],
      ],
      [
        [r - 1, c],
        [r, c],
      ],
    ])
      passages.add(edgeKey(a[0] * SIZE + a[1], b[0] * SIZE + b[1]));
  const mirror = (n) => Math.floor(n / SIZE) * SIZE + SIZE - 1 - (n % SIZE);
  for (const edge of [...passages]) {
    const [a, b] = edge.split("-").map(Number);
    passages.add(edgeKey(mirror(a), mirror(b)));
  }
  const walls = [],
    candidates = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        if (r + dr >= SIZE || c + dc >= SIZE) continue;
        const a = center(r, c),
          b = center(r + dr, c + dc),
          wall = {
            x: (a.x + b.x) / 2,
            z: (a.z + b.z) / 2,
            w: dc ? 0.26 : CELL + 0.26,
            d: dr ? 0.26 : CELL + 0.26,
            height: 3.2,
          };
        if (!passages.has(edgeKey(r * SIZE + c, (r + dr) * SIZE + c + dc)))
          walls.push(wall);
        else if (
          !pivots.some(
            ([pr, pc]) =>
              Math.hypot(
                wall.x - (pc - MID - 0.5) * CELL,
                wall.z - (pr - MID - 0.5) * CELL,
              ) <
              CELL * 1.05,
          )
        )
          candidates.push(wall);
      }
  const left = candidates.filter((w) => w.x < -0.2),
    bases = [
      left[Math.floor(left.length * 0.3)],
      left[Math.floor(left.length * 0.7)],
    ];
  const gates = bases
    .flatMap((w) => [w, { ...w, x: -w.x }])
    .map((w, i) => ({ ...w, id: `g${i}`, type: "gate" }));
  const doors = candidates
    .filter((w) => !gates.some((g) => g.x === w.x && g.z === w.z))
    .map((w, i) => {
      const alongX = w.w > w.d,
        opening = 1.7,
        flank = (CELL - opening) / 2;
      for (const sign of [-1, 1])
        walls.push({
          x: w.x + (alongX ? sign * (opening / 2 + flank / 2) : 0),
          z: w.z + (alongX ? 0 : sign * (opening / 2 + flank / 2)),
          w: alongX ? flank : 0.26,
          d: alongX ? 0.26 : flank,
          height: 3.2,
        });
      return {
        ...w,
        w: alongX ? opening : 0.22,
        d: alongX ? 0.22 : opening,
        id: `d${i}`,
        type: "door",
        height: 2.7,
      };
    });
  const rotators = pivots.map(([r, c], i) => ({
    id: `r${i}`,
    type: "rotate",
    x: (c - MID - 0.5) * CELL,
    z: (r - MID - 0.5) * CELL,
    length: CELL * 0.75,
  }));
  const bumpers = [
    [MID, MID],
    [MID, 1],
    [MID, SIZE - 2],
  ].map(([r, c], i) => ({ ...center(r, c), id: `b${i}`, type: "bumper" }));
  return {
    walls,
    doors,
    gates,
    rotators,
    bumpers,
    keys: [center(0, 1), center(0, SIZE - 2)],
    exit: center(0, MID),
    spawns: [center(SIZE - 1, 1), center(SIZE - 1, SIZE - 2)],
  };
}
export const ARENA = createArena();
export function doorIsOpen(game, id, now) {
  const s = game.devices[id] || {};
  return (s.openUntil || 0) > now && (s.lockedUntil || 0) <= now;
}
export function openDoor(game, slot, id, now) {
  const p = game.players[slot],
    d = ARENA.doors.find((d) => d.id === id);
  if (game.phase !== "playing" || !p || p.role !== "runner")
    return "Only runners can open nearby doors.";
  if (!d || Math.hypot(p.x - d.x, p.z - d.z) > 2.4)
    return "Move closer to the door.";
  const s = game.devices[id] || {};
  if ((s.lockedUntil || 0) > now)
    return "Door locked. Wait a moment or find another route.";
  game.devices[id] = { ...s, openUntil: now + 5.5 };
  return null;
}
export function obstacles(game, now) {
  return [
    ...ARENA.walls,
    ...ARENA.doors
      .filter((d) => !doorIsOpen(game, d.id, now))
      .map((d) => ({ ...d, doorId: d.id })),
    ...ARENA.gates
      .filter((g) => (game.devices[g.id]?.until || 0) > now)
      .map((g) => ({ ...g })),
    ...ARENA.rotators.map((r) => ({
      ...r,
      w: game.devices[r.id]?.orientation ? 0.26 : r.length,
      d: game.devices[r.id]?.orientation ? r.length : 0.26,
      height: 2.4,
    })),
  ];
}
export function intersects(x, z, wall, r = RADIUS) {
  const dx =
    x - Math.max(wall.x - wall.w / 2, Math.min(x, wall.x + wall.w / 2));
  const dz =
    z - Math.max(wall.z - wall.d / 2, Math.min(z, wall.z + wall.d / 2));
  return dx * dx + dz * dz < r * r;
}
export function isFree(x, z, walls, r = RADIUS) {
  return (
    Math.abs(x) <= HALF - r &&
    Math.abs(z) <= HALF - r &&
    !walls.some((w) => intersects(x, z, w, r))
  );
}
export function move(p, dx, dz, walls) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
  for (let i = 0; i < steps; i++) {
    const x = p.x + dx / steps,
      z = p.z + dz / steps;
    if (isFree(x, p.z, walls)) p.x = x;
    if (isFree(p.x, z, walls)) p.z = z;
  }
}
export function createGame(members, now = 0) {
  const game = {
    phase: "countdown",
    phaseUntil: now + 3,
    round: 1,
    scores: [0, 0],
    energy: [100, 100],
    players: [],
    devices: {},
    events: [],
    lastEvent: 0,
    winner: null,
    roundWinner: null,
    remaining: ROUND_SECONDS,
  };
  resetRound(game, members, now);
  return game;
}
function resetRound(game, members, now) {
  game.players = members.map((m, slot) => {
    const team = teamFor(slot),
      pos = ARENA.spawns[team];
    return {
      slot,
      team,
      role: roleFor(slot, game.round),
      name: m.name,
      bot: !!m.bot,
      ...pos,
      y: 0,
      vy: 0,
      vx: 0,
      vz: 0,
      yaw: 0,
      key: false,
      stun: 0,
      shoveAt: 0,
      input: { x: 0, z: 0, jump: false, shove: false },
    };
  });
  game.energy = [100, 100];
  game.devices = {};
  game.pending = [];
  game.phase = "countdown";
  game.phaseUntil = now + 3;
  game.remaining = ROUND_SECONDS;
  game.roundWinner = null;
  emit(
    game,
    `Round ${game.round} · roles ${game.round === 1 ? "assigned" : "swapped"}`,
    now,
  );
}
function emit(game, text, now) {
  game.events.push({ id: ++game.lastEvent, text, at: now });
  game.events = game.events.slice(-6);
}
export function action(game, slot, id, now) {
  const p = game.players[slot];
  if (game.phase !== "playing" || !p || p.role !== "controller")
    return "Only controllers can operate a live arena.";
  const dev = [
    ...ARENA.rotators,
    ...ARENA.gates,
    ...ARENA.bumpers,
    ...ARENA.doors,
  ].find((d) => d.id === id);
  if (!dev) return "Unknown device.";
  const state = game.devices[id] || {};
  if ((state.cooldown || 0) > now) return "That device is recharging.";
  if (game.energy[p.team] < COST[dev.type]) return "Not enough energy.";
  if (game.pending.some((a) => a.id === id))
    return "Device already activating.";
  game.energy[p.team] -= COST[dev.type];
  game.devices[id] = {
    ...state,
    cooldown: now + COOLDOWN[dev.type],
    warning: now + 0.75,
    team: p.team,
  };
  game.pending.push({ id, at: now + 0.75, team: p.team });
  emit(
    game,
    `${TEAM_NAMES[p.team]} armed ${dev.type === "rotate" ? "a rotating wall" : dev.type === "gate" ? "a gate" : dev.type === "door" ? "a door lock" : "a bumper"}`,
    now,
  );
  return null;
}
function finishRound(game, team, now) {
  game.roundWinner = team;
  if (team !== null) game.scores[team]++;
  game.phase = "roundOver";
  game.phaseUntil = now + 5;
  emit(
    game,
    team === null ? "Time up · round drawn" : `${TEAM_NAMES[team]} escaped!`,
    now,
  );
}
export function tick(game, dt, now, members) {
  if (game.phase === "paused" || game.phase === "finished") return;
  if (game.phase === "countdown") {
    if (now >= game.phaseUntil) {
      game.phase = "playing";
      game.deadline = now + ROUND_SECONDS;
      emit(game, "GO! Find your key, then the exit.", now);
    }
    return;
  }
  if (game.phase === "roundOver") {
    if (now >= game.phaseUntil) {
      if (game.scores.some((s) => s >= 3)) {
        game.phase = "finished";
        game.winner = game.scores[0] >= 3 ? 0 : 1;
        emit(game, `${TEAM_NAMES[game.winner]} wins the match`, now);
      } else {
        game.round++;
        resetRound(game, members, now);
      }
    }
    return;
  }
  game.remaining = Math.max(0, game.deadline - now);
  game.energy = game.energy.map((e) => Math.min(100, e + dt * 9));
  for (const pending of game.pending.filter((a) => a.at <= now)) {
    const dev = [
        ...ARENA.rotators,
        ...ARENA.gates,
        ...ARENA.bumpers,
        ...ARENA.doors,
      ].find((d) => d.id === pending.id),
      s = game.devices[dev.id];
    if (dev.type === "rotate") {
      // A rotation cannot sweep through or entomb a runner.
      const occupied = game.players.some(
        (p) =>
          p.role === "runner" &&
          Math.hypot(p.x - dev.x, p.z - dev.z) < dev.length / 2 + 0.55,
      );
      if (occupied) {
        game.energy[pending.team] = Math.min(
          100,
          game.energy[pending.team] + COST.rotate,
        );
        emit(
          game,
          "Rotation blocked · runner in safety zone · energy refunded",
          now,
        );
      } else s.orientation = s.orientation ? 0 : 1;
    } else if (dev.type === "gate" || dev.type === "door") {
      if (
        game.players.some(
          (p) =>
            p.role === "runner" && intersects(p.x, p.z, dev, RADIUS + 0.12),
        )
      ) {
        game.energy[pending.team] = Math.min(
          100,
          game.energy[pending.team] + COST[dev.type],
        );
        emit(game, "Gate blocked · energy refunded", now);
      } else if (dev.type === "door") {
        s.lockedUntil = now + 3;
        s.openUntil = 0;
      } else s.until = now + 3;
    } else s.until = now + 1.2;
    s.warning = 0;
  }
  game.pending = game.pending.filter((a) => a.at > now);
  for (const d of ARENA.doors) {
    const s = game.devices[d.id];
    if (
      s &&
      (s.openUntil || 0) > 0 &&
      (s.lockedUntil || 0) <= now &&
      game.players.some(
        (p) => p.role === "runner" && intersects(p.x, p.z, d, RADIUS + 0.14),
      )
    )
      s.openUntil = Math.max(s.openUntil, now + 0.25);
  }
  for (const p of game.players.filter((p) => p.bot && p.role === "runner"))
    for (const d of ARENA.doors)
      if (
        Math.hypot(p.x - d.x, p.z - d.z) < 2.3 &&
        !doorIsOpen(game, d.id, now)
      )
        openDoor(game, p.slot, d.id, now);
  const walls = obstacles(game, now),
    runners = game.players.filter((p) => p.role === "runner");
  for (const p of runners) {
    if (p.bot) p.input = botInput(p, game, walls, now);
    const input = p.input,
      len = Math.hypot(input.x, input.z),
      factor = len > 1 ? 1 / len : 1;
    if (p.stun <= now) {
      move(p, input.x * factor * 5.4 * dt, input.z * factor * 5.4 * dt, walls);
      if (len > 0.1) p.yaw = Math.atan2(input.x, input.z);
      if (input.jump && p.y === 0) {
        p.vy = 7.4;
      }
      if (input.shove && now >= p.shoveAt) {
        p.shoveAt = now + 2.5;
        for (const other of runners)
          if (other !== p && Math.hypot(other.x - p.x, other.z - p.z) < 1.65) {
            const d = Math.hypot(other.x - p.x, other.z - p.z) || 1;
            other.vx = ((other.x - p.x) / d) * 8;
            other.vz = ((other.z - p.z) / d) * 8;
            other.stun = now + 0.3;
          }
      }
    }
    input.jump = false;
    input.shove = false;
    move(p, p.vx * dt, p.vz * dt, walls);
    p.vx *= Math.exp(-7 * dt);
    p.vz *= Math.exp(-7 * dt);
    if (p.y > 0 || p.vy > 0) {
      p.vy -= 18 * dt;
      p.y = Math.max(0, p.y + p.vy * dt);
      if (p.y === 0) p.vy = 0;
    }
    for (const b of ARENA.bumpers)
      if (
        (game.devices[b.id]?.until || 0) > now &&
        p.y < 0.9 &&
        Math.hypot(p.x - b.x, p.z - b.z) < 1.8 &&
        p.stun <= now
      ) {
        const d = Math.hypot(p.x - b.x, p.z - b.z) || 1;
        p.vx = ((p.x - b.x || 1) / d) * 11;
        p.vz = ((p.z - b.z) / d) * 11;
        p.vy = 5;
        p.stun = now + 0.55;
      }
    if (
      !p.key &&
      Math.hypot(p.x - ARENA.keys[p.team].x, p.z - ARENA.keys[p.team].z) < 0.95
    ) {
      p.key = true;
      emit(game, `${TEAM_NAMES[p.team]} found their key · head to EXIT`, now);
    }
  }
  // Both runners can finish on the same simulation frame: award a draw.
  const finishers = runners.filter(
    (p) => p.key && Math.hypot(p.x - ARENA.exit.x, p.z - ARENA.exit.z) < 1.05,
  );
  if (finishers.length)
    finishRound(game, finishers.length > 1 ? null : finishers[0].team, now);
  else if (game.remaining <= 0) finishRound(game, null, now);
  for (const p of game.players.filter((p) => p.bot && p.role === "controller"))
    if ((p.nextAction || 0) < now) {
      const ids = [
        ...ARENA.rotators,
        ...ARENA.gates,
        ...ARENA.bumpers,
        ...ARENA.doors,
      ].map((d) => d.id);
      action(
        game,
        p.slot,
        ids[(game.round * 11 + Math.floor(now * 7) + p.slot) % ids.length],
        now,
      );
      p.nextAction = now + 3;
    }
}
export function findPath(from, target, walls) {
  walls = walls.filter((w) => !w.doorId);
  const index = (p) =>
    Math.max(0, Math.min(SIZE - 1, Math.round(p.z / CELL + MID))) * SIZE +
    Math.max(0, Math.min(SIZE - 1, Math.round(p.x / CELL + MID)));
  const start = index(from),
    goal = index(target),
    q = [start],
    prev = new Map([[start, null]]);
  for (let qi = 0; qi < q.length; qi++) {
    const a = q[qi];
    if (a === goal) break;
    const r = Math.floor(a / SIZE),
      c = a % SIZE,
      A = center(r, c);
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]) {
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const b = nr * SIZE + nc;
      if (prev.has(b)) continue;
      const B = center(nr, nc);
      if (
        [0.15, 0.3, 0.5, 0.7, 0.85].some(
          (t) => !isFree(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t, walls),
        )
      )
        continue;
      prev.set(b, a);
      q.push(b);
    }
  }
  if (!prev.has(goal)) return [];
  const path = [];
  for (let p = goal; p !== null; p = prev.get(p))
    path.push(center(Math.floor(p / SIZE), p % SIZE));
  return path.reverse();
}
function botInput(p, game, walls, now) {
  walls = walls.filter((w) => !w.doorId);
  const target = p.key ? ARENA.exit : ARENA.keys[p.team];
  const changed = p.pathKey !== p.key;
  const blocked =
    p.path?.length &&
    [0.25, 0.5, 0.75, 1].some(
      (t) =>
        !isFree(
          p.x + (p.path[0].x - p.x) * t,
          p.z + (p.path[0].z - p.z) * t,
          walls,
        ),
    );
  // Keep a waypoint until it is reached. Periodically routing to the nearest
  // cell centre makes a runner turn back halfway through a corridor.
  if (!p.path?.length || changed || (blocked && now > (p.repath || 0))) {
    p.path = findPath(p, target, walls);
    p.repath = now + 0.8;
    p.pathKey = p.key;
    if (
      p.path.length > 1 &&
      Math.hypot(p.x - p.path[0].x, p.z - p.path[0].z) < 0.3
    )
      p.path.shift();
  }
  while (
    p.path.length > 1 &&
    Math.hypot(p.x - p.path[0].x, p.z - p.path[0].z) < 0.18
  )
    p.path.shift();
  const dest = p.path[0] || target,
    dx = dest.x - p.x,
    dz = dest.z - p.z,
    d = Math.hypot(dx, dz);
  return {
    x: d > 0.08 ? (dx / d) * Math.min(0.78, d * 6) : 0,
    z: d > 0.08 ? (dz / d) * Math.min(0.78, d * 6) : 0,
    jump: false,
    shove: false,
  };
}
export function publicGame(game, slot, now) {
  return {
    phase: game.phase,
    phaseUntil: game.phaseUntil,
    round: game.round,
    scores: game.scores,
    energy: game.energy,
    devices: game.devices,
    events: game.events,
    remaining: game.remaining,
    winner: game.winner,
    roundWinner: game.roundWinner,
    serverTime: now,
    players: game.players.map((p) => {
      return {
        slot: p.slot,
        team: p.team,
        role: p.role,
        name: p.name,
        bot: p.bot,
        hidden: false,
        x: p.x,
        z: p.z,
        y: p.y,
        yaw: p.yaw,
        key: p.key,
        stun: p.stun,
        shoveAt: p.shoveAt,
      };
    }),
  };
}
