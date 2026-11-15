/* ============================================================
   太阳系探索器 · 主程序
   ============================================================ */
(function () {
  'use strict';

  const DEG = Math.PI / 180, RAD = 180 / Math.PI;
  const J2000 = 2451545.0;
  const $ = (s) => document.querySelector(s);

  /* ---------------- 移动端模式 ---------------- */
  const MODE = window.__MOBILE_MODE || null;    // 'ua' | 'hash' | 'off' | null
  function computeMobile() {
    if (MODE === 'hash') return true;
    if (MODE === 'off') return false;
    if (MODE === 'ua') return true;
    return window.innerWidth <= 900;
  }
  let IS_MOBILE = computeMobile();
  document.documentElement.classList.toggle('is-mobile', IS_MOBILE);

  /* ---------------- 尺度换算（视觉压缩，保证所有天体可见） ---------------- */
  const DIST_K = 70, DIST_P = 0.6;      // 轨道距离压缩
  const SIZE_K = 3.7, SIZE_P = 0.41;    // 天体半径压缩
  const SUN_R = 16;

  function distVis(au) { return DIST_K * Math.pow(au, DIST_P); }
  function radVis(km) { return SIZE_K * Math.pow(km / 6371, SIZE_P); }
  function moonDist(planetKm, moonKm, planetVis) {
    return planetVis * (1.95 + 1.15 * Math.log10(Math.max(1.6, moonKm / planetKm)));
  }

  /* ---------------- 全局状态 ---------------- */
  const state = {
    simDays: 0,
    speed: 1.6,
    playing: true,
    selected: null,
    follow: null,
    showLabels: true,
    showOrbits: true,
    showBelt: true,
    pin: null,
    quality: /hq/.test(location.search) ? 'hq' : (IS_MOBILE ? 'mobile' : 'normal')
  };

  const bodies = [];          // 全部天体（含卫星）
  const byId = {};
  const pickables = [];
  const labels = [];

  let renderer, scene, camera, sunLight, clock;
  let earthMesh = null, earthGroup = null, markerGroup = null;

  /* ============================================================
     1. 场景
     ============================================================ */
  function initScene() {
    const canvas = $('#c');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.6 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(IS_MOBILE ? 52 : 45, window.innerWidth / window.innerHeight, 0.05, 9000);
    camera.position.set(0, 210, 420);

    sunLight = new THREE.PointLight(0xfff4e0, 1.18, 0, 0);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x223044, 0.55));

    buildStars();
    buildBelt();
    clock = new THREE.Clock();
  }

  function buildStars() {
    const N = IS_MOBILE ? 6500 : 14000;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const rnd = Math.random;
    for (let i = 0; i < N; i++) {
      // 银河带聚集
      let u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
      let x, y, z;
      if (i % 5 !== 0) {
        const latB = (rnd() + rnd() + rnd() - 1.5) * 0.22;
        const r = 4200;
        x = Math.cos(th) * Math.cos(latB) * r;
        y = Math.sin(latB) * r;
        z = Math.sin(th) * Math.cos(latB) * r;
      } else {
        const r = 4200;
        const s = Math.sqrt(1 - u * u);
        x = Math.cos(th) * s * r; y = u * r; z = Math.sin(th) * s * r;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const t = rnd();
      const b = 0.45 + Math.pow(rnd(), 3) * 0.55;
      let cr = 1, cg = 1, cb = 1;
      if (t < 0.12) { cr = 1; cg = 0.82; cb = 0.68; }
      else if (t < 0.3) { cr = 0.72; cg = 0.85; cb = 1; }
      else if (t < 0.36) { cr = 1; cg = 0.95; cb = 0.8; }
      col[i * 3] = cr * b; col[i * 3 + 1] = cg * b; col[i * 3 + 2] = cb * b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 2.1, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  let belt = null, kuiper = null;
  function buildBelt() {
    function cloud(n, a0, a1, thick, size, color, op) {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = a0 + Math.random() * (a1 - a0);
        const th = Math.random() * Math.PI * 2;
        const r = distVis(a);
        pos[i * 3] = Math.cos(th) * r;
        pos[i * 3 + 1] = (Math.random() - 0.5) * r * thick;
        pos[i * 3 + 2] = Math.sin(th) * r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ color: color, size: size, transparent: true, opacity: op, depthWrite: false, sizeAttenuation: true });
      return new THREE.Points(g, m);
    }
    belt = cloud(IS_MOBILE ? 1100 : 2600, 2.06, 3.32, 0.05, IS_MOBILE ? 0.17 : 0.13, 0xb9a68f, 0.34);
    kuiper = cloud(IS_MOBILE ? 1500 : 3200, 30, 49, 0.12, 0.4, 0x8fa7c9, 0.26);
    scene.add(belt); scene.add(kuiper);
  }

  /* ============================================================
     2. 轨道力学
     ============================================================ */
  function kepler(el, days) {
    const M = (((el.L - el.varpi) + days * (360 / el.P)) % 360) * DEG;
    const e = el.e;
    let E = M;
    for (let i = 0; i < 7; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const r = el.a * (1 - e * Math.cos(E));
    const nu = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e);
    const w = (el.varpi - el.om) * DEG, om = el.om * DEG, inc = el.i * DEG;
    const arg = nu + w;
    const X = r * (Math.cos(om) * Math.cos(arg) - Math.sin(om) * Math.sin(arg) * Math.cos(inc));
    const Y = r * (Math.sin(om) * Math.cos(arg) + Math.cos(om) * Math.sin(arg) * Math.cos(inc));
    const Z = r * Math.sin(arg) * Math.sin(inc);
    return { x: X, y: Z, z: -Y, r: r };
  }

  function orbitPoints(el, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const M = i / n * 360;
      const e = el.e;
      let E = M * DEG;
      for (let k = 0; k < 6; k++) E = E - (E - e * Math.sin(E) - M * DEG) / (1 - e * Math.cos(E));
      const r = el.a * (1 - e * Math.cos(E));
      const nu = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e);
      const w = (el.varpi - el.om) * DEG, om = el.om * DEG, inc = el.i * DEG;
      const arg = nu + w;
      const X = r * (Math.cos(om) * Math.cos(arg) - Math.sin(om) * Math.sin(arg) * Math.cos(inc));
      const Y = r * (Math.sin(om) * Math.cos(arg) + Math.cos(om) * Math.sin(arg) * Math.cos(inc));
      const Z = r * Math.sin(arg) * Math.sin(inc);
      const s = distVis(r) / r;
      pts.push(new THREE.Vector3(X * s, Z * s, -Y * s));
    }
    return pts;
  }

  // 高偏心率轨道（彗星）：按偏近点角均匀采样，近日点附近才不会出现折线
  function orbitPointsE(el, n) {
    const e = el.e, pts = [];
    const w = (el.varpi - el.om) * DEG, om = el.om * DEG, inc = el.i * DEG;
    for (let i = 0; i <= n; i++) {
      const E = i / n * Math.PI * 2;
      const r = el.a * (1 - e * Math.cos(E));
      const nu = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e);
      const arg = nu + w;
      const X = r * (Math.cos(om) * Math.cos(arg) - Math.sin(om) * Math.sin(arg) * Math.cos(inc));
      const Y = r * (Math.sin(om) * Math.cos(arg) + Math.cos(om) * Math.sin(arg) * Math.cos(inc));
      const Z = r * Math.sin(arg) * Math.sin(inc);
      const s = distVis(r) / r;
      pts.push(new THREE.Vector3(X * s, Z * s, -Y * s));
    }
    return pts;
  }

  /* ============================================================
     3. 贴图生成
     ============================================================ */
  function texFromCanvas(c, rep) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (rep) t.repeat.set(rep[0], rep[1]);
    return t;
  }

  function buildTexture(def, isMoon, radiusKm) {
    const T = window.TEX;
    const kind = def.kind;
    const q = state.quality;
    if (kind === 'earth') {
      const W = q === 'hq' ? 4096 : q === 'mobile' ? 1536 : 2560;
      const e = T.makeEarth(W, W / 2);
      return {
        day: texFromCanvas(e.day), night: texFromCanvas(e.night), clouds: texFromCanvas(e.clouds),
        spec: texFromCanvas(e.spec), earth: true
      };
    }
    const small = isMoon && !(radiusKm > 900);
    let W = isMoon ? (small ? 512 : 1024) : 1536;
    if (q === 'mobile') W = Math.max(288, Math.round(W * 0.62));
    const H = Math.round(W / 2);
    if (kind === 'sun') {
      const sw = q === 'mobile' ? 1024 : 1536;
      return { map: texFromCanvas(T.makeSun(sw, sw / 2)) };
    }
    if (kind === 'gas') return { map: texFromCanvas(T.makeGas(Object.assign({ W: W, H: H }, def))) };
    if (kind === 'cloud') return { map: texFromCanvas(T.makeCloudy(Object.assign({ W: W, H: H }, def))) };
    if (kind === 'europa') return { map: texFromCanvas(T.makeIce(Object.assign({ W: W, H: H }, def))) };
    if (kind === 'io') return { map: texFromCanvas(T.makeIo(def)) };
    return { map: texFromCanvas(T.makeRocky(Object.assign({ W: W, H: H }, def))) };
  }

  /* ============================================================
     4. 天体构建
     ============================================================ */
  const earthVert = `
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    void main(){
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position,1.0);
      vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;

  const earthFrag = `
    uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D specMap;
    uniform vec3 sunDir; uniform vec3 camPos;
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    void main(){
      vec3 n = normalize(vN);
      vec3 L = normalize(sunDir);
      vec3 V = normalize(camPos - vW);
      float ndl = dot(n, L);
      float dayF = smoothstep(-0.14, 0.2, ndl);
      vec3 base = texture2D(dayMap, vUv).rgb;
      vec3 col = base * (0.12 + 1.38 * max(ndl, 0.0));
      vec3 Hv = normalize(L + V);
      float spec = pow(max(dot(n, Hv), 0.0), 70.0) * texture2D(specMap, vUv).r;
      col += vec3(0.85, 0.92, 1.0) * spec * 1.05 * dayF;
      vec3 lights = texture2D(nightMap, vUv).rgb;
      col += lights * (1.0 - dayF) * 1.25;
      float rim = pow(1.0 - max(dot(n, V), 0.0), 3.2);
      col += vec3(0.24, 0.45, 0.95) * rim * (0.3 + 0.7 * max(ndl, 0.0)) * 0.6;
      gl_FragColor = vec4(col, 1.0);
    }`;

  const cloudVert = earthVert;
  const cloudFrag = `
    uniform sampler2D map; uniform vec3 sunDir;
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    void main(){
      vec4 t = texture2D(map, vUv);
      vec3 n = normalize(vN);
      float ndl = dot(n, normalize(sunDir));
      float dayF = smoothstep(-0.16, 0.28, ndl);
      float a = t.a * (0.15 + 0.95 * dayF);
      if (a < 0.01) discard;
      vec3 c = vec3(1.0) * (0.16 + 0.95 * dayF);
      gl_FragColor = vec4(c, a * 0.9);
    }`;

  function atmosphereMaterial(color, power, str) {
    return new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(color) }, pk: { value: power }, str: { value: str } },
      vertexShader: `
        varying vec3 vN; varying vec3 vP;
        void main(){
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vP = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 glowColor; uniform float pk; uniform float str;
        varying vec3 vN; varying vec3 vP;
        void main(){
          vec3 v = normalize(-vP);
          float rim = pow(1.0 - abs(dot(normalize(vN), v)), pk);
          gl_FragColor = vec4(glowColor * rim * str, rim * str);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false
    });
  }

  function makeSphere(r, seg) {
    const g = new THREE.SphereGeometry(r, seg || 64, (seg || 64) / 2);
    return g;
  }

  function createBody(def, parent) {
    const isMoon = !!parent;
    const visR = isMoon ? Math.max(0.12, radVis(def.radiusKm) * 0.55)
      : (def.id === 'sun' ? SUN_R : (def.comet ? 0.62 : radVis(def.radiusKm)));
    const tex = buildTexture(def.tex, isMoon, def.radiusKm);

    const root = new THREE.Group();          // 位置节点
    const tilt = new THREE.Group();          // 轴倾角
    tilt.rotation.z = -(def.rot ? def.rot.tilt : 0) * DEG;
    root.add(tilt);

    let mesh;
    if (tex.earth) {
      const uni = {
        dayMap: { value: tex.day }, nightMap: { value: tex.night }, specMap: { value: tex.spec },
        sunDir: { value: new THREE.Vector3(1, 0, 0) }, camPos: { value: new THREE.Vector3() }
      };
      mesh = new THREE.Mesh(makeSphere(visR, 128), new THREE.ShaderMaterial({
        uniforms: uni, vertexShader: earthVert, fragmentShader: earthFrag
      }));
      mesh.userData.earthUniforms = uni;

      const cm = new THREE.Mesh(makeSphere(visR * 1.012, 96), new THREE.ShaderMaterial({
        uniforms: { map: { value: tex.clouds }, sunDir: uni.sunDir },
        vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false
      }));
      cm.userData.isClouds = true;
      mesh.userData.clouds = cm;
      tilt.add(cm);

      const atmo = new THREE.Mesh(makeSphere(visR * 1.045, 64), atmosphereMaterial(0x4a8fe8, 3.4, 0.9));
      tilt.add(atmo);
      tilt.userData.atmo = atmo;
    } else {
      const mat = new THREE.MeshStandardMaterial({
        map: tex.map, roughness: def.id === 'sun' ? 1 : 0.92, metalness: 0.0,
        emissive: def.id === 'sun' ? 0xffffff : 0x000000,
        emissiveMap: def.id === 'sun' ? tex.map : null,
        emissiveIntensity: def.id === 'sun' ? 1.0 : 0
      });
      if (def.id === 'sun') {
        mat.color.set(0xffffff);
        mat.emissive.set(0xffffff);
        mat.emissiveIntensity = 0.95;
      }
      mesh = new THREE.Mesh(makeSphere(visR, isMoon ? 48 : 96), mat);
      if (def.id === 'sun') {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texFromCanvas(window.TEX.makeGlow('rgba(255,250,230,1)', 'rgba(255,168,52,0.5)', 512)),
          blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
        }));
        glow.scale.set(visR * 3.6, visR * 3.6, 1);
        tilt.add(glow);
        const glow2 = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texFromCanvas(window.TEX.makeGlow('rgba(255,240,200,0.95)', 'rgba(255,140,30,0.35)', 512)),
          blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
        }));
        glow2.scale.set(visR * 1.85, visR * 1.85, 1);
        tilt.add(glow2);
      }
      if (def.id === 'titan') {
        const atmo = new THREE.Mesh(makeSphere(visR * 1.12, 40), atmosphereMaterial(0xd99a44, 2.6, 1.1));
        tilt.add(atmo);
      }
      if (def.id === 'triton') {
        const atmo = new THREE.Mesh(makeSphere(visR * 1.06, 32), atmosphereMaterial(0x9fc4e0, 3.0, 0.35));
        tilt.add(atmo);
      }
    }
    mesh.userData.body = null;
    tilt.add(mesh);
    root.add(tilt);

    // 行星环
    let ring = null;
    if (def.ring) {
      const inner = visR * (def.ringStyle === 'faint' ? 1.6 : 1.24);
      const outer = visR * (def.ringStyle === 'faint' ? 2.0 : 2.32);
      const rg = new THREE.RingGeometry(inner, outer, 160, 4);
      const pos = rg.attributes.position, uv = rg.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      const rt = texFromCanvas(window.TEX.makeRing({ style: def.ringStyle || 'saturn' }));
      rt.wrapT = THREE.ClampToEdgeWrapping;
      const rm = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        map: rt, transparent: true, side: THREE.DoubleSide,
        opacity: def.ringStyle === 'faint' ? 0.5 : 1, depthWrite: false
      }));
      rm.rotation.x = -Math.PI / 2;
      tilt.add(rm);
      ring = rm;
    }

    const body = {
      def: def, name: def.name, en: def.en, id: def.id,
      radiusKm: def.radiusKm, visR: visR,
      root: root, tilt: tilt, mesh: mesh, ring: ring, parent: parent || null,
      moons: [], children: [], spin: def.rot ? def.rot.period : (def.periodDays || 1), spinAngle: 0,
      orbitLine: null, moonOrbitLines: [], isMoon: isMoon, isComet: !!def.comet,
      world: new THREE.Vector3()
    };
    mesh.userData.body = body;
    root.userData.body = body;
    if (def.comet) buildCometFX(body);
    return body;
  }

  /* ---------------- 彗星：彗发 + 双尾 ---------------- */
  const _cv1 = new THREE.Vector3(), _cv2 = new THREE.Vector3();
  const ZAXIS = new THREE.Vector3(0, 0, 1);
  const cometVert = `
    varying float vT;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vT = position.z;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vV = -mv.xyz;
      vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mv;
    }
  `;
  const cometFrag = `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vT;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float t = clamp(vT, 0.0, 1.0);
      float fade = pow(1.0 - t, 1.8);
      // 侧影边缘柔化，避免锥体出现硬直边
      float edge = smoothstep(0.02, 0.62, abs(dot(normalize(vN), normalize(vV))));
      gl_FragColor = vec4(uColor, fade * edge * uOpacity);
    }
  `;

  function buildCometFX(body) {
    const T = window.TEX;
    const r = body.visR;

    // 彗发（两层叠加）
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texFromCanvas(T.makeGlow('rgba(240,253,255,0.95)', 'rgba(130,208,255,0.34)', 256)),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9
    }));
    body.tilt.add(coma);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texFromCanvas(T.makeGlow('rgba(190,235,255,0.32)', 'rgba(90,170,255,0.12)', 256)),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5
    }));
    body.tilt.add(halo);

    // 尾体：圆锥顶点在原点，向 +Z 延伸，纵向 alpha 衰减
    const tailGroup = new THREE.Group();
    body.root.add(tailGroup);

    const geo = new THREE.ConeGeometry(1, 1, 30, 1, true);
    geo.translate(0, -0.5, 0);
    geo.rotateX(-Math.PI / 2);

    function cone(color, w, len, rx, rz, op) {
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: op } },
        vertexShader: cometVert, fragmentShader: cometFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      }));
      mesh.rotation.x = rx; mesh.rotation.z = rz;
      mesh.userData.baseW = w; mesh.userData.baseL = len; mesh.userData.baseOp = op;
      mesh.scale.set(w, w, len);
      tailGroup.add(mesh);
      return mesh;
    }

    const ion = body.def.tail ? body.def.tail.ion : '#7fd0ff';
    const dust = body.def.tail ? body.def.tail.dust : '#ffe6bb';
    const tails = [];
    // 离子尾：细长、直、偏蓝
    tails.push(cone(ion, 2.6, 82, 0, 0, 0.34));
    tails.push(cone(ion, 5.2, 68, 0.012, 0.02, 0.2));
    tails.push(cone(ion, 9.0, 54, -0.02, -0.015, 0.13));
    // 尘埃尾：短而宽、偏黄白、略微弯散
    tails.push(cone(dust, 7, 42, 0.05, 0.02, 0.24));
    tails.push(cone(dust, 12, 33, -0.045, 0.03, 0.17));
    tails.push(cone(dust, 16, 26, 0.085, -0.04, 0.11));
    tails.push(cone(dust, 9, 48, -0.02, -0.01, 0.1));

    body.coma = coma;
    body.halo = halo;
    body.tailGroup = tailGroup;
    body.tails = tails;
    body.act = 0;
  }

  /* ============================================================
     5. 组装太阳系
     ============================================================ */
  async function buildSolarSystem(onProgress) {
    const step = async (msg, p) => {
      onProgress(msg, p);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    };

    let done = 0;
    const total = 1 + window.PLANETS.length + window.PLANETS.reduce((a, p) => a + (p.moons ? p.moons.length : 0), 0)
      + ((window.COMETS || []).length);

    // 太阳
    await step('生成太阳表面（米粒组织）', 0);
    const sun = createBody(window.SUN_DATA, null);
    scene.add(sun.root);
    sun.root.position.set(0, 0, 0);
    bodies.push(sun); byId.sun = sun; pickables.push(sun.mesh);
    done++;

    for (const p of window.PLANETS) {
      await step(`生成 ${p.name} 表面贴图（${p.typeLabel}）`, done / total);
      const b = createBody(p, null);
      scene.add(b.root);
      bodies.push(b); byId[p.id] = b; pickables.push(b.mesh);
      done++;

      // 轨道线
      const pts = orbitPoints(p.orbit, 512);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: new THREE.Color(p.color), transparent: true, opacity: 0.42, depthWrite: false
      }));
      line.userData.orbitOf = b;
      scene.add(line);
      b.orbitLine = line;

      // 卫星
      if (p.moons) {
        for (const m of p.moons) {
          await step(`生成 ${m.name} 表面贴图`, done / total);
          const mb = createBody(m, b);
          b.tilt.add(mb.root);
          b.moons.push(mb);
          bodies.push(mb); byId[m.id] = mb; pickables.push(mb.mesh);
          done++;
          // 卫星轨道虚线
          const mr = moonDist(p.radiusKm, m.distKm, b.visR);
          mb.orbitR = mr;
          const cps = [];
          const seg = 96;
          for (let i = 0; i <= seg; i++) {
            const a = i / seg * Math.PI * 2;
            cps.push(new THREE.Vector3(Math.cos(a) * mr, 0, Math.sin(a) * mr));
          }
          const mg = new THREE.BufferGeometry().setFromPoints(cps);
          const ml = new THREE.Line(mg, new THREE.LineBasicMaterial({
            color: 0x8fb4e8, transparent: true, opacity: 0.22, depthWrite: false
          }));
          b.tilt.add(ml);
          mb.orbitLine = ml;
          b.moonOrbitLines.push(ml);
        }
      }
    }
    // 彗星
    for (const c of (window.COMETS || [])) {
      await step(`生成 ${c.name} 彗核与彗尾`, done / total);
      const b = createBody(c, null);
      scene.add(b.root);
      bodies.push(b); byId[c.id] = b; pickables.push(b.mesh);
      done++;

      const pts = orbitPointsE(c.orbit, 1000);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
        color: new THREE.Color(c.color), transparent: true, opacity: 0.5,
        dashSize: 5.5, gapSize: 4.5, depthWrite: false
      }));
      line.computeLineDistances();
      line.userData.orbitOf = b;
      scene.add(line);
      b.orbitLine = line;
    }

    await step('点亮星空', 1);
    buildLabels();
    updatePositions(0);
  }

  /* ============================================================
     6. 标签
     ============================================================ */
  function buildLabels() {
    const layer = $('#labels');
    for (const b of bodies) {
      const el = document.createElement('div');
      el.className = 'lbl' + (b.isMoon ? ' lbl-moon' : '');
      el.innerHTML = '<i style="background:' + (b.def.color || '#9db4d0') + '"></i><span>' + b.name + '</span>';
      el.addEventListener('click', (ev) => { ev.stopPropagation(); selectBody(b, true); });
      layer.appendChild(el);
      labels.push({ el: el, body: b });
    }
  }

  const _v = new THREE.Vector3();
  const _occA = new THREE.Vector3(), _occB = new THREE.Vector3();
  let _occluders = null;
  // 相机 → 天体 的视线是否被更大的天体挡住（简单球-线段相交）
  function occludedByBody(b, camPos) {
    if (b === state.selected) return false;
    if (!_occluders) _occluders = bodies.filter((o) => !o.isMoon && !o.isComet);
    const tgt = b.world;
    _occA.copy(tgt).sub(camPos);
    const len = _occA.length();
    if (len < 1e-3) return false;
    _occA.divideScalar(len);
    for (let i = 0; i < _occluders.length; i++) {
      const o = _occluders[i];
      if (o === b || o === b.parent) continue;
      const r = o.visR;
      if (r < 0.35) continue;
      _occB.copy(o.world).sub(camPos);
      const t = _occB.dot(_occA);
      if (t <= 0 || t >= len) continue;
      const perp2 = _occB.lengthSq() - t * t;
      if (perp2 < r * r * 0.8) return true;
    }
    return false;
  }

  function updateLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    const sel = state.selected;
    const arr = [];
    for (const L of labels) {
      const b = L.body;
      let visible = state.showLabels;
      if (b.isMoon) visible = visible && !!sel && (sel === b.parent || sel === b || sel.parent === b.parent);
      if (!visible) { L.el.style.display = 'none'; continue; }
      b.root.getWorldPosition(_v);
      const d = camera.position.distanceTo(_v);
      _v.project(camera);
      if (_v.z > 1) { L.el.style.display = 'none'; continue; }
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      if (x < -50 || x > w + 50 || y < -24 || y > h + 24 || d > 2600) {
        L.el.style.display = 'none'; continue;
      }
      // 被前方天体遮挡的标签不显示（避免标签浮在别的星球上）
      if (occludedByBody(b, camera.position)) { L.el.style.display = 'none'; continue; }
      // 已聚焦且靠得很近时，天体本身占满视野，不再重复标注
      if (b === sel && d < b.visR * (IS_MOBILE ? 10 : 8)) { L.el.style.display = 'none'; continue; }
      arr.push({ L: L, b: b, x: x, y: y, d: d });
    }
    // 重要天体优先占位，避免标签互相叠压
    arr.sort(function (a, b2) {
      const ma = a.b.isMoon ? 1 : 0, mb = b2.b.isMoon ? 1 : 0;
      if (ma !== mb) return ma - mb;
      return a.d - b2.d;
    });
    const placed = [];
    for (const it of arr) {
      const cw = IS_MOBILE ? 10.2 : 12.5;
      const wpx = it.b.name.length * cw + 15, hpx = IS_MOBILE ? 13 : 15;
      let hit = false;
      for (const p of placed) {
        if (Math.abs(p.x - it.x) < (p.w + wpx) / 2 && Math.abs(p.y - it.y) < (p.h + hpx) / 2) { hit = true; break; }
      }
      if (hit && sel !== it.b && !(sel && sel.parent === it.b)) {
        it.L.el.style.display = 'none'; continue;
      }
      placed.push({ x: it.x, y: it.y, w: wpx, h: hpx });
      it.L.el.style.display = 'block';
      it.L.el.style.transform = 'translate(-50%,-50%) translate(' + it.x.toFixed(1) + 'px,' + it.y.toFixed(1) + 'px)';
      it.L.el.style.opacity = it.b.isMoon ? 0.72 : clamp(1.15 - it.d / 3200, 0.25, 1);
      it.L.el.classList.toggle('lbl-sel', sel === it.b);
    }
    updatePinLabel();
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ============================================================
     7. 位置更新
     ============================================================ */
  function updatePositions(dt) {
    const d = state.simDays;
    const dDays = state.playing ? state.speed * dt : 0;
    const maxSpin = 0.95 * dt;   // 视觉自转上限，避免高速时变成模糊

    // 太阳自转
    const sun = byId.sun;
    sun.spinAngle += clamp((dDays / sun.spin) * Math.PI * 2, -maxSpin, maxSpin);
    sun.mesh.rotation.y = sun.spinAngle;

    for (const p of window.PLANETS) {
      const b = byId[p.id];
      const k = kepler(p.orbit, d);
      const s = distVis(k.r) / k.r;
      b.root.position.set(k.x * s, k.y * s, k.z * s);
      b.root.getWorldPosition(b.world);
      const cap = (b.id === 'earth' && state.pin) ? maxSpin * 0.05 : maxSpin;
      b.spinAngle += clamp((dDays / b.spin) * Math.PI * 2, -cap, cap);
      b.mesh.rotation.y = b.spinAngle;
    }
    // 彗星：开普勒位置 + 彗尾永远背向太阳，活度随日心距变化
    for (const c of (window.COMETS || [])) {
      const b = byId[c.id];
      if (!b) continue;
      const k = kepler(c.orbit, d);
      const s = distVis(k.r) / k.r;
      b.root.position.set(k.x * s, k.y * s, k.z * s);
      b.root.getWorldPosition(b.world);
      b.spinAngle += clamp((dDays / b.spin) * Math.PI * 2, -maxSpin, maxSpin);
      b.mesh.rotation.y = b.spinAngle;

      const act = clamp(0.95 / Math.pow(Math.max(0.4, k.r), 1.45), 0, 1);
      b.act = act;
      _cv1.copy(b.world).normalize();                 // 背离太阳的方向
      b.tailGroup.quaternion.setFromUnitVectors(ZAXIS, _cv1);

      const r = b.visR;
      b.coma.scale.setScalar(r * (3.2 + 14 * act));
      b.coma.material.opacity = 0.22 + 0.78 * act;
      b.halo.scale.setScalar(r * (9 + 30 * act));
      b.halo.material.opacity = 0.1 + 0.38 * act;

      for (const t of b.tails) {
        const w = t.userData.baseW * (0.5 + 0.5 * act);
        const L = t.userData.baseL * (0.18 + 0.82 * act);
        t.scale.set(w, w, L);
        t.material.uniforms.uOpacity.value = t.userData.baseOp * (0.12 + 0.88 * act);
      }
    }

    // 卫星公转 + 潮汐锁定自转
    for (const b of bodies) {
      if (!b.isMoon) continue;
      const md = b.def;
      const ang = (d / md.periodDays) * Math.PI * 2 + (md.id.charCodeAt(0) % 7);
      const incl = (md.incl || 0) * DEG * 0.6;
      b.root.position.set(
        Math.cos(ang) * b.orbitR,
        Math.sin(ang) * b.orbitR * Math.sin(incl) * 0.4,
        Math.sin(ang) * b.orbitR * Math.cos(incl)
      );
      b.root.getWorldPosition(b.world);
      b.mesh.rotation.y = -ang;
    }
  }

  /* ============================================================
     8. 相机控制
     ============================================================ */
  const cam = {
    target: new THREE.Vector3(0, 0, 0),
    desired: new THREE.Vector3(0, 0, 0),
    dist: 380, desiredDist: 380,
    theta: 0.7, phi: 1.05,
    dTheta: 0, dPhi: 0
  };
  const _look = new THREE.Vector3();

  function initControls() {
    const el = renderer.domElement;
    let dragging = false, moved = 0, lastX = 0, lastY = 0, downTime = 0;
    const pointers = new Map();
    let pinchDist = 0;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; downTime = performance.now();
      } else if (pointers.size === 2) {
        const a = [...pointers.values()];
        pinchDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      }
      hideHint();
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const a = [...pointers.values()];
        const nd = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinchDist > 0) cam.desiredDist = clamp(cam.desiredDist * (pinchDist / nd), 2, 4000);
        pinchDist = nd;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.theta -= dx * 0.0055;
      cam.phi = clamp(cam.phi - dy * 0.0045, 0.12, Math.PI - 0.12);
      state.userMoved = true;
    });
    el.addEventListener('pointerup', (e) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      dragging = false;
      if (pinchDist) pinchDist = 0;
      if (wasSingle && moved < (e.pointerType === 'touch' ? 11 : 6) && performance.now() - downTime < 700) {
        handleClick(e.clientX, e.clientY);
      }
    });
    el.addEventListener('pointercancel', () => { pointers.clear(); dragging = false; });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.0011);
      cam.desiredDist = clamp(cam.desiredDist * k, 1.2, 4200);
      state.userMoved = true;
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'Escape') { clearSelection(); }
    });
  }

  function updateCamera(dt) {
    if (state.follow) {
      state.follow.root.getWorldPosition(_v);
      cam.desired.copy(_v);
    }
    const lerpK = 1 - Math.pow(0.0015, dt);
    cam.target.lerp(cam.desired, lerpK);
    cam.dist += (cam.desiredDist - cam.dist) * (1 - Math.pow(0.002, dt));

    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    const x = cam.dist * sp * Math.sin(cam.theta);
    const y = cam.dist * cp;
    const z = cam.dist * sp * Math.cos(cam.theta);
    camera.position.set(cam.target.x + x, cam.target.y + y, cam.target.z + z);

    // 移动端底部面板展开时，把目标点下移，让天体显示在未被遮挡的上半屏
    const sheet = IS_MOBILE ? document.getElementById('right') : null;
    if (sheet && !sheet.classList.contains('hide')) {
      _look.copy(cam.target);
      _look.y -= cam.dist * 0.26;
      camera.lookAt(_look);
    } else {
      camera.lookAt(cam.target);
    }
  }

  /* ============================================================
     9. 选择 / 聚焦
     ============================================================ */
  function selectBody(b, focus) {
    const same = state.follow === b;
    state.selected = b;
    state.follow = b;
    const prev = document.querySelector('.body-item.active');
    if (prev) prev.classList.remove('active');
    const item = document.querySelector('.body-item[data-id="' + b.id + '"]');
    if (item) {
      item.classList.add('active');
      const parentLi = item.closest('.body-group');
      if (parentLi) parentLi.classList.add('open');
    }
    for (const ob of bodies) {
      if (ob.orbitLine) ob.orbitLine.material.opacity = (ob === b) ? 0.85 : (ob.isMoon ? 0.14 : 0.22);
    }
    if (b.orbitLine && b.isMoon) b.orbitLine.material.opacity = 0.5;
    const rp = document.getElementById('right');
    if (rp) rp.classList.remove('hide');
    renderInfo(b);
    if (focus && !same) focusOn(b);
  }

  function focusOn(b) {
    state.follow = b;
    const d = b.visR === SUN_R ? SUN_R * 3.4
      : (b.isComet ? 86 : (b.ring ? b.visR * 8.2 : Math.max(b.visR * 5.5, b.isMoon ? 2.2 : 6)));
    cam.desiredDist = d;
    if (b.isMoon && b.parent) {
      cam.desiredDist = Math.max(b.visR * 8.5, 1.6);
    }
    // 把相机放到被照亮的一侧，避免只看到夜面
    const anchor = b.isMoon && b.parent ? b.parent : b;
    const wp = anchor.root.getWorldPosition(new THREE.Vector3());
    let dir;
    if (wp.lengthSq() < 1e-6) dir = new THREE.Vector3(0, 0.35, 1).normalize();
    else dir = wp.clone().multiplyScalar(-1).normalize();
    // 有环行星：把相机抬高到环面之上，保证能看到完整光环
    if (b.isComet) {
      // 彗星：从侧面看，才能同时看到受光的彗发与背向太阳的彗尾
      const az = Math.atan2(dir.x, dir.z) + 1.2;
      dir.set(Math.sin(az), 0.34, Math.cos(az)).normalize();
    } else if (b.ring || (b.parent && b.parent.ring)) {
      const ringBody = b.ring ? b : b.parent;
      const q2 = new THREE.Quaternion();
      ringBody.tilt.getWorldQuaternion(q2);
      const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(q2).normalize();
      dir = dir.clone().multiplyScalar(0.55).add(pole.multiplyScalar(0.85)).normalize();
    } else {
      dir.y += 0.42;
      dir.normalize();
    }
    cam.theta = Math.atan2(dir.x, dir.z);
    cam.phi = Math.acos(clamp(dir.y, -1, 1));
    if (b.isComet) {
      const kk = kepler(b.def.orbit, state.simDays);
      if (kk.r > 8) showToast('此时彗星距太阳 ' + kk.r.toFixed(1) + ' AU，彗尾尚未发育');
    }
  }

  function clearSelection() {
    state.selected = null;
    state.follow = null;
    renderInfo(null);
    document.querySelectorAll('.body-item.active').forEach((e) => e.classList.remove('active'));
  }

  /* ============================================================
     10. 点击拾取
     ============================================================ */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function handleClick(cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const meshes = pickables.filter((m) => m.parent && m.visible);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return;
    const hit = hits[0];
    const b = hit.object.userData.body;
    if (!b) return;
    selectBody(b, true);
    if (b.id === 'earth') {
      setEarthPin(hit.point);
    }
  }

  /* ============================================================
     11. 地球经纬度
     ============================================================ */
  function vecToLL(v) {
    const r = v.length();
    const lat = Math.asin(clamp(v.y / r, -1, 1)) * RAD;
    let lon = Math.atan2(v.z, -v.x) * RAD - 180;
    while (lon < -180) lon += 360;
    while (lon > 180) lon -= 360;
    return { lat: lat, lon: lon };
  }
  function llToVec(lat, lon, r) {
    const phi = (90 - lat) * DEG, theta = (lon + 180) * DEG;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }

  function ensureMarker() {
    if (markerGroup) return markerGroup;
    markerGroup = new THREE.Group();
    const r = earthMesh.userData.body.visR;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.062, r * 0.092, 40),
      new THREE.MeshBasicMaterial({ color: 0x35e0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false })
    );
    ring.position.z = 0.001;
    markerGroup.add(ring);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.02, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    markerGroup.add(dot);
    // 光柱
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.006, r * 0.006, r * 0.24, 8),
      new THREE.MeshBasicMaterial({ color: 0x66eaff, transparent: true, opacity: 0.75, depthWrite: false })
    );
    beam.rotation.x = Math.PI / 2;
    beam.position.z = r * 0.12;
    markerGroup.add(beam);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.14, r * 0.16, 48),
      new THREE.MeshBasicMaterial({ color: 0x35e0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false })
    );
    halo.position.z = 0.001;
    markerGroup.add(halo);
    earthMesh.add(markerGroup);
    return markerGroup;
  }

  function setEarthPin(worldPoint) {
    if (!earthMesh) return;
    const local = earthMesh.worldToLocal(worldPoint.clone());
    const ll = vecToLL(local);
    state.pin = ll;
    const r = earthMesh.userData.body.visR;
    const dir = local.clone().normalize();
    const g = ensureMarker();
    g.position.copy(dir.clone().multiplyScalar(r * 1.002));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    g.visible = true;
    updateEarthReadout(ll);
    state.pinWorld = g.getWorldPosition(new THREE.Vector3());
  }

  function setPinByLatLon(lat, lon) {
    const r = earthMesh.userData.body.visR;
    const local = llToVec(lat, lon, r * 1.002);
    const g = ensureMarker();
    g.position.copy(local);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), local.clone().normalize());
    state.pin = { lat: lat, lon: lon };
    updateEarthReadout(state.pin);
  }

  function updatePinLabel() {
    const el = $('#pinlabel');
    if (!el) return;
    if (!state.pin || !markerGroup || !markerGroup.visible || state.selected !== byId.earth) { el.style.display = 'none'; return; }
    markerGroup.getWorldPosition(_v);
    _v.project(camera);
    if (_v.z > 1) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.transform = 'translate(-50%,-140%) translate(' + ((_v.x * 0.5 + 0.5) * window.innerWidth).toFixed(1) + 'px,' + ((-_v.y * 0.5 + 0.5) * window.innerHeight).toFixed(1) + 'px)';
    el.textContent = fmtLat(state.pin.lat) + '  ' + fmtLon(state.pin.lon);
  }

  function fmtLat(v) { return Math.abs(v).toFixed(2) + '° ' + (v >= 0 ? 'N 北纬' : 'S 南纬'); }
  function fmtLon(v) { return Math.abs(v).toFixed(2) + '° ' + (v >= 0 ? 'E 东经' : 'W 西经'); }

  /* ---- 国家/大洲判定 ---- */
  function ringContains(ring, lon, lat) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  const CONT_ZH = { asia: '亚洲', europe: '欧洲', africa: '非洲', namerica: '北美洲', samerica: '南美洲', oceania: '大洋洲', antarctica: '南极洲' };

  function locate(lat, lon) {
    const W = window.WORLD;
    for (let i = 0; i < W.countries.length; i++) {
      const c = W.countries[i];
      for (let j = 0; j < c.r.length; j++) {
        if (ringContains(c.r[j], lon, lat)) {
          return { land: true, country: c.n, countryEn: c.e, continent: CONT_ZH[c.c] || c.c, cid: c.c };
        }
      }
    }
    return { land: false, ocean: oceanName(lat, lon) };
  }

  function oceanName(lat, lon) {
    if (lat < -60) return '南大洋（南冰洋）';
    if (lat > 66) return '北冰洋';
    if (lon > 20 && lon < 147 && lat < 30) return '印度洋';
    if (lon >= -70 && lon <= 20) return '大西洋';
    if (lon > -100 && lon < -70 && lat > 8) return '加勒比海 / 墨西哥湾';
    if (lon > 100 && lon < 130 && lat > -12 && lat < 25) return '南海 / 西太平洋';
    if (lon > 30 && lon < 45 && lat > 12 && lat < 30) return '红海 / 阿拉伯海';
    return '太平洋';
  }

  /* ============================================================
     12. 地表信息面板
     ============================================================ */
  let miniBase = null;
  function drawMiniMap(lat, lon) {
    const cv = $('#minimap');
    if (!cv) return;
    const W = cv.width, H = cv.height;
    const ctx = cv.getContext('2d');
    if (!miniBase) {
      miniBase = document.createElement('canvas');
      miniBase.width = W; miniBase.height = H;
      const bx = miniBase.getContext('2d');
      bx.fillStyle = '#0a1626'; bx.fillRect(0, 0, W, H);
      // 经纬网
      bx.strokeStyle = 'rgba(90,140,190,0.18)'; bx.lineWidth = 1;
      for (let i = 1; i < 12; i++) {
        bx.beginPath(); bx.moveTo(W * i / 12, 0); bx.lineTo(W * i / 12, H); bx.stroke();
      }
      for (let i = 1; i < 6; i++) {
        bx.beginPath(); bx.moveTo(0, H * i / 6); bx.lineTo(W, H * i / 6); bx.stroke();
      }
      const T = window.TEX;
      bx.fillStyle = '#2f6b46';
      T.drawWorldPaths(bx, W, H, '#2f6b46', 'rgba(120,200,150,0.35)', 0.6);
      bx.strokeStyle = 'rgba(120,200,150,0.5)';
      bx.lineWidth = 1;
      bx.strokeRect(0.5, 0.5, W - 1, H - 1);
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(miniBase, 0, 0);
    if (!lat && lat !== 0) return;
    const x = (lon + 180) / 360 * W, y = (90 - lat) / 180 * H;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.2832);
    ctx.fillStyle = 'rgba(53,224,255,0.18)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.2832);
    ctx.fillStyle = '#35e0ff'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x - 7, y);
    ctx.moveTo(x + 7, y); ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 7);
    ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 14);
    ctx.strokeStyle = 'rgba(53,224,255,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
  }

  function updateEarthReadout(ll) {
    const g = (id) => document.getElementById(id);
    if (!g('cv-lat')) { drawMiniMap(null); return; }
    const info = locate(ll.lat, ll.lon);
    g('cv-lat').textContent = fmtLat(ll.lat);
    g('cv-lon').textContent = fmtLon(ll.lon);
    const nsH = ll.lat >= 0 ? '北半球' : '南半球';
    const ewH = ll.lon >= 0 ? '东半球' : '西半球';
    g('cv-hemi').innerHTML = nsH + ' · ' + ewH + '<small>' + (ll.lon >= 0 ? '东经' : '西经') + ' / ' + (ll.lat >= 0 ? '北纬' : '南纬') + '</small>';
    g('cv-cont').textContent = info.land ? info.continent : info.ocean;
    g('cv-cont').className = 'v ' + (info.land ? 'land' : 'sea');
    g('cv-country').textContent = info.land ? info.country + '（' + info.countryEn + '）' : '海洋区域';
    const tz = Math.round(ll.lon / 15);
    const el = g('cv-tz');
    if (el) el.textContent = 'UTC' + (tz >= 0 ? '+' : '') + tz + ' 区时';
    drawMiniMap(ll.lat, ll.lon);
  }

  /* ============================================================
     13. 信息面板
     ============================================================ */
  function renderInfo(b) {
    const box = $('#info');
    if (!b) {
      box.innerHTML = `
        <div class="empty-info">
          <div class="ei-icon">✦</div>
          <h3>太阳系探索器</h3>
          <p>拖动旋转视角，滚轮缩放。点击任意天体查看详细信息。</p>
          <ul class="ei-tips">
            <li><b>地球模式</b>：选中地球后点击地表任意位置，可查看经纬度、半球、大洲与国家。</li>
            <li><b>时间控制</b>：底部滑块可加速或倒放行星公转。</li>
            <li><b>卫星</b>：展开左侧行星可查看其卫星（共收录 ${countMoons()} 颗主要卫星）。</li>
            <li><b>彗星</b>：哈雷彗星沿极扁的逆行轨道运行，近日点会拉出长长的彗尾——点开后可直接跳到 1986 年与 2061 年。</li>
          </ul>
        </div>`;
      return;
    }
    const d = b.def;
    const stats = (d.stats || []).map((s) => '<div class="srow"><span>' + s[0] + '</span><b>' + s[1] + '</b></div>').join('');
    const facts = (d.facts || []).map((f) => '<li>' + f + '</li>').join('');
    const moonChips = (b.moons && b.moons.length)
      ? '<div class="sec"><h4>卫星（' + b.moons.length + '）</h4><div class="chips">' +
      b.moons.map((m) => '<button class="chip" data-moon="' + m.id + '">' + m.name + '</button>').join('') + '</div></div>'
      : '';
    const parentLink = b.isMoon && b.parent
      ? '<button class="backlink" data-parent="' + b.parent.id + '">← 返回 ' + b.parent.name + '</button>' : '';

    let earth = '';
    if (d.id === 'earth') {
      earth = `
      <div class="sec earth-mod">
        <h4>地表坐标拾取 <span class="hint">点击地球表面任意位置</span></h4>
        <div class="coord">
          <div class="crow"><label>纬度</label><b id="cv-lat">--</b></div>
          <div class="crow"><label>经度</label><b id="cv-lon">--</b></div>
          <div class="crow"><label>半球</label><b class="v" id="cv-hemi">--</b></div>
          <div class="crow"><label>大洲 / 海洋</label><b class="v" id="cv-cont">--</b></div>
          <div class="crow full"><label>国家 / 地区</label><b class="v" id="cv-country">--</b></div>
          <div class="crow"><label>约略时区</label><b class="v" id="cv-tz">--</b></div>
        </div>
        <canvas id="minimap" width="520" height="260"></canvas>
        <div class="chips cont-chips">
          ${window.WORLD.continents.map((c) => '<button class="chip" data-cont="' + c.id + '" data-lat="' + c.lat + '" data-lon="' + c.lon + '">' + c.zh + '</button>').join('')}
        </div>
      </div>`;
    }

    let comet = '';
    if (d.comet) {
      const jdL = d.perihelion ? jdFromDate(d.perihelion.last) : 0;
      const jdN = d.perihelion ? jdFromDate(d.perihelion.next) : 0;
      comet = `
      <div class="sec comet-mod">
        <h4>实时状态 <span class="hint">随下方时间轴变化</span></h4>
        <div class="sgrid">
          <div class="srow"><span>日心距</span><b id="cm-r">--</b></div>
          <div class="srow"><span>距地球</span><b id="cm-e">--</b></div>
          <div class="srow"><span>轨道速度</span><b id="cm-v">--</b></div>
        </div>
        <div class="chips" style="margin-top:11px">
          <button class="chip" data-jd="${jdL}" data-tip="1986 年 2 月 9 日 · 近日点">跳到 1986 年近日点</button>
          <button class="chip" data-jd="${jdN}" data-tip="2061 年 7 月 28 日 · 近日点">跳到 2061 年回归</button>
          <button class="chip" data-whole="1">看完整轨道</button>
        </div>
      </div>`;
    }

    box.innerHTML = `
      <div class="info-head">
        <div class="ih-title"><h2>${d.name}</h2><span>${d.en}</span></div>
        <div class="ih-tags"><span class="tag">${d.typeLabel || '卫星'}</span>${b.isMoon ? '<span class="tag sm">' + b.parent.name + '的卫星</span>' : ''}</div>
      </div>
      ${parentLink}
      ${earth}
      ${comet}
      <div class="sec"><div class="sgrid">${stats}</div></div>
      <div class="sec"><h4>简介</h4><p class="desc">${d.desc}</p></div>
      ${d.facts ? '<div class="sec"><h4>冷知识</h4><ul class="facts">' + facts + '</ul></div>' : ''}
      ${moonChips}
    `;

    box.querySelectorAll('[data-whole]').forEach((el) => {
      el.addEventListener('click', () => {
        state.follow = null; state.selected = b;
        cam.desired.set(0, 0, 0);
        cam.desiredDist = 1500; cam.phi = 0.2; cam.theta = 0.9;
        showToast('整条哈雷轨道：近日 0.59 AU，远日 35 AU');
      });
    });
    box.querySelectorAll('[data-jd]').forEach((el) => {
      el.addEventListener('click', () => {
        state.simDays = parseFloat(el.dataset.jd) - J2000;
        state.follow = b;
        if (state.playing) togglePlay();
        focusOn(b);
        updateCometLive(b);
        showToast('已定位到 ' + el.dataset.tip);
      });
    });
    if (d.comet) updateCometLive(b);

    box.querySelectorAll('[data-moon]').forEach((el) => {
      el.addEventListener('click', () => { const m = byId[el.dataset.moon]; if (m) selectBody(m, true); });
    });
    const bl = box.querySelector('[data-parent]');
    if (bl) bl.addEventListener('click', () => selectBody(byId[bl.dataset.parent], true));

    if (d.id === 'earth') {
      box.querySelectorAll('[data-cont]').forEach((el) => {
        el.addEventListener('click', () => {
          const lat = parseFloat(el.dataset.lat), lon = parseFloat(el.dataset.lon);
          jumpToLL(lat, lon, el.textContent);
        });
      });
      drawMiniMap(state.pin ? state.pin.lat : null, state.pin ? state.pin.lon : null);
      if (state.pin) updateEarthReadout(state.pin);
      else drawMiniMap(null);
    }
    box.scrollTop = 0;
  }

  function countMoons() {
    let n = 0;
    window.PLANETS.forEach((p) => n += (p.moons ? p.moons.length : 0));
    return n;
  }

  function jdFromDate(s) {
    const a = s.split('-');
    return Date.UTC(+a[0], +a[1] - 1, +a[2]) / 86400000 + 2440587.5;
  }

  // 彗星实时状态：日心距 / 地心距 / 轨道速度（活力公式）
  function updateCometLive(b) {
    const elR = document.getElementById('cm-r');
    if (!elR) return;
    const o = b.def.orbit;
    const k = kepler(o, state.simDays);
    let de = '—';
    const e = byId.earth;
    if (e) {
      const ke = kepler(e.def.orbit, state.simDays);
      de = Math.hypot(k.x - ke.x, k.y - ke.y, k.z - ke.z).toFixed(3) + ' AU';
    }
    const v = 29.7847 * Math.sqrt(Math.max(0, 2 / k.r - 1 / o.a));
    elR.textContent = k.r.toFixed(3) + ' AU';
    const elE = document.getElementById('cm-e');
    const elV = document.getElementById('cm-v');
    if (elE) elE.textContent = de;
    if (elV) elV.textContent = v.toFixed(2) + ' km/s';
  }

  function jumpToLL(lat, lon, label) {
    const earth = byId.earth;
    if (!earth || !earthMesh) return;
    earth.root.getWorldPosition(_v);
    // 让该点转到"正午"位置（面向太阳），保证被照亮的半球正好朝向相机
    const sunDir = _v.clone().multiplyScalar(-1).normalize();
    const q = new THREE.Quaternion();
    earth.tilt.getWorldQuaternion(q);
    q.invert();
    const tLocal = sunDir.clone().applyQuaternion(q).normalize();
    const p = llToVec(lat, lon, 1);
    earth.spinAngle = Math.atan2(tLocal.x, tLocal.z) - Math.atan2(p.x, p.z);
    earthMesh.rotation.y = earth.spinAngle;
    earthMesh.updateMatrixWorld(true);

    setPinByLatLon(lat, lon);

    const wp = earthMesh.localToWorld(llToVec(lat, lon, earth.visR).clone());
    const dir = wp.sub(_v).normalize();
    state.follow = earth;
    cam.desired.copy(_v);
    cam.desiredDist = earth.visR * 4.2;
    cam.theta = Math.atan2(dir.x, dir.z);
    cam.phi = Math.acos(clamp(dir.y, -1, 1));
    showToast(label + ' · ' + fmtLat(lat) + ' ' + fmtLon(lon));
  }

  /* ============================================================
     14. UI
     ============================================================ */
  function buildSidebar() {
    const list = $('#bodylist');
    const html = [];

    function itemHtml(d, cls) {
      const hasMoons = d.moons && d.moons.length;
      let h = '<div class="body-group' + (hasMoons ? ' has-moons' : '') + '">';
      h += '<div class="body-item ' + cls + '" data-id="' + d.id + '">' +
        '<span class="dot" style="background:' + (d.color || '#9db4d0') + '"></span>' +
        '<span class="nm">' + d.name + '</span>' +
        (hasMoons ? '<span class="cnt">' + d.moons.length + '</span><span class="arw">›</span>' : '') +
        '</div>';
      if (hasMoons) {
        h += '<div class="moons">' + d.moons.map((m) =>
          '<div class="body-item moon" data-id="' + m.id + '"><span class="mi"></span>' + m.name + '</div>').join('') + '</div>';
      }
      h += '</div>';
      return h;
    }

    html.push(itemHtml(window.SUN_DATA, 'star'));
    for (const p of window.PLANETS) html.push(itemHtml(p, p.type));
    if ((window.COMETS || []).length) {
      html.push('<div class="side-sep">彗星 · 小天体</div>');
      for (const c of window.COMETS) html.push(itemHtml(c, 'comet'));
    }
    list.innerHTML = html.join('');

    list.querySelectorAll('.body-item').forEach((el) => {
      el.addEventListener('click', (ev) => {
        const b = byId[el.dataset.id];
        if (!b) return;
        const grp = el.closest('.body-group');
        if (grp && grp.classList.contains('has-moons')) {
          if (ev.target.classList.contains('arw') || ev.target.classList.contains('cnt')) {
            grp.classList.toggle('open');
            return;
          }
          grp.classList.add('open');
        }
        selectBody(b, true);
      });
    });
  }

  function initToolbar() {
    const toggles = [
      ['btn-labels', 'showLabels', true],
      ['btn-orbits', 'showOrbits', true],
      ['btn-belt', 'showBelt', true]
    ];
    toggles.forEach(([id, key, def]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('off', !state[key]);
      el.addEventListener('click', () => {
        state[key] = !state[key];
        el.classList.toggle('off', !state[key]);
        applyToggles();
      });
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      state.follow = null; clearSelection();
      cam.desired.set(0, 0, 0);
      cam.desiredDist = 380;
      cam.theta = 0.7; cam.phi = 1.02;
    });
    document.getElementById('btn-view').addEventListener('click', () => {
      // 俯视黄道面
      cam.phi = 0.16; cam.desiredDist = 780; state.follow = null; cam.desired.set(0, 0, 0);
    });
  }

  function applyToggles() {
    for (const b of bodies) {
      if (b.orbitLine) b.orbitLine.visible = state.showOrbits;
      if (b.moonOrbitLines) b.moonOrbitLines.forEach((l) => l.visible = true);
    }
    if (belt) belt.visible = state.showBelt;
    if (kuiper) kuiper.visible = state.showBelt;
  }

  function initTimeBar() {
    const slider = $('#speed');
    const label = $('#speedlabel');
    const playBtn = $('#play');
    const setFromSlider = () => {
      const v = parseFloat(slider.value);
      state.speed = Math.pow(10, -1.6 + v / 1000 * 5.2);
      label.textContent = fmtSpeed(state.speed);
    };
    slider.addEventListener('input', setFromSlider);
    slider.value = 470;
    setFromSlider();

    playBtn.addEventListener('click', togglePlay);
    document.getElementById('now').addEventListener('click', () => {
      state.simDays = Date.now() / 86400000 + 2440587.5 - J2000;
      showToast('已回到当前时刻');
    });
    document.getElementById('rev').addEventListener('click', () => {
      state.speed = -state.speed;
      label.textContent = fmtSpeed(state.speed);
      state.playing = true; playBtn.textContent = '暂停'; playBtn.classList.remove('paused');
    });
  }

  function togglePlay() {
    state.playing = !state.playing;
    const btn = $('#play');
    btn.textContent = state.playing ? '暂停' : '继续';
    btn.classList.toggle('paused', !state.playing);
  }

  function fmtSpeed(v) {
    const a = Math.abs(v);
    let s;
    if (a < 1 / 24) s = (a * 24).toFixed(2) + ' 小时/秒';
    else if (a < 40) s = a.toFixed(2) + ' 天/秒';
    else if (a < 400) s = (a / 30.44).toFixed(1) + ' 月/秒';
    else s = (a / 365.25).toFixed(1) + ' 年/秒';
    return (v < 0 ? '倒放 · ' : '') + s;
  }

  function updateDate() {
    const dt = new Date((state.simDays + J2000 - 2440587.5) * 86400000);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    $('#date').textContent = y + ' 年 ' + m + ' 月 ' + d + ' 日';
  }

  let toastTimer = null;
  let liveT = 0;
  function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function hideHint() {
    const h = $('#hint');
    if (h && !h.classList.contains('gone')) { h.classList.add('gone'); }
  }

  /* ============================================================
     15. 主循环
     ============================================================ */
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (state.playing) state.simDays += state.speed * dt;

    updatePositions(dt);
    updateCamera(dt);

    // 地球光照方向
    if (earthMesh) {
      const u = earthMesh.userData.earthUniforms;
      const wp = earthMesh.getWorldPosition(new THREE.Vector3());
      u.sunDir.value.copy(wp).multiplyScalar(-1).normalize();
      u.camPos.value.copy(camera.position);
      if (earthMesh.userData.clouds) earthMesh.userData.clouds.rotation.y += dt * 0.004;
    }

    if (belt) belt.rotation.y += dt * 0.004;
    if (kuiper) kuiper.rotation.y += dt * 0.0008;

    updateLabels();
    updateDate();
    if (state.selected && state.selected.def && state.selected.def.comet) {
      liveT += dt;
      if (liveT > 0.35) { liveT = 0; updateCometLive(state.selected); }
    }
    renderer.render(scene, camera);
  }

  /* ============================================================
     15.5 移动端交互（抽屉 / 底部面板 / 切回桌面版）
     ============================================================ */
  function initMobileUI() {
    const left = document.getElementById('left');
    const mask = document.getElementById('drawer-mask');
    const menu = document.getElementById('btn-menu');

    function setDrawer(open) {
      left.classList.toggle('open', open);
      mask.classList.toggle('show', open);
    }
    if (menu) menu.addEventListener('click', () => setDrawer(!left.classList.contains('open')));
    if (mask) mask.addEventListener('click', () => setDrawer(false));

    // 点选天体后收起抽屉（展开卫星的箭头除外）
    left.addEventListener('click', (e) => {
      if (!IS_MOBILE) return;
      const item = e.target.closest('.body-item');
      if (!item) return;
      if (e.target.classList.contains('arw') || e.target.classList.contains('cnt')) return;
      setTimeout(() => setDrawer(false), 140);
    });

    // 切回桌面版（需要重载，布局与贴图精度都不同）
    const dbtn = document.getElementById('to-desktop');
    if (dbtn) {
      dbtn.addEventListener('click', () => {
        // 只改 hash 不会重载，而桌面版需要按桌面精度重建贴图，所以强制刷新
        location.replace(location.pathname + location.search + '#desktop');
        location.reload();
      });
    }

    // 底部面板：下拉手柄关闭
    const sheet = document.getElementById('right');
    const handle = document.getElementById('sheet-handle');
    let sy = 0, dy = 0, swiping = false;
    handle.addEventListener('pointerdown', (e) => {
      swiping = true; sy = e.clientY; dy = 0;
      sheet.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!swiping) return;
      dy = Math.max(-4, e.clientY - sy);
      sheet.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
    });
    function endSwipe() {
      if (!swiping) return;
      swiping = false;
      sheet.classList.remove('dragging');
      const h = sheet.getBoundingClientRect().height;
      if (dy > Math.min(80, h * 0.2)) sheet.classList.add('hide');
      sheet.style.transform = '';
      dy = 0;
    }
    handle.addEventListener('pointerup', endSwipe);
    handle.addEventListener('pointercancel', endSwipe);
  }

  /* ============================================================
     16. 启动
     ============================================================ */
  async function main() {
    initScene();
    initControls();
    initMobileUI();
    buildSidebar();
    initToolbar();
    initTimeBar();

    state.simDays = Date.now() / 86400000 + 2440587.5 - J2000;

    const bar = $('#loadbar'), lt = $('#loadtext');
    await buildSolarSystem((msg, p) => {
      lt.textContent = msg;
      bar.style.width = Math.round(p * 100) + '%';
    });
    earthMesh = byId.earth.mesh;
    earthGroup = byId.earth.tilt;

    await new Promise((r) => setTimeout(r, 220));
    $('#loading').classList.add('hide');
    setTimeout(() => { const l = $('#loading'); if (l) l.style.display = 'none'; }, 900);

    renderInfo(null);
    animate();

    const rp0 = document.getElementById('right');
    const ic0 = document.getElementById('info-close');
    if (ic0 && rp0) ic0.addEventListener('click', () => rp0.classList.add('hide'));
    if (IS_MOBILE && rp0) rp0.classList.add('hide');

    if (IS_MOBILE) {
      const h = $('#hint');
      if (h) h.innerHTML = '<b>拖动</b>旋转 · <b>双指</b>缩放 · <b>点天体</b>看资料 · <b>☰</b>天体列表';
    }

    // 开场视角：略俯视内太阳系
    if (IS_MOBILE) {
      cam.dist = 1180; cam.desiredDist = 540; cam.phi = 0.98;
    } else {
      cam.dist = 900; cam.desiredDist = 380;
    }
    setTimeout(() => { $('#hint').classList.remove('gone'); }, 600);
    setTimeout(hideHint, 9000);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 非强制模式下，窄窗口自动切到移动端布局
    if (MODE === null) {
      const m = window.innerWidth <= 900;
      if (m !== IS_MOBILE) {
        IS_MOBILE = m;
        document.documentElement.classList.toggle('is-mobile', m);
      }
    }
  });

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }, 260);
  });

  window.addEventListener('DOMContentLoaded', main);
})();
