import * as THREE from "three";
import { ARENA, CELL, HALF, SIZE } from "../shared/game.js";
export const COLORS = [0x45e0df, 0xff855b];
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
export class ArenaScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0b1423");
    this.scene.fog = new THREE.Fog("#0b1423", 65, 130);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xb9e5ff, 0x38433f, 2.2));
    const sun = new THREE.DirectionalLight(0xffedd8, 3);
    sun.position.set(15, 35, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -27,
      right: 27,
      top: 27,
      bottom: -27,
      near: 1,
      far: 90,
    });
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.warningMaterial = new THREE.MeshBasicMaterial({ color: 0xff6633 });
    this.materials = {
      floor: mat(0xcccfc0),
      wall: mat(0x247d8b),
      cap: mat(0xb5e2d7),
      dark: mat(0x172b3e),
      white: mat(0xf4eee2),
      gold: mat(0xffd365, { metalness: 0.35 }),
      cyan: mat(COLORS[0]),
      orange: mat(COLORS[1]),
    };
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.devices = new Map();
    this.avatars = new Map();
    this.pickables = [];
    this.keys = [];
    this.particles = [];
    this.elapsed = 0;
    this.yaw = 0;
    this.pitch = 0.7;
    this.zoom = 8;
    this.mode = "landing";
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.build();
    this.faded = [];
    this.cameraWalls = [
      ...this.world.children.filter(
        (o) =>
          o.isMesh &&
          o.geometry?.type === "BoxGeometry" &&
          o.position.y >= 1 &&
          o.position.y <= 3,
      ),
    ];
    for (const obj of this.devices.values())
      obj.group.traverse((o) => {
        if (o.isMesh) this.cameraWalls.push(o);
      });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.camera.position.set(37, 32, 40);
    this.camera.lookAt(0, 0, 0);
  }
  box(w, h, d, x, y, z, material, parent = this.world) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  cylinder(r, h, x, y, z, material, parent = this.world) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 16),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  text(text, w = 7, h = 1.3, color = "#edf6ee", bg = "#142b3b") {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 192;
    const c = canvas.getContext("2d");
    c.fillStyle = bg;
    c.fillRect(0, 0, 1024, 192);
    c.fillStyle = color;
    c.font = "900 100px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, 512, 100);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
  }
  build() {
    const m = this.materials;
    this.box(HALF * 2 + 1.8, 1, HALF * 2 + 1.8, 0, -0.6, 0, m.dark);
    const floor = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CELL - 0.04, 0.12, CELL - 0.04),
      mat(0xffffff),
      SIZE * SIZE,
    );
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const i = r * SIZE + c;
        floor.setMatrixAt(
          i,
          new THREE.Matrix4().makeTranslation(
            (c - 4) * CELL,
            -0.06,
            (r - 4) * CELL,
          ),
        );
        floor.setColorAt(i, new THREE.Color((r + c) % 2 ? 0xcbd1c5 : 0xdce0d2));
      }
    floor.receiveShadow = true;
    this.world.add(floor);
    for (const w of ARENA.walls) {
      this.box(w.w, 2.25, w.d, w.x, 1.125, w.z, m.wall);
      this.box(w.w + 0.06, 0.16, w.d + 0.06, w.x, 2.32, w.z, m.cap);
    }
    for (const [x, z, w, d] of [
      [-HALF, 0, 0.4, HALF * 2],
      [HALF, 0, 0.4, HALF * 2],
      [0, HALF, HALF * 2, 0.4],
    ]) {
      this.box(w, 2.6, d, x, 1.3, z, m.dark);
      this.box(w + 0.08, 0.12, d + 0.08, x, 2.66, z, m.cyan);
    }
    for (const x of [-(HALF + 1.7) / 2, (HALF + 1.7) / 2])
      this.box(HALF - 1.7, 2.6, 0.4, x, 1.3, -HALF, m.dark);
    this.box(3.3, 0.14, 2.8, 0, 0.03, -13.7, mat(0x97efae));
    for (const x of [-1.8, 1.8])
      this.box(0.3, 4, 0.4, x, 2, -HALF + 0.2, m.gold);
    this.box(4, 0.45, 0.5, 0, 4, -HALF + 0.2, m.gold);
    const exit = this.text("EXIT", 3, 0.65, "#142b3b", "#ffda71");
    exit.position.set(0, 4, -HALF + 0.5);
    this.world.add(exit);
    ARENA.spawns.forEach((p, i) => {
      this.box(2.6, 0.08, 2.6, p.x, 0.05, p.z, mat(COLORS[i]));
      const label = this.text(
        i ? "EMBER" : "TIDAL",
        2.4,
        0.45,
        i ? "#ff855b" : "#45e0df",
      );
      label.rotation.x = -Math.PI / 2;
      label.position.set(p.x, 0.1, p.z + 0.8);
      this.world.add(label);
    });
    for (const r of ARENA.rotators) {
      const group = new THREE.Group();
      group.position.set(r.x, 0, r.z);
      this.world.add(group);
      this.cylinder(0.4, 0.2, 0, 0.12, 0, m.gold, group);
      this.box(r.length, 2, 0.3, 0, 1.15, 0, m.orange, group);
      this.box(r.length + 0.08, 0.13, 0.4, 0, 2.2, 0, m.gold, group);
      this.cylinder(0.17, 2.8, 0, 1.4, 0, m.dark, group);
      const beacon = this.cylinder(0.26, 0.15, 0, 2.85, 0, m.gold, group);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r.length / 2, 0.025, 6, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffd365,
          transparent: true,
          opacity: 0.4,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      group.add(ring);
      this.devices.set(r.id, { group, beacon, type: r.type });
      group.traverse((o) => {
        if (o.isMesh) {
          o.userData.device = r.id;
          this.pickables.push(o);
        }
      });
    }
    for (const g of ARENA.gates) {
      const group = new THREE.Group();
      group.position.set(g.x, 0, g.z);
      this.world.add(group);
      const alongX = g.w > g.d;
      for (const sign of [-1, 1])
        this.box(
          0.3,
          2.85,
          0.3,
          alongX ? (sign * CELL) / 2 : 0,
          1.425,
          alongX ? 0 : (sign * CELL) / 2,
          m.dark,
          group,
        );
      const panel = this.box(
        g.w,
        2.5,
        g.d,
        0,
        -1.4,
        0,
        mat(0xffd365, { transparent: true, opacity: 0.85 }),
        group,
      );
      this.box(g.w + 0.15, 0.15, g.d + 0.15, 0, 0.08, 0, m.gold, group);
      this.devices.set(g.id, { group, panel, type: g.type });
      group.traverse((o) => {
        if (o.isMesh) {
          o.userData.device = g.id;
          this.pickables.push(o);
        }
      });
    }
    for (const b of ARENA.bumpers) {
      const group = new THREE.Group();
      group.position.set(b.x, 0, b.z);
      this.world.add(group);
      this.cylinder(1.05, 0.12, 0, 0.1, 0, m.dark, group);
      const head = this.box(2.1, 0.5, 0.38, 0, 0.45, 0, m.orange, group);
      this.cylinder(0.2, 0.75, 0, 0.45, 0, m.gold, group);
      this.devices.set(b.id, { group, head, type: b.type });
      group.traverse((o) => {
        if (o.isMesh) {
          o.userData.device = b.id;
          this.pickables.push(o);
        }
      });
    }
    ARENA.keys.forEach((p, i) => {
      const group = new THREE.Group();
      group.position.set(p.x, 1.2, p.z);
      const material = mat(COLORS[i], {
        emissive: COLORS[i],
        emissiveIntensity: 0.5,
        metalness: 0.5,
      });
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.11, 8, 20),
        material,
      );
      group.add(ring);
      this.box(0.14, 0.8, 0.15, 0, -0.55, 0, material, group);
      this.box(0.32, 0.12, 0.15, 0.1, -0.85, 0, material, group);
      this.world.add(group);
      this.keys.push(group);
      this.cylinder(
        0.75,
        0.05,
        p.x,
        0.08,
        p.z,
        mat(COLORS[i], { transparent: true, opacity: 0.35 }),
      );
    });
    // Stadium seating, edge lights and floodlights create a game-show setting without external assets.
    const seats = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.85, 0.35, 0.7),
      mat(0xffffff),
      384,
    );
    let seatIndex = 0;
    for (let side = 0; side < 4; side++) {
      const stand = new THREE.Group();
      stand.rotation.y = (side * Math.PI) / 2;
      this.world.add(stand);
      for (let row = 0; row < 4; row++) {
        this.box(
          37,
          0.65,
          1.4,
          0,
          row * 0.7 - 0.3,
          19 + row * 1.5,
          m.dark,
          stand,
        );
        for (let seat = 0; seat < 24; seat++) {
          const q = new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              (side * Math.PI) / 2,
            ),
            v = new THREE.Vector3(
              (seat - 11.5) * 1.4,
              row * 0.7 + 0.18,
              19 + row * 1.5,
            ).applyQuaternion(q);
          seats.setMatrixAt(
            seatIndex,
            new THREE.Matrix4().compose(v, q, new THREE.Vector3(1, 1, 1)),
          );
          seats.setColorAt(
            seatIndex++,
            new THREE.Color(
              (seat + row) % 4 ? 0x29475a : side % 2 ? 0xb96045 : 0x378d92,
            ),
          );
        }
      }
      this.box(35, 0.13, 0.13, 0, 3, 24, side % 2 ? m.orange : m.cyan, stand);
    }
    seats.receiveShadow = true;
    this.world.add(seats);
    for (const x of [-22, 22])
      for (const z of [-22, 22]) {
        this.box(0.35, 13, 0.35, x, 6.5, z, m.dark);
        const bank = this.box(3, 0.8, 0.5, x, 12.5, z, m.white);
        bank.rotation.y = x * z > 0 ? -0.7 : 0.7;
        for (let i = 0; i < 4; i++)
          this.box(
            0.4,
            0.3,
            0.1,
            x + (i - 1.5) * 0.6,
            12.5,
            z + 0.3,
            new THREE.MeshBasicMaterial({ color: 0xfff3da }),
          );
      }
    const board = this.text("MAZE / RIOT", 13, 2.4, "#ffdc80");
    board.position.set(0, 8, -23);
    this.world.add(board);
    const sub = this.text("CONTROL THE CHAOS", 10, 1, "#45e0df");
    sub.position.set(0, 6, -23);
    this.world.add(sub);
    const ground = this.box(200, 0.3, 200, 0, -1.7, 0, mat(0x0c1928));
    ground.castShadow = false;
    // Low-cost scattered stadium lights.
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2,
        r = 32 + Math.sin(i * 12) * 3;
      this.box(
        0.08,
        0.08,
        0.08,
        Math.cos(a) * r,
        2 + Math.sin(i * 4) * 2,
        Math.sin(a) * r,
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffcb76 : 0x6ce8ed }),
      );
    }
  }
  avatar(team) {
    const g = new THREE.Group(),
      m = this.materials,
      color = mat(COLORS[team]);
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.45, 4, 10),
      color,
    );
    torso.position.y = 0.86;
    g.add(torso);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 12),
      m.white,
    );
    head.position.y = 1.51;
    g.add(head);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      color,
    );
    helmet.position.y = 1.53;
    g.add(helmet);
    const visor = this.box(0.43, 0.13, 0.12, 0, 1.51, 0.27, m.dark, g);
    visor.rotation.x = -0.1;
    const limbs = [];
    for (const x of [-0.19, 0.19]) {
      const leg = this.box(0.21, 0.45, 0.24, x, 0.28, 0, m.dark, g);
      limbs.push(leg);
      this.box(0.25, 0.15, 0.36, x, 0.08, 0.07, m.white, g);
    }
    for (const x of [-0.43, 0.43]) {
      const arm = this.box(0.19, 0.55, 0.21, x, 0.91, 0, color, g);
      limbs.push(arm);
    }
    g.userData.limbs = limbs;
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.world.add(g);
    return g;
  }
  resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
  setMode(mode) {
    if (this.mode !== mode) {
      this.mode = mode;
      this.cameraReady = false;
    }
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.container.clientWidth,
      y: (-0.5 * v.y + 0.5) * this.container.clientHeight,
      visible: v.z < 1 && v.z > -1,
    };
  }
  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - r.left) / r.width) * 2 - 1,
      (-(clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.pickables, false)[0]?.object
      .userData.device;
  }
  render(dt, state, slot, local, quality) {
    this.elapsed += dt;
    const t = this.elapsed,
      own = state?.players[slot],
      time = state?.serverTime || 0;
    if (!state) {
      for (const mesh of this.faded)
        mesh.material = mesh.userData.originalMaterial;
      this.faded = [];
      this.setMode("landing");
      const pos = new THREE.Vector3(36 + Math.sin(t * 0.06) * 3, 32, 39);
      this.camera.position.lerp(pos, 0.03);
      this.camera.lookAt(0, 0, -1);
      for (let i = 0; i < 2; i++) {
        if (!this.avatars.has(i)) this.avatars.set(i, this.avatar(i));
        const a = this.avatars.get(i);
        a.visible = true;
        a.position.set(ARENA.spawns[i].x, 0, ARENA.spawns[i].z);
      }
    } else {
      this.setMode(own.role);
      for (const [id, a] of this.avatars) {
        a.visible = false;
      }
      for (const p of state.players.filter((p) => p.role === "runner")) {
        let a = this.avatars.get(p.slot + 10);
        if (!a) {
          a = this.avatar(p.team);
          this.avatars.set(p.slot + 10, a);
        }
        a.visible = !p.hidden;
        if (p.hidden) continue;
        const target = p.slot === slot && local ? local : p;
        const desired = new THREE.Vector3(target.x, target.y || 0, target.z);
        if (a.position.distanceTo(desired) > 5) a.position.copy(desired);
        else a.position.lerp(desired, 1 - Math.exp(-dt * 18));
        const diff = Math.atan2(
          Math.sin(p.yaw - a.rotation.y),
          Math.cos(p.yaw - a.rotation.y),
        );
        a.rotation.y += diff * Math.min(1, dt * 16);
        a.rotation.z = p.stun > time ? Math.sin(t * 25) * 0.35 : 0;
        const speed = a.userData.last
          ? a.position.distanceTo(a.userData.last) / Math.max(dt, 0.001)
          : 0;
        a.userData.last = a.position.clone();
        a.userData.limbs.forEach(
          (l, i) =>
            (l.rotation.x =
              speed > 0.4 ? Math.sin(t * 13 + (i % 2) * Math.PI) * 0.55 : 0),
        );
      }
      if (own.role === "runner") {
        const p = local || own,
          focus = new THREE.Vector3(p.x, 1.15 + (p.y || 0) * 0.4, p.z);
        const desired = focus
          .clone()
          .add(
            new THREE.Vector3(
              Math.sin(this.yaw) * this.zoom,
              Math.sin(this.pitch) * this.zoom + 1.1,
              Math.cos(this.yaw) * this.zoom,
            ),
          );
        // Keep a stable third-person distance. Fade occluding walls rather than
        // pushing the camera into the character in a narrow corridor.
        for (const mesh of this.faded) {
          mesh.material = mesh.userData.originalMaterial;
        }
        this.faded = [];
        const dir = desired.clone().sub(focus),
          distance = dir.length();
        this.raycaster.set(focus, dir.normalize());
        for (const hit of this.raycaster.intersectObjects(
          this.cameraWalls,
          false,
        )) {
          if (hit.distance > distance) continue;
          const mesh = hit.object;
          if (!mesh.userData.fadeMaterial) {
            mesh.userData.originalMaterial = mesh.material;
            mesh.userData.fadeMaterial = mesh.material.clone();
            mesh.userData.fadeMaterial.transparent = true;
            mesh.userData.fadeMaterial.opacity = 0.13;
            mesh.userData.fadeMaterial.depthWrite = false;
          }
          mesh.material = mesh.userData.fadeMaterial;
          this.faded.push(mesh);
        }
        if (!this.cameraReady) this.camera.position.copy(desired);
        else this.camera.position.lerp(desired, 1 - Math.exp(-dt * 12));
        this.camera.lookAt(focus);
        this.cameraReady = true;
      } else {
        for (const mesh of this.faded)
          mesh.material = mesh.userData.originalMaterial;
        this.faded = [];
        const desired = new THREE.Vector3(
          0,
          Math.max(39, 35 / this.camera.aspect),
          18,
        );
        this.camera.position.lerp(
          desired,
          this.cameraReady ? 1 - Math.exp(-dt * 6) : 1,
        );
        this.camera.lookAt(0, 0, 0);
        this.cameraReady = true;
      }
    }
    for (const r of ARENA.rotators) {
      const obj = this.devices.get(r.id),
        s = state?.devices[r.id] || {},
        angle = s.orientation ? Math.PI / 2 : 0;
      obj.group.rotation.y +=
        (angle - obj.group.rotation.y) * Math.min(1, dt * 12);
      obj.beacon.material =
        s.warning > time ? this.warningMaterial : this.materials.gold;
    }
    for (const g of ARENA.gates) {
      const obj = this.devices.get(g.id),
        s = state?.devices[g.id] || {},
        target = s.until > time ? 1.3 : -1.4;
      obj.panel.position.y +=
        (target - obj.panel.position.y) * Math.min(1, dt * 18);
    }
    for (const b of ARENA.bumpers) {
      const obj = this.devices.get(b.id),
        s = state?.devices[b.id] || {};
      obj.head.rotation.y = s.until > time ? t * 16 : Math.sin(t) * 0.1;
    }
    this.keys.forEach((k, i) => {
      k.rotation.y = t * 1.4;
      k.position.y = 1.25 + Math.sin(t * 2 + i) * 0.18;
      k.visible = !state?.players.some(
        (p) => p.team === i && p.role === "runner" && p.key,
      );
    });
    if (quality === "low" && this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = false;
      this.renderer.setPixelRatio(1);
      this.resize();
    }
    if (quality === "high" && !this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
      this.resize();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
