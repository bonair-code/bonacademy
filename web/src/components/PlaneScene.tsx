import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
// Draco çözücüsü: adresleri açıkça veriliyor. Loader'ın kendi varsayılanı
// (import.meta.url'e göre göreli) geliştirme sunucusunda çözülmüyordu.
import dracoJs from "three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasm from "three/addons/libs/draco/gltf/draco_decoder.wasm?url";
import { registerFlyHandler } from "../lib/loginFlight";

/**
 * Giriş ekranındaki 3D uçak (Cessna 172).
 *
 * Model: "Cessna-172" by Sousinho (sketchfab.com/sousinho), CC BY 4.0 —
 * isim satırı PublicShell'in alt bilgisinde. public/models/cessna.glb,
 * gltf-transform ile sıkıştırıldı (Draco + WebP, 9.3 MB → 0.7 MB). Draco
 * çözücüsü three paketinden derlemeye girer; dışarıdan bir şey yüklenmiyor.
 *
 * Bu bileşen tembel yükleniyor (PublicShell'de React.lazy): three.js yalnızca
 * herkese açık ekranlarda indiriliyor, uygulamanın geri kalanını büyütmüyor.
 * Model hazır olunca `onReady`, WebGL yoksa ya da model inemezse `onFail`
 * çağrılır; PublicShell ikincisinde sertifikadaki uçak çizimini gösterir.
 */

/** Modelde burun −X yönünde; dış grup "burun +X" kabul ettiği için çevrilir. */
const NOSE_FLIP = true;

