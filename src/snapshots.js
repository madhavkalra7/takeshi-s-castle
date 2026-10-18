// Render other players a little behind the server so packets become a smooth
// timeline. Local first-person movement stays on the immediate prediction path.
export class SnapshotBuffer {
  constructor(delay = 0.1) {
    this.delay = delay;
    this.frames = [];
    this.receivedAt = 0;
  }
  clear() {
    this.frames = [];
  }
  push(state, receivedAt) {
    if (this.frames.length && state.serverTime <= this.frames.at(-1).serverTime)
      return;
    if (
      this.frames.length &&
      (state.round !== this.frames.at(-1).round ||
        (state.phase === "countdown" &&
          this.frames.at(-1).phase !== "countdown"))
    )
      this.clear();
    this.frames.push({
      serverTime: state.serverTime,
      round: state.round,
      phase: state.phase,
      players: state.players.map((p) => ({ ...p })),
    });
    if (this.frames.length > 24) this.frames.shift();
    this.receivedAt = receivedAt;
  }
  sample(now) {
    if (!this.frames.length) return null;
    const last = this.frames.at(-1),
      time =
        last.serverTime +
        Math.min(0.15, Math.max(0, (now - this.receivedAt) / 1000)) -
        this.delay;
    let a = this.frames[0],
      b = a;
    for (const frame of this.frames) {
      b = frame;
      if (frame.serverTime >= time) break;
      a = frame;
    }
    const t =
      a === b
        ? 0
        : Math.max(
            0,
            Math.min(1, (time - a.serverTime) / (b.serverTime - a.serverTime)),
          );
    return {
      players: b.players.map((p) => {
        const from = a.players.find((q) => q.slot === p.slot);
        if (
          !from ||
          p.role !== from.role ||
          p.hidden ||
          from.hidden ||
          !Number.isFinite(p.x) ||
          Math.hypot(p.x - from.x, p.z - from.z) > 6
        )
          return { ...p };
        const angle = Math.atan2(
          Math.sin(p.yaw - from.yaw),
          Math.cos(p.yaw - from.yaw),
        );
        return {
          ...p,
          x: from.x + (p.x - from.x) * t,
          z: from.z + (p.z - from.z) * t,
          y: from.y + (p.y - from.y) * t,
          yaw: from.yaw + angle * t,
        };
      }),
    };
  }
}
