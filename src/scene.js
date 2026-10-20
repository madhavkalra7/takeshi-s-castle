import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ARENA, CELL, HALF, SIZE, MID, doorIsOpen } from "../shared/game.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
    this.renderer.shadowMap.autoUpdate = false;
    this.lastShadow = -1;
    this.quality = null;
    this.renderScale = 1;
    this.frameAverage = 1 / 60;
    this.budgetTime = 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xb9e5ff, 0x38433f, 2.2));
    const sun = new THREE.DirectionalLight(0xffedd8, 3);
    sun.position.set(15, 35, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
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
    this.headlight = new THREE.PointLight(0xffe5bd, 9, 11, 1.6);
    this.headlight.visible = false;
    this.scene.add(this.headlight);
    this.warningMaterial = new THREE.MeshBasicMaterial({ color: 0xff6633 });
    this.materials = {
      floor: mat(0xcccfc0),
      wall: mat(0x677d7b),
      cap: mat(0xc4c9b7),
      dark: mat(0x172b3e),
      white: mat(0xf4eee2),
      gold: mat(0xffd365, { metalness: 0.35 }),
      cyan: mat(COLORS[0]),
      orange: mat(COLORS[1]),
    };
    this.materials.wall.map = this.surfaceTexture("stone");
    this.materials.cap.color.setHex(0xd2c7ab);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.devices = new Map();
    this.avatars = new Map();
    this.pickables = [];
    this.keys = [];
    this.particles = [];
    this.elapsed = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1;
    this.mode = "landing";
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.build();
    // Load once; avatars share geometry and textures, with independent transforms.
    this.characterReady = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/community-character.glb`)
      .then(({ scene }) => {
        scene.rotation.y = -Math.PI / 2;
        scene.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(scene);
        const scale = 1.8 / (bounds.max.y - bounds.min.y);
        scene.scale.setScalar(scale);
        scene.position.set(
          (-(bounds.min.x + bounds.max.x) * scale) / 2,
          -bounds.min.y * scale,
          (-(bounds.min.z + bounds.max.z) * scale) / 2,
        );
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.characterTemplate = scene;
        for (const actor of this.avatars.values()) this.attachCharacter(actor);
        return scene;
      })
      .catch((error) => {
        console.warn(
          "Character could not load; using the fallback avatar.",
          error,
        );
        return null;
      });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.camera.position.set(37, 32, 40);
    this.camera.lookAt(0, 0, 0);
  }
  surfaceTexture(kind) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    let seed = 45;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    ctx.fillStyle =
      kind === "door" ? "#6c8f8b" : kind === "floor" ? "#bfc4b7" : "#d3d0c3";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 14000; i++) {
      const value = random();
      ctx.fillStyle = `rgba(${value > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.07})`;
      ctx.fillRect(random() * 512, random() * 512, random() * 3 + 1, 1);
    }
    if (kind === "door") {
      const gradient = ctx.createLinearGradient(0, 0, 512, 0);
      gradient.addColorStop(0, "#09252c");
      gradient.addColorStop(0.5, "#507873");
      gradient.addColorStop(1, "#173b40");
      ctx.fillStyle = gradient;
      ctx.fillRect(24, 20, 464, 472);
      ctx.strokeStyle = "#9ab0a0";
      ctx.lineWidth = 3;
      ctx.strokeRect(35, 32, 442, 448);
      ctx.fillStyle = "#0b2029";
      ctx.fillRect(85, 70, 342, 115);
      ctx.strokeStyle = "#c4ac74";
      ctx.lineWidth = 8;
      ctx.strokeRect(85, 70, 342, 115);
      ctx.fillStyle = "#90c4bb";
      ctx.fillRect(96, 80, 320, 8);
      ctx.fillStyle = "#19363c";
      for (let x = 130; x < 420; x += 50) ctx.fillRect(x, 90, 8, 85);
      ctx.fillStyle = "#d2b87c";
      ctx.fillRect(205, 235, 102, 16);
      ctx.fillStyle = "#152c32";
      for (let y = 340; y < 435; y += 20) ctx.fillRect(95, y, 320, 5);
      ctx.fillStyle = "#b6baa0";
      for (const x of [48, 464])
        for (const y of [45, 467]) {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
    } else {
      if (kind === "floor") {
        ctx.strokeStyle = "#63756550";
        ctx.lineWidth = 3;
        ctx.strokeRect(18, 18, 476, 476);
        ctx.strokeStyle = "#ede3bd24";
        ctx.lineWidth = 2;
        ctx.strokeRect(24, 24, 464, 464);
      }
      ctx.strokeStyle = "#7a8c821c";
      ctx.lineWidth = 2;
      for (let y = 0; y <= 512; y += 128) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(512, y);
        ctx.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    return texture;
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
      mat(0xffffff, { map: this.surfaceTexture("floor") }),
      SIZE * SIZE,
    );
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const i = r * SIZE + c;
        floor.setMatrixAt(
          i,
          new THREE.Matrix4().makeTranslation(
            (c - MID) * CELL,
            -0.06,
            (r - MID) * CELL,
          ),
        );
        floor.setColorAt(i, new THREE.Color((r + c) % 2 ? 0x819187 : 0x8d9a8e));
      }
    floor.receiveShadow = true;
    this.world.add(floor);
    for (const w of ARENA.walls) {
      this.box(w.w, 3.12, w.d, w.x, 1.56, w.z, m.wall);
      this.box(w.w + 0.06, 0.16, w.d + 0.06, w.x, 3.2, w.z, m.cap);
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
    this.box(3.3, 0.14, 2.8, 0, 0.03, ARENA.exit.z, mat(0x97efae));
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
    const doorLightMaterial = new THREE.MeshBasicMaterial({ color: 0xffd59a });
    const stadiumLights = [
      new THREE.MeshBasicMaterial({ color: 0xffcb76 }),
      new THREE.MeshBasicMaterial({ color: 0x6ce8ed }),
    ];
    const floodLightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3da });
    const doorMaterial = mat(0xffffff, {
      map: this.surfaceTexture("door"),
      metalness: 0.3,
      roughness: 0.45,
    });
    const doorTrim = mat(0xd8b985, { metalness: 0.55, roughness: 0.4 });
    this.doorPanels = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.85, 2.65, 0.18),
      doorMaterial,
      ARENA.doors.length * 2,
    );
    this.doorPanels.castShadow = true;
    this.doorPanels.receiveShadow = true;
    this.doorPanels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.doorPanels.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      Math.hypot(HALF, HALF) + 4,
    );
    this.world.add(this.doorPanels);
    let doorIndex = 0;
    for (const d of ARENA.doors) {
      const alongX = d.w > d.d,
        group = new THREE.Group();
      group.position.set(d.x, 0, d.z);
      this.world.add(group);
      const panels = [];
      for (const sign of [-1, 1]) {
        const panel = this.box(
          alongX ? 0.85 : 0.18,
          2.65,
          alongX ? 0.18 : 0.85,
          alongX ? sign * 0.425 : 0,
          1.325,
          alongX ? 0 : sign * 0.425,
          doorMaterial,
          group,
        );
        panel.visible = false;
        panel.castShadow = false;
        panels.push(panel);
        this.box(
          0.14,
          3.05,
          0.14,
          d.x + (alongX ? sign * 0.94 : 0),
          1.525,
          d.z + (alongX ? 0 : sign * 0.94),
          doorTrim,
        );
      }
      this.box(
        alongX ? 2.02 : 0.3,
        0.25,
        alongX ? 0.3 : 2.02,
        d.x,
        2.9,
        d.z,
        doorTrim,
      );
      // Small illuminated transom marks a doorway without a floating label.
      this.box(
        alongX ? 0.8 : 0.05,
        0.035,
        alongX ? 0.05 : 0.8,
        d.x,
        2.76,
        d.z,
        doorLightMaterial,
      );
      this.devices.set(d.id, {
        group,
        panels,
        alongX,
        type: "door",
        slide: 0,
        panelIndex: doorIndex++ * 2,
        x: d.x,
        z: d.z,
      });
      this.writeDoorPanels(this.devices.get(d.id));
      group.traverse((o) => {
        if (o.isMesh) {
          o.userData.device = d.id;
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
          HALF * 2 + 6,
          0.65,
          1.4,
          0,
          row * 0.7 - 0.3,
          HALF + 4 + row * 1.5,
          m.dark,
          stand,
        );
        for (let seat = 0; seat < 24; seat++) {
          const q = new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              (side * Math.PI) / 2,
            ),
            v = new THREE.Vector3(
              (seat - 11.5) * ((HALF * 2 + 4) / 24),
              row * 0.7 + 0.18,
              HALF + 4 + row * 1.5,
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
      this.box(
        HALF * 2 + 6,
        0.13,
        0.13,
        0,
        3,
        HALF + 9,
        side % 2 ? m.orange : m.cyan,
        stand,
      );
    }
    seats.receiveShadow = true;
    this.world.add(seats);
    for (const x of [-HALF - 7, HALF + 7])
      for (const z of [-HALF - 7, HALF + 7]) {
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
            floodLightMaterial,
          );
      }
    const board = this.text("MAZE / RIOT", 13, 2.4, "#ffdc80");
    board.position.set(0, 8, -HALF - 8);
    this.world.add(board);
    const sub = this.text("CONTROL THE CHAOS", 10, 1, "#45e0df");
    sub.position.set(0, 6, -HALF - 8);
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
        stadiumLights[i % 2],
      );
    }
    const batches = new Map();
    this.world.updateMatrixWorld(true);
    for (const mesh of [...this.world.children])
      if (mesh.isMesh && !mesh.isInstancedMesh && !mesh.material.transparent) {
        const list = batches.get(mesh.material) || [];
        list.push(mesh);
        batches.set(mesh.material, list);
      }
    for (const [material, meshes] of batches)
      if (meshes.length > 1) {
        const geometries = meshes.map((mesh) =>
          mesh.geometry.clone().applyMatrix4(mesh.matrix),
        );
        const geometry = mergeGeometries(geometries);
        geometries.forEach((g) => g.dispose());
        if (!geometry) continue;
        const combined = new THREE.Mesh(geometry, material);
        combined.castShadow = true;
        combined.receiveShadow = true;
        this.world.add(combined);
        meshes.forEach((mesh) => {
          this.world.remove(mesh);
          mesh.geometry.dispose();
        });
      }
  }
  attachCharacter(actor) {
    if (!this.characterTemplate || actor.userData.character) return;
    const model = this.characterTemplate.clone(true);
    actor.remove(actor.userData.fallback);
    actor.add(model);
    actor.userData.character = model;
    actor.userData.limbs = [];
    // Reapply overview materials to the newly attached mesh on the next frame.
    actor.userData.spectator = undefined;
    this.renderer.shadowMap.needsUpdate = true;
  }
  avatar(team) {
    const actor = new THREE.Group();
    const fallback = this.fallbackAvatar(team);
    actor.userData.fallback = fallback;
    actor.userData.limbs = fallback.userData.limbs;
    actor.add(fallback);
    // A small team beacon keeps identical character skins distinguishable.
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 8, 6),
      new THREE.MeshBasicMaterial({ color: COLORS[team] }),
    );
    beacon.position.set(0, 2.02, 0);
    actor.add(beacon);
    this.attachCharacter(actor);
    this.world.add(actor);
    return actor;
  }
  fallbackAvatar(team) {
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
    return g;
  }
  writeDoorPanels(obj) {
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 2; i++) {
      const offset = (i === 0 ? -1 : 1) * (0.425 + obj.slide * 0.85);
      matrix.makeRotationY(obj.alongX ? 0 : Math.PI / 2);
      matrix.setPosition(
        obj.x + (obj.alongX ? offset : 0),
        1.325,
        obj.z + (obj.alongX ? 0 : offset),
      );
      this.doorPanels.setMatrixAt(obj.panelIndex + i, matrix);
    }
    this.doorPanels.instanceMatrix.needsUpdate = true;
  }
  setActorView(actor, slot, spectator) {
    if (actor.userData.spectator === spectator) return;
    actor.userData.actorSlot = slot;
    actor.userData.spectator = spectator;
    actor.scale.setScalar(spectator ? 1.25 : 1);
    actor.traverse((o) => {
      if (!o.isMesh || o.userData.marker) return;
      o.userData.normalMaterial ||= o.material;
      if (!o.userData.overviewMaterial) {
        o.userData.overviewMaterial = o.material.clone();
        o.userData.overviewMaterial.depthTest = false;
        o.userData.overviewMaterial.depthWrite = false;
      }
      o.material = spectator
        ? o.userData.overviewMaterial
        : o.userData.normalMaterial;
      o.renderOrder = spectator ? 20 : 0;
    });
    if (!actor.userData.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.48, 0.6, 24),
        new THREE.MeshBasicMaterial({
          color: COLORS[Math.floor(slot / 2)],
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      ring.renderOrder = 19;
      ring.userData.marker = true;
      actor.add(ring);
      actor.userData.ring = ring;
    }
    actor.userData.ring.visible = spectator;
  }
  updateQuality(quality, frameTime) {
    const cap = quality === "low" ? 1 : Math.min(devicePixelRatio, 1.5);
    const switched = this.quality !== quality;
    if (switched) {
      this.quality = quality;
      this.renderScale = cap;
      this.frameAverage = 1 / 60;
      this.budgetTime = 0;
      this.renderer.shadowMap.enabled = quality !== "low";
    }
    const sample = Math.min(0.1, Math.max(0.005, frameTime));
    this.frameAverage += (sample - this.frameAverage) * 0.04;
    this.budgetTime += sample;
    let next = this.renderScale;
    if (this.budgetTime > 2) {
      this.budgetTime = 0;
      if (this.frameAverage > 1 / 43)
        next = Math.max(quality === "low" ? 0.65 : 0.8, next - 0.15);
      else if (this.frameAverage < 1 / 57) next = Math.min(cap, next + 0.1);
    }
    if (switched || Math.abs(next - this.renderScale) > 0.01) {
      this.renderScale = next;
      this.renderer.setPixelRatio(next);
      this.resize();
      this.renderer.shadowMap.needsUpdate = true;
    }
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
      this.camera.fov = mode === "runner" ? 88 : 48;
      this.camera.updateProjectionMatrix();
      if (mode === "runner") this.pitch = 0.12;
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
  render(dt, state, slot, local, quality, poses = null, frameTime = dt) {
    this.updateQuality(quality, frameTime);
    this.elapsed += dt;
    const t = this.elapsed,
      own = state?.players[slot],
      time = state?.serverTime || 0;
    this.headlight.visible = own?.role === "runner";
    if (!state) {
      this.setMode("landing");
      const pos = new THREE.Vector3(
        HALF * 1.8 + Math.sin(t * 0.06) * 3,
        HALF * 1.65,
        HALF * 2,
      );
      this.camera.position.lerp(pos, 0.03);
      this.camera.lookAt(0, 0, -1);
      for (let i = 0; i < 2; i++) {
        if (!this.avatars.has(i)) this.avatars.set(i, this.avatar(i));
        const a = this.avatars.get(i);
        a.visible = true;
        a.position.set(ARENA.spawns[i].x, 0, ARENA.spawns[i].z);
      }
    } else {
      if (this.mode !== own.role && own.role === "runner")
        this.yaw = own.team === 0 ? -Math.PI / 2 : Math.PI / 2;
      this.setMode(own.role);
      for (const [id, a] of this.avatars) {
        a.visible = false;
      }
      for (const p of (poses?.players || state.players).filter(
        (p) => p.role === "runner",
      )) {
        let a = this.avatars.get(p.slot + 10);
        if (!a) {
          a = this.avatar(p.team);
          this.avatars.set(p.slot + 10, a);
        }
        this.setActorView(a, p.slot, own.role === "controller");
        a.visible = !p.hidden && !(own.role === "runner" && p.slot === slot);
        if (p.hidden) continue;
        const target = p.slot === slot && local ? local : p;
        const desired = new THREE.Vector3(target.x, target.y || 0, target.z);
        a.position.copy(desired);
        const diff = Math.atan2(
          Math.sin(p.yaw - a.rotation.y),
          Math.cos(p.yaw - a.rotation.y),
        );
        a.rotation.y += diff * Math.min(1, dt * 24);
        a.rotation.z = p.stun > time ? Math.sin(t * 25) * 0.35 : 0;
        const speed = a.userData.last
          ? a.position.distanceTo(a.userData.last) / Math.max(dt, 0.001)
          : 0;
        a.userData.last = a.position.clone();
        a.userData.stride =
          (a.userData.stride || 0) + Math.min(speed, 7) * dt * 2.6;
        if (a.userData.character) {
          const model = a.userData.character;
          const moving = speed > 0.3;
          model.position.y =
            this.characterTemplate.position.y +
            (moving ? Math.abs(Math.sin(a.userData.stride)) * 0.045 : 0);
          model.rotation.z = moving ? Math.sin(a.userData.stride) * 0.025 : 0;
        }
        a.userData.limbs.forEach((l, i) => {
          const angle =
            speed > 0.3
              ? Math.sin(a.userData.stride + (i % 2) * Math.PI) * 0.55
              : 0;
          l.rotation.x += (angle - l.rotation.x) * (1 - Math.exp(-dt * 16));
        });
      }
      if (own.role === "runner") {
        const p = local || own;
        this.camera.position.set(p.x, 1.62 + (p.y || 0), p.z);
        this.camera.rotation.set(-this.pitch, this.yaw, 0, "YXZ");
        this.headlight.position.copy(this.camera.position);
        this.cameraReady = true;
      } else {
        const desired = new THREE.Vector3(
          0,
          Math.max(HALF * 2.65, (HALF * 2.4) / this.camera.aspect) * this.zoom,
          HALF * 0.78 * this.zoom,
        );
        this.camera.position.lerp(
          desired,
          this.cameraReady ? 1 - Math.exp(-dt * 8) : 1,
        );
        this.camera.lookAt(0, 0, 0);
        this.cameraReady = true;
      }
    }
    for (const d of ARENA.doors) {
      const obj = this.devices.get(d.id),
        open = state ? doorIsOpen(state, d.id, time) : false;
      const previousSlide = obj.slide;
      obj.slide += ((open ? 1 : 0) - obj.slide) * Math.min(1, dt * 15);
      if (Math.abs((open ? 1 : 0) - obj.slide) < 0.001)
        obj.slide = open ? 1 : 0;
      if (previousSlide !== obj.slide) this.writeDoorPanels(obj);
      obj.panels.forEach((panel, i) => {
        const offset = (i === 0 ? -1 : 1) * (0.425 + obj.slide * 0.85);
        panel.position[obj.alongX ? "x" : "z"] = offset;
      });
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
    // Reuse the shadow map between updates; character/camera motion still renders
    // at the display refresh rate. Shadows refresh at 10 Hz instead of every frame.
    if (this.elapsed - this.lastShadow >= 0.1) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadow = this.elapsed;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