export default function PlaneScene({ onReady, onFail }: { onReady: () => void; onFail: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      onFail(); // WebGL yok: yedek çizim
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    // Gerçekçiliğin büyük kısmı yansımalardan: stüdyo ortam ışığı
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    camera.position.set(0, 4.2, 14);
    camera.lookAt(0, 0, 0);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 8, 7);
    const rim = new THREE.DirectionalLight(0x7ea2e6, 1.6);
    rim.position.set(-8, 3, -6);
    scene.add(sun, rim, new THREE.HemisphereLight(0xc9dbff, 0x0d1730, 0.35));

    const jet = new THREE.Group(); // dış grup: burun +X
    const pivot = new THREE.Group(); // modelin kendi yönünü düzeltir
    jet.add(pivot);
    scene.add(jet);
    let prop: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null;
    const tips = [new THREE.Vector3(), new THREE.Vector3()];
    let disposed = false;

    const draco = new DRACOLoader();
    draco.setDecoderPath({ js: dracoJs, wasm: dracoWasm });
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(
      "/models/cessna.glb",
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        // Ortala ve ölçekle: kanat açıklığı 7.4 birim
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const k = 7.4 / size.z;
        model.position.sub(center).multiplyScalar(k);
        model.scale.setScalar(k);
        pivot.add(model);
        if (NOSE_FLIP) pivot.rotation.y = Math.PI;
        const span = size.z * k;
        const hgt = size.y * k;

        prop = replacePropeller(model, pivot);
        addTailStar(model, pivot);
        tips[0].set(0, 0.25 * hgt, span / 2 - 0.05);
        tips[1].set(0, 0.25 * hgt, -span / 2 + 0.05);
        onReady();
      },
      undefined,
      () => {
        if (!disposed) onFail(); // model yüklenemedi: yedek çizim
      }
    );

    // ── İz parçacıkları (kanat uçlarından ince buhar) ──────────
    const sc = document.createElement("canvas");
    sc.width = sc.height = 64;
    const sg = sc.getContext("2d")!;
    const gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,0.8)");
    gr.addColorStop(0.4, "rgba(220,232,255,0.3)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    sg.fillStyle = gr;
    sg.fillRect(0, 0, 64, 64);
    const sprTex = new THREE.CanvasTexture(sc);
    const puffs: THREE.Sprite[] = [];
    const puff = (pos: THREE.Vector3) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: sprTex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.32,
        })
      );
      s.position.copy(pos);
      s.scale.setScalar(0.1);
      s.userData.age = 0;
      scene.add(s);
      puffs.push(s);
    };

    // ── Yerleşim: geniş ekranda uçak solda, dar ekranda üstte ──
    const base = new THREE.Vector3();
    let narrow = false;
    const layout = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      narrow = w < 1024;
      // Telefonda uçak logo ile panel arasındaki boşluğun ortasında
      // (eskiden 2.7 idi, logonun üstüne biniyordu).
      base.set(narrow ? 0 : -2.2, narrow ? 1.95 : 0, 0);
      jet.scale.setScalar(narrow ? 0.46 : 1);
    };
    window.addEventListener("resize", layout);
    layout();

    let mx = 0;
    let my = 0;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onMove);

    // ── Uçuş ────────────────────────────────────────────────
    let flying = false;
    let done = false;
    let t0 = 0;
    let fadeCb: (() => void) | null = null;
    let finish: (() => void) | null = null;
    const start = new THREE.Vector3();
    const clk = new THREE.Clock();
    const wp = new THREE.Vector3();
    const ease = (p: number) => Math.pow(p, 2.2);
    const smooth = (p: number) => p * p * (3 - 2 * p);
    const FLIGHT = 1.7;

    registerFlyHandler((onFade) => {
      if (reduce || !prop) {
        onFade();
        return new Promise((r) => setTimeout(r, 350));
      }
      return new Promise<void>((resolve) => {
        start.copy(jet.position);
        flying = true;
        done = false;
        t0 = clk.getElapsedTime();
        fadeCb = onFade;
        finish = resolve;
      });
    });

    let raf = 0;
    const frame = () => {
      const t = clk.getElapsedTime();
      if (done) {
        // uçak ekran dışında kalır
      } else if (!flying) {
        const bob = reduce ? 0 : 1;
        jet.position.set(base.x, base.y + Math.sin(t * 1.1) * 0.12 * bob, base.z);
        jet.rotation.set(
          0.1 + (Math.sin(t * 0.7) * 0.05 + my * 0.08) * bob,
          -0.55 + mx * 0.35 * bob,
          (Math.sin(t * 0.9) * 0.025 - my * 0.05) * bob
        );
      } else {
        const p = Math.min(1, (t - t0) / FLIGHT);
        const e = ease(p);
        const s = smooth(Math.min(1, p * 1.6));
        if (narrow) {
          // Telefon: burnunu kaldırıp tırmanarak ekranın üstünden, uzaklaşarak
          // çıkar (sağa uçsa dar ekranda hemen kayboluyordu; aşağı dalış da
          // "düşüyor" gibi yanlış anlaşılıyordu).
          jet.position.set(start.x + e * 0.8, start.y + e * 11 + s * 0.15, start.z - e * 6);
          jet.rotation.set(0.1 + 0.2 * s, -0.55 - 0.35 * s, 0.85 * s);
        } else {
          jet.position.set(start.x + e * 19, start.y + e * 2.6 + s * 0.2, start.z + e * 3);
          jet.rotation.set(0.1 + 0.32 * s, -0.55 + 0.25 * s, 0.14 * s);
        }
        // İz yalnızca uçak hızlanınca (başta aynı noktada birikip leke yapıyordu)
        if (p > 0.18 && p < 0.92) {
          jet.updateMatrixWorld();
          for (const tp of tips) puff(wp.copy(tp).applyMatrix4(pivot.matrixWorld));
        }
        if (p > 0.7 && fadeCb) {
          fadeCb();
          fadeCb = null;
        }
        if (p >= 1) {
          flying = false;
          done = true;
          // kararma (CSS ~0.45 sn) bitsin, sonra panel
          setTimeout(() => finish?.(), 250);
        }
      }
      if (prop) prop.material.map!.rotation = -t * (flying ? 34 : reduce ? 0 : 24);
      for (let i = puffs.length - 1; i >= 0; i--) {
        const pf = puffs[i];
        pf.userData.age += 1 / 60;
        const a = pf.userData.age as number;
        pf.scale.setScalar(0.1 + a * 0.35);
        pf.material.opacity = Math.max(0, 0.32 * (1 - a / 1.0));
        if (a > 1.0) {
          scene.remove(pf);
          pf.material.dispose();
          puffs.splice(i, 1);
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      registerFlyHandler(null);
      finish?.(); // yarıda kalan uçuşu beklemeyi bırak
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
      window.removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((mat) => {
          Object.values(mat).forEach((v) => {
            if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
          });
          mat.dispose();
        });
      });
      sprTex.dispose();
      envRT.dispose();
      pmrem.dispose();
      draco.dispose();
      renderer.dispose();
    };
  }, [onReady, onFail]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

