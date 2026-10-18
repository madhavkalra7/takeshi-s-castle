// Original procedural soundtrack. No external audio downloads or autoplay hacks.
export class Music {
  constructor() {
    this.context = null;
    this.active = false;
    this.muted = localStorage.getItem("mr-mute") === "true";
    const saved = Number(localStorage.getItem("mr-volume") ?? 35);
    this.volume = Number.isFinite(saved)
      ? Math.max(0, Math.min(1, saved / 100))
      : 0.35;
    this.step = 0;
    this.next = 0;
  }
  unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.ratio.value = 4;
        this.master.connect(compressor);
        compressor.connect(this.context.destination);
        this.noise = this.context.createBuffer(
          1,
          this.context.sampleRate * 0.12,
          this.context.sampleRate,
        );
        const channel = this.noise.getChannelData(0);
        for (let i = 0; i < channel.length; i++)
          channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
        this.timer = setInterval(() => this.schedule(), 80);
      }
      if (this.context.state === "suspended") this.context.resume();
      this.apply();
    } catch {}
  }
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    if (this.context) {
      this.next = this.context.currentTime + 0.08;
      this.apply();
    }
  }
  setMuted(muted) {
    this.muted = muted;
    this.apply();
  }
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    localStorage.setItem("mr-volume", String(Math.round(this.volume * 100)));
    this.apply();
  }
  apply() {
    if (this.context)
      this.master.gain.setTargetAtTime(
        this.active && !this.muted && !document.hidden ? this.volume * 0.6 : 0,
        this.context.currentTime,
        0.2,
      );
  }
  tone(midi, time, duration, level, type = "sine", cutoff = 1600) {
    const c = this.context,
      osc = c.createOscillator(),
      gain = c.createGain(),
      filter = c.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, level),
      time + 0.015,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }
  schedule() {
    if (
      !this.context ||
      !this.active ||
      this.context.state !== "running" ||
      this.muted ||
      document.hidden
    )
      return;
    const c = this.context,
      sixteenth = 60 / 108 / 4;
    if (this.next < c.currentTime) this.next = c.currentTime + 0.04;
    while (this.next < c.currentTime + 0.15) {
      const step = this.step % 128,
        bar = Math.floor(step / 16),
        beat = step % 16,
        roots = [38, 38, 34, 34, 41, 41, 36, 36],
        root = roots[bar],
        t = this.next;
      if (beat === 0) {
        for (const n of [root + 12, root + 15, root + 19])
          this.tone(n, t, 2, 0.055, "triangle", 750);
      }
      if (beat % 4 === 0) {
        this.tone(root, t, 0.24, 0.16, "triangle", 500);
        const kick = c.createOscillator(),
          g = c.createGain();
        kick.frequency.setValueAtTime(115, t);
        kick.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
        kick.connect(g);
        g.connect(this.master);
        kick.start(t);
        kick.stop(t + 0.18);
      }
      if (beat % 2 === 0) {
        const n = c.createBufferSource(),
          f = c.createBiquadFilter(),
          g = c.createGain();
        n.buffer = this.noise;
        f.type = "highpass";
        f.frequency.value = 6500;
        g.gain.setValueAtTime(beat % 4 === 2 ? 0.045 : 0.025, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
        n.connect(f);
        f.connect(g);
        g.connect(this.master);
        n.start(t);
        n.stop(t + 0.06);
      }
      if (beat % 2 === 1) {
        const arp = [24, 31, 27, 34, 24, 27, 31, 22];
        this.tone(
          root + arp[Math.floor(beat / 2)],
          t,
          0.22,
          0.045,
          "sine",
          2400,
        );
      }
      this.step++;
      this.next += sixteenth;
    }
  }
}