/**
 * Dikey kuyruğun iki yüzüne Capella yıldızı (logonun sol kısmı, Logo.png'nin
 * ilk ~97 pikseli). Kuyruk modelden ölçülür: arka bölümün en yüksek noktası
 * kuyruk ucu, genişliğin birden açıldığı seviye kuyruk kökü; yıldız ikisinin
 * ortasına, o yükseklikteki kirişin ortasına oturur. Yıldız her iki yüzde de uçuş yönüne (buruna) bakar.
 */
function addTailStar(model: THREE.Object3D, pivot: THREE.Object3D) {
  pivot.updateMatrixWorld(true);
  const inv = pivot.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  const pts: number[][] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 2) {
      v.fromBufferAttribute(p as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      pts.push([v.x, v.y, v.z]);
    }
  });
  if (!pts.length) return;
  // Kuyruk burnun tersinde
  let minX = Infinity, maxX = -Infinity;
  for (const [x] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const len = maxX - minX;
  const tailSign = NOSE_FLIP ? 1 : -1;
  const tailX = NOSE_FLIP ? maxX : minX;
  const rear = pts.filter(([x]) => (tailX - x) * tailSign < len * 0.3);
  let yTop = -Infinity;
  for (const [, y] of rear) yTop = Math.max(yTop, y);
  // Kuyruğun gövdeyle birleştiği yükseklik: uçtan aşağı inerken arka
  // bölümün genişliği (|z|) birden açıldığı ilk seviye — gövde/yatay kuyruk.
  let root = yTop - 0.6;
  for (let y = yTop - 0.1; y > yTop - 2; y -= 0.04) {
    let w = 0;
    for (const [, py, pz] of rear) if (py >= y && py < y + 0.04) w = Math.max(w, Math.abs(pz));
    if (w > 0.16) { root = y + 0.04; break; }
  }
  // Yıldız kuyruğun dikeyde ortasında; o yükseklikteki kiriş ve yüzey (z)
  const cy = (root + yTop) / 2;
  const band = rear.filter(([, y, z]) => Math.abs(y - cy) < 0.1 && Math.abs(z) < 0.25);
  if (band.length < 10) return;
  let bx0 = Infinity, bx1 = -Infinity, zMax = -Infinity, zMin = Infinity;
  for (const [x, , z] of band) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); zMax = Math.max(zMax, z); zMin = Math.min(zMin, z); }
  const chord = bx1 - bx0;
  const size = Math.min(chord * 0.6, (yTop - root) * 0.62, 0.55);
  const cx = (bx0 + bx1) / 2;

  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const sw = 97, sh = img.naturalHeight; // yıldız + kuyruk çizgileri
    const k = 240 / Math.max(sw, sh);
    g.drawImage(img, 0, 0, sw, sh, (256 - sw * k) / 2, (256 - sh * k) / 2, sw * k, sh * k);
    const make = (flip: boolean) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (flip) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
      return new THREE.MeshStandardMaterial({
        map: t, transparent: true, alphaTest: 0.05, roughness: 0.45, metalness: 0.1,
        polygonOffset: true, polygonOffsetFactor: -4,
      });
    };
    const geo = new THREE.PlaneGeometry(size, size);
    // +z yüzü: görüntünün sağı kuyruk tarafı → yıldız buruna baksın diye aynalı
    const right = new THREE.Mesh(geo, make(NOSE_FLIP));
    right.position.set(cx, cy, zMax + 0.004);
    const left = new THREE.Mesh(geo, make(!NOSE_FLIP));
    left.rotation.y = Math.PI;
    left.position.set(cx, cy, zMin - 0.004);
    pivot.add(right, left);
  };
  img.src = "/Logo.png";
}

/**
 * Modelin pervanesi gövdeyle tek parça ve SABİT; uçan uçakta duran kanatlar
 * gerçekçi değil. Kanatları (burun ucunun hemen gerisindeki, eksenden uzak ince
 * dilim) geometriden çıkarır, yerine kanatların düzleminde ve göbeğe ortalı
 * dönen bir pervane diski koyar. Ölçüler modelden okunur; koordinatlar pivot'a
 * göre.
 */
function replacePropeller(model: THREE.Object3D, pivot: THREE.Object3D) {
  pivot.updateMatrixWorld(true);
  const inv = pivot.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const local = (o: THREE.Mesh, i: number) =>
    v.fromBufferAttribute(o.geometry.attributes.position as THREE.BufferAttribute, i)
      .applyMatrix4(o.matrixWorld)
      .applyMatrix4(inv);
  const each = (fn: (o: THREE.Mesh, i: number) => void) => {
    for (const o of meshes) {
      const n = o.geometry.attributes.position.count;
      for (let i = 0; i < n; i++) fn(o, i);
    }
  };

  // Burun ucu ve pervane ekseni
  let nose = NOSE_FLIP ? Infinity : -Infinity;
  each((o, i) => {
    const x = local(o, i).x;
    nose = NOSE_FLIP ? Math.min(nose, x) : Math.max(nose, x);
  });
  const back = (x: number) => (NOSE_FLIP ? x - nose : nose - x); // uçtan geriye
  let yc = 0;
  let zc = 0;
  let nt = 0;
  each((o, i) => {
    local(o, i);
    if (back(v.x) < 0.02) {
      yc += v.y;
      zc += v.z;
      nt++;
    }
  });
  yc /= nt || 1;
  zc /= nt || 1;
  const rad = () => Math.hypot(v.y - yc, v.z - zc);

  // Kanat dilimi: uçtan 0.4 birim içinde, eksenden 0.45'ten uzak noktalar
  // (kaporta bu bölgede en fazla ~0.39 açılıyor; daha uzağı yalnızca kanat)
  let dMin = Infinity;
  let dMax = -Infinity;
  let bladeR = 0;
  each((o, i) => {
    local(o, i);
    const d = back(v.x);
    const r = rad();
    if (d < 0.4 && r > 0.45) {
      dMin = Math.min(dMin, d);
      dMax = Math.max(dMax, d);
      bladeR = Math.max(bladeR, r);
    }
  });
  if (!isFinite(dMin)) return null;
  const zoneA = dMin - 0.015;
  const zoneB = dMax + 0.015;
  const hubR = 0.13;

  // Üç köşesi de kanat diliminde olan üçgenleri çıkar
  for (const o of meshes) {
    const g = o.geometry;
    const n = g.attributes.position.count;
    const blade = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      local(o, i);
      const d = back(v.x);
      blade[i] = d >= zoneA && d <= zoneB && rad() > hubR ? 1 : 0;
    }
    const idx = g.index ? g.index.array : Uint32Array.from({ length: n }, (_, i) => i);
    const keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      if (!(blade[a] && blade[b] && blade[c])) keep.push(a, b, c);
    }
    g.setIndex(keep);
  }

  // Dönen pervane: soluk disk + iki kanadın hareket izi (bulanıklık kopyalarıyla)
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g2 = c.getContext("2d")!;
  const disk = g2.createRadialGradient(256, 256, 0, 256, 256, 256);
  disk.addColorStop(0, "rgba(200,206,218,0.10)");
  disk.addColorStop(0.7, "rgba(200,206,218,0.16)");
  disk.addColorStop(0.93, "rgba(220,226,236,0.22)");
  disk.addColorStop(1, "rgba(220,226,236,0)");
  g2.fillStyle = disk;
  g2.beginPath();
  g2.arc(256, 256, 256, 0, Math.PI * 2);
  g2.fill();
  const ghosts: [number, number][] = [
    [0, 1],
    [0.1, 0.55],
    [0.2, 0.35],
    [0.3, 0.2],
    [0.42, 0.1],
  ];
  for (const [off, al] of ghosts) {
    for (const ang of [0, Math.PI]) {
      g2.save();
      g2.translate(256, 256);
      g2.rotate(ang + off);
      g2.globalAlpha = al;
      const bl = g2.createLinearGradient(0, 0, 256, 0);
      bl.addColorStop(0, "rgba(25,25,30,0.55)");
      bl.addColorStop(0.85, "rgba(25,25,30,0.35)");
      bl.addColorStop(0.95, "rgba(230,230,235,0.5)");
      bl.addColorStop(1, "rgba(230,230,235,0)");
      g2.fillStyle = bl;
      g2.beginPath();
      g2.moveTo(0, -14);
      g2.quadraticCurveTo(140, -22, 252, -9);
      g2.lineTo(252, 9);
      g2.quadraticCurveTo(140, 22, 0, 14);
      g2.closePath();
      g2.fill();
      g2.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.center.set(0.5, 0.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  const prop = new THREE.Mesh(
    new THREE.CircleGeometry(bladeR * 1.02, 64),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  prop.rotation.y = Math.PI / 2;
  const planeX = NOSE_FLIP ? nose + (dMin + dMax) / 2 : nose - (dMin + dMax) / 2;
  prop.position.set(planeX, yc, zc);
  pivot.add(prop);
  return prop;
}
