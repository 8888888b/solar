/* ============================================================
   程序化贴图引擎
   - 可平铺噪声（x 方向无缝），用于球面 UV
   - 地球：真实海岸线 + 纬度/内陆度驱动的生物群系 + 城市灯光
   - 气态行星：条带 + 湍流扰动
   - 岩质天体：陨石坑、月海、极冠
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function ihash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    h = h ^ h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  // 周期值噪声（x 方向周期 px）
  function vnoise(x, y, px, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x0 = ((xi % px) + px) % px, x1 = (((xi + 1) % px) + px) % px;
    const a = ihash(x0, yi, seed), b = ihash(x1, yi, seed);
    const c = ihash(x0, yi + 1, seed), d = ihash(x1, yi + 1, seed);
    const top = a + (b - a) * u;
    const bot = c + (d - c) * u;
    return top + (bot - top) * v;
  }

  function fbm(x, y, px, oct, seed, gain) {
    gain = gain === undefined ? 0.5 : gain;
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += amp * vnoise(x * f, y * f, px * f, seed + i * 17);
      norm += amp;
      amp *= gain; f *= 2;
    }
    return sum / norm;
  }

  // 生成 float 噪声场（x 方向可平铺）
  function noiseField(w, h, freq, oct, seed, yScale) {
    const f = new Float32Array(w * h);
    const sc = 2 / w;                 // 每像素对应的 u 增量 * 2
    const ys = yScale || 1;
    for (let y = 0; y < h; y++) {
      const yy = y / h * freq * 0.5 * ys;
      for (let x = 0; x < w; x++) {
        const xx = x * sc * freq;
        f[y * w + x] = fbm(xx, yy, freq, oct, seed);
      }
    }
    return f;
  }

  function bilinear(f, w, h, u, v) {
    let x = u * w - 0.5, y = v * h - 0.5;
    let x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    let x1 = x0 + 1, y1 = y0 + 1;
    x0 = ((x0 % w) + w) % w; x1 = ((x1 % w) + w) % w;
    y0 = Math.min(h - 1, Math.max(0, y0)); y1 = Math.min(h - 1, Math.max(0, y1));
    const a = f[y0 * w + x0], b = f[y0 * w + x1];
    const c = f[y1 * w + x0], d = f[y1 * w + x1];
    const t = a + (b - a) * fx, bt = c + (d - c) * fx;
    return t + (bt - t) * fy;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }

  /* ---------------- 地球 ---------------- */
  // lon/lat -> 像素；贴图横向：lon -180 在 u=0
  function lon2x(lon, W) { return (lon + 180) / 360 * W; }
  function lat2y(lat, H) { return (90 - lat) / 180 * H; }

  function drawWorldPaths(ctx, W, H, fillStyle, strokeStyle, lw) {
    const W_ = global.WORLD;
    ctx.fillStyle = fillStyle || '#fff';
    if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.lineWidth = lw || 1; }
    ctx.beginPath();
    for (let i = 0; i < W_.countries.length; i++) {
      const rings = W_.countries[i].r;
      for (let j = 0; j < rings.length; j++) {
        const r = rings[j];
        ctx.moveTo(lon2x(r[0][0], W), lat2y(r[0][1], H));
        for (let k = 1; k < r.length; k++) {
          ctx.lineTo(lon2x(r[k][0], W), lat2y(r[k][1], H));
        }
        ctx.closePath();
      }
    }
    ctx.fill('evenodd');
    if (strokeStyle) ctx.stroke();
  }

  function makeEarth(W, H) {
    W = W || 4096; H = H || 2048;

    /* 1. 陆地掩膜 + 内陆深度 */
    const mc = canvas(W, H), mx = mc.getContext('2d');
    mx.fillStyle = '#000'; mx.fillRect(0, 0, W, H);
    drawWorldPaths(mx, W, H, '#fff', null);
    const mask = mx.getImageData(0, 0, W, H).data;

    // 模糊后的内陆度图（海岸 0.5 → 内陆趋近 1）
    const dw = 1024, dh = 512;
    const dc = canvas(dw, dh), dx = dc.getContext('2d');
    dx.fillStyle = '#000'; dx.fillRect(0, 0, dw, dh);
    dx.filter = 'blur(14px)';
    drawWorldPaths(dx, dw, dh, '#fff', null);
    dx.filter = 'none';
    const depth = dx.getImageData(0, 0, dw, dh).data;

    /* 2. 噪声场 */
    const nMot = noiseField(512, 256, 14, 5, 7);
    const nDet = noiseField(512, 256, 48, 4, 31);
    const nBig = noiseField(512, 256, 5, 3, 91);
    const nCity = noiseField(512, 256, 26, 4, 55);

    /* 3. 逐像素着色 */
    const oc = canvas(W, H), ox = oc.getContext('2d');
    const img = ox.createImageData(W, H);
    const d = img.data;
    const ice = [236, 243, 250], snow = [220, 230, 240];
    const desert1 = [196, 168, 112], desert2 = [172, 132, 78];
    const grass = [56, 106, 52], grass2 = [84, 124, 56], jungle = [26, 78, 36];
    const taiga = [46, 76, 56], rock = [116, 108, 96], tundra = [106, 108, 88];
    const deepSea = [8, 32, 68], sea = [13, 52, 96], shallow = [30, 92, 132];

    for (let y = 0; y < H; y++) {
      const lat = 90 - (y + 0.5) / H * 180;
      const alat = Math.abs(lat);
      const v = (y + 0.5) / H;
      const cosl = Math.max(0.05, Math.cos(lat * Math.PI / 180));
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const mi = (y * W + x) * 4;
        const land = mask[mi] > 110;
        const dep = depth[((y * dh / H | 0) * dw + (x * dw / W | 0)) * 4] / 255;
        const n1 = bilinear(nMot, 512, 256, u, v);
        const n2 = bilinear(nDet, 512, 256, u, v);
        const n3 = bilinear(nBig, 512, 256, u, v);

        let r, g, b;
        if (land) {
          const aridBand = Math.exp(-Math.pow((alat - 25) / 11, 2));
          const aridity = clamp(aridBand * 0.58 + (dep - 0.66) * 1.15 + (n1 - 0.5) * 0.7 + (n3 - 0.5) * 0.42, 0, 1);
          const tropic = smooth(18, 2, alat);
          // 基底植被
          let cr = lerp(grass[0], jungle[0], tropic), cg = lerp(grass[1], jungle[1], tropic), cb = lerp(grass[2], jungle[2], tropic);
          // 荒漠
          const dd = smooth(0.60, 0.90, aridity);
          cr = lerp(cr, lerp(desert1[0], desert2[0], n2), dd);
          cg = lerp(cg, lerp(desert1[1], desert2[1], n2), dd);
          cb = lerp(cb, lerp(desert1[2], desert2[2], n2), dd);
          // 泰加林 / 苔原
          const cold = smooth(50, 66, alat);
          cr = lerp(cr, lerp(taiga[0], tundra[0], smooth(60, 72, alat)), cold);
          cg = lerp(cg, lerp(taiga[1], tundra[1], smooth(60, 72, alat)), cold);
          cb = lerp(cb, lerp(taiga[2], tundra[2], smooth(60, 72, alat)), cold);
          // 高山裸岩
          const mtn = smooth(0.66, 0.86, n2 * 0.6 + dep * 0.6);
          cr = lerp(cr, rock[0], mtn * 0.55); cg = lerp(cg, rock[1], mtn * 0.55); cb = lerp(cb, rock[2], mtn * 0.55);
          // 雪帽：高纬 + 南极洲 + 格陵兰
          const snowLine = 71 - n2 * 6;
          const sf = smooth(snowLine, snowLine + 7, alat) * (0.65 + n2 * 0.5);
          const sf2 = (lat < -62 ? 1 : 0) * smooth(0.35, 0.75, dep + n2 * 0.3);
          const s = Math.max(sf, sf2);
          cr = lerp(cr, snow[0] + n2 * 12, s); cg = lerp(cg, snow[1] + n2 * 12, s); cb = lerp(cb, snow[2] + n2 * 8, s);

          // 细节颗粒
          const grain = (n2 - 0.5) * 26 + (n1 - 0.5) * 18;
          r = cr + grain; g = cg + grain; b = cb + grain * 0.8;
        } else {
          // 海洋：近岸浅色 + 深海
          const coast = smooth(0.30, 0.06, dep);
          const t2 = clamp(coast * 0.9 + (n1 - 0.5) * 0.35, 0, 1);
          r = lerp(deepSea[0], shallow[0], t2 * 0.9);
          g = lerp(deepSea[1], shallow[1], t2 * 0.9);
          b = lerp(deepSea[2], shallow[2], t2 * 0.9);
          // 高纬海冰
          const si = smooth(72 - n2 * 8, 80, alat);
          r = lerp(r, 226, si); g = lerp(g, 236, si); b = lerp(b, 245, si);
          const grain = (n2 - 0.5) * 8;
          r += grain; g += grain; b += grain;
        }
        d[mi] = r; d[mi + 1] = g; d[mi + 2] = b; d[mi + 3] = 255;
      }
    }
    ox.putImageData(img, 0, 0);

    /* 4. 夜间灯光 */
    const nc = canvas(W / 2, H / 2), nx = nc.getContext('2d');
    nx.fillStyle = '#05070d'; nx.fillRect(0, 0, nc.width, nc.height);
    nx.globalCompositeOperation = 'lighter';
    const rnd = mulberry32(2024);
    for (let i = 0; i < 16000; i++) {
      const px = rnd() * nc.width, py = rnd() * nc.height;
      const lat = 90 - (py / nc.height) * 180;
      const u = px / nc.width, v = py / nc.height;
      // 只画在陆地上
      const mi = ((py * 2 | 0) * W + (px * 2 | 0)) * 4;
      if (mask[mi] < 110) continue;
      const pop = bilinear(nCity, 512, 256, u, v) * (1 - smooth(55, 72, Math.abs(lat))) * (1 - smooth(0.55, 0.95, bilinear(nBig, 512, 256, u, v)));
      if (rnd() > pop * 1.5) continue;
      const rr = 0.32 + rnd() * 1.5 * pop;
      const g2 = nx.createRadialGradient(px, py, 0, px, py, rr * 2.4);
      g2.addColorStop(0, 'rgba(255,234,186,0.92)');
      g2.addColorStop(0.3, 'rgba(255,196,120,0.34)');
      g2.addColorStop(1, 'rgba(255,170,80,0)');
      nx.fillStyle = g2;
      nx.beginPath(); nx.arc(px, py, rr * 2.4, 0, 6.2832); nx.fill();
    }
    // 少量城市群光晕
    for (let i = 0; i < 70; i++) {
      const px = rnd() * nc.width, py = rnd() * nc.height;
      const mi = ((py * 2 | 0) * W + (px * 2 | 0)) * 4;
      if (mask[mi] < 110) continue;
      const rr = 5 + rnd() * 11;
      const g2 = nx.createRadialGradient(px, py, 0, px, py, rr);
      g2.addColorStop(0, 'rgba(255,214,150,0.2)');
      g2.addColorStop(1, 'rgba(255,190,120,0)');
      nx.fillStyle = g2;
      nx.beginPath(); nx.arc(px, py, rr, 0, 6.2832); nx.fill();
    }

    /* 5. 云层（透明贴图） */
    const cw = 2048, ch = 1024;
    const cc = canvas(cw, ch), cx2 = cc.getContext('2d');
    const ci = cx2.createImageData(cw, ch);
    const cd = ci.data;
    const nCl1 = noiseField(512, 256, 8, 6, 401, 5.5);
    const nCl2 = noiseField(512, 256, 22, 5, 733, 4.5);
    for (let y = 0; y < ch; y++) {
      const lat = 90 - (y + 0.5) / ch * 180;
      const alat = Math.abs(lat);
      const v = (y + 0.5) / ch;
      // 赤道辐合带 + 中纬度气旋带
      const zone = 0.90 + 0.10 * Math.cos((lat + 8) * Math.PI / 24) + 0.06 * Math.cos(lat * Math.PI / 11);
      for (let x = 0; x < cw; x++) {
        const u = (x + 0.5) / cw;
        const a = bilinear(nCl1, 512, 256, u, v);
        const b = bilinear(nCl2, 512, 256, u, v);
        let t = (a * 0.74 + b * 0.42) * zone - 0.42;
        t = clamp(t * 2.6, 0, 1);
        const al = Math.pow(t, 1.5) * 225;
        const i = (y * cw + x) * 4;
        cd[i] = 255; cd[i + 1] = 255; cd[i + 2] = 255; cd[i + 3] = al;
      }
    }
    cx2.putImageData(ci, 0, 0);

    /* 6. 高光/凹凸贴图（低分辨率，画路径即可） */
    const sw = 1024, sh = 512;
    const sc2 = canvas(sw, sh), sx = sc2.getContext('2d');
    sx.fillStyle = '#1a1a1a'; sx.fillRect(0, 0, sw, sh);
    drawWorldPaths(sx, sw, sh, '#d8d8d8', null);

    return { day: oc, night: nc, clouds: cc, spec: sc2 };
  }

  /* ---------------- 太阳 ---------------- */
  function makeSun(W, H) {
    W = W || 2048; H = H || 1024;
    const c = canvas(W, H), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffcf6a');
    g.addColorStop(0.5, '#ff9d24');
    g.addColorStop(1, '#ffcf6a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    const n1 = noiseField(512, 256, 24, 6, 1201);
    const n2 = noiseField(512, 256, 80, 4, 1301);
    const img = x.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let i2 = 0; i2 < W; i2++) {
        const u = (i2 + 0.5) / W;
        const a = bilinear(n1, 512, 256, u, v);
        const b = bilinear(n2, 512, 256, u, v);
        const t = (a * 0.6 + b * 0.55);
        const i = (y * W + i2) * 4;
        d[i] = clamp(d[i] * (0.72 + t * 0.62), 0, 255);
        d[i + 1] = clamp(d[i + 1] * (0.66 + t * 0.6), 0, 255);
        d[i + 2] = clamp(d[i + 2] * (0.5 + t * 0.55), 0, 255);
      }
    }
    x.putImageData(img, 0, 0);

    // 黑子
    const rnd = mulberry32(55);
    for (let i = 0; i < 10; i++) {
      const px = rnd() * W, py = H * (0.22 + rnd() * 0.56), r = 6 + rnd() * 26;
      const rg = x.createRadialGradient(px, py, 0, px, py, r);
      rg.addColorStop(0, 'rgba(70,26,0,0.85)');
      rg.addColorStop(0.6, 'rgba(140,60,0,0.55)');
      rg.addColorStop(1, 'rgba(200,110,10,0)');
      x.fillStyle = rg;
      x.beginPath(); x.ellipse(px, py, r * 1.6, r, rnd() * 3, 0, 6.2832); x.fill();
    }
    return c;
  }

  /* ---------------- 岩质天体 ---------------- */
  function makeRocky(o) {
    const W = o.W || 2048, H = o.H || 1024;
    const rnd = mulberry32(o.seed || 1);
    const c = canvas(W, H), x = c.getContext('2d');
    const base = hex(o.base || '#9a917f');
    const base2 = hex(o.base2 || '#6d6558');

    x.fillStyle = o.base || '#9a917f';
    x.fillRect(0, 0, W, H);

    // 大尺度斑驳
    const n1 = noiseField(512, 256, 6, 4, (o.seed || 1) + 5);
    const n2 = noiseField(512, 256, 40, 5, (o.seed || 1) + 9);
    const img = x.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let i2 = 0; i2 < W; i2++) {
        const u = (i2 + 0.5) / W;
        const a = bilinear(n1, 512, 256, u, v);
        const b = bilinear(n2, 512, 256, u, v);
        const t = a * 0.7 + b * 0.42;
        const i = (y * W + i2) * 4;
        d[i] = clamp(lerp(d[i], base2[0], (1 - a) * 0.45) + (t - 0.5) * 34, 0, 255);
        d[i + 1] = clamp(lerp(d[i + 1], base2[1], (1 - a) * 0.45) + (t - 0.5) * 32, 0, 255);
        d[i + 2] = clamp(lerp(d[i + 2], base2[2], (1 - a) * 0.45) + (t - 0.5) * 30, 0, 255);
      }
    }
    x.putImageData(img, 0, 0);

    // 暗色区域（月海 / 火星反照率特征）
    if (o.maria || o.darkAmt) {
      const amt = o.darkAmt || 0.42;
      x.globalAlpha = amt;
      x.fillStyle = o.dark || '#3f3c38';
      for (let i = 0; i < 40; i++) {
        const px = rnd() * W, py = H * (0.16 + rnd() * 0.68);
        const rx = (40 + rnd() * 190) * (W / 2048), ry = rx * (0.45 + rnd() * 0.75);
        const offs = [0];
        if (px < rx) offs.push(W); else if (px > W - rx) offs.push(-W);
        for (let oi = 0; oi < offs.length; oi++) {
          x.save();
          x.translate(px + offs[oi], py);
          x.scale(1, ry / rx);
          const rg = x.createRadialGradient(0, 0, 0, 0, 0, rx);
          rg.addColorStop(0, 'rgba(0,0,0,0.62)');
          rg.addColorStop(0.5, 'rgba(0,0,0,0.32)');
          rg.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = rg;
          x.beginPath(); x.arc(0, 0, rx, 0, 6.2832); x.fill();
          x.restore();
        }
      }
      x.globalAlpha = 1;
    }

    // 双色（土卫八）
    if (o.twoTone) {
      x.fillStyle = 'rgba(28,24,20,0.82)';
      x.beginPath();
      x.moveTo(W * 0.06, 0); x.lineTo(W * 0.52, 0); x.lineTo(W * 0.5, H); x.lineTo(W * 0.04, H); x.closePath();
      x.fill();
      const lg = x.createLinearGradient(W * 0.42, 0, W * 0.56, 0);
      lg.addColorStop(0, 'rgba(28,24,20,0)'); lg.addColorStop(0.5, 'rgba(28,24,20,0.6)'); lg.addColorStop(1, 'rgba(28,24,20,0)');
      x.fillStyle = lg; x.fillRect(W * 0.4, 0, W * 0.18, H);
    }

    // 极冠
    if (o.iceCap) {
      [0, 1].forEach(function (k) {
        const g2 = x.createLinearGradient(0, k ? H : 0, 0, k ? H * (1 - o.iceCap) : H * o.iceCap);
        g2.addColorStop(0, 'rgba(246,249,255,0.95)');
        g2.addColorStop(0.55, 'rgba(238,243,252,0.62)');
        g2.addColorStop(1, 'rgba(236,242,252,0)');
        x.fillStyle = g2;
        x.fillRect(0, k ? H * (1 - o.iceCap) : 0, W, H * o.iceCap);
      });
    }
    if (o.polarCap) {
      const g2 = x.createRadialGradient(W * 0.5, 0, 0, W * 0.5, 0, H * 0.34);
      g2.addColorStop(0, o.polarCap); g2.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g2; x.fillRect(0, 0, W, H * 0.34);
    }

    // 心形亮区（冥王星）
    if (o.heart) {
      x.save();
      x.translate(W * 0.62, H * 0.56);
      x.rotate(-0.25);
      x.scale(1, 0.86);
      const hg = x.createRadialGradient(0, 0, 0, 0, 0, W * 0.075);
      hg.addColorStop(0, 'rgba(246,238,222,0.95)');
      hg.addColorStop(0.65, 'rgba(232,220,198,0.75)');
      hg.addColorStop(1, 'rgba(220,205,180,0)');
      x.fillStyle = hg;
      x.beginPath(); x.arc(0, 0, W * 0.075, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(W * 0.05, -W * 0.005, W * 0.048, 0, 6.2832); x.fill();
      x.restore();
    }

    // 陨石坑（跨贴图接缝时补画，避免出现明显的竖直接缝）
    const resS = W / 2048;
    const nCr = Math.round((o.craters || 500) * resS * 1.55);
    const cScale = o.craterScale || 1;
    for (let i = 0; i < nCr; i++) {
      const lat = (rnd() * 2 - 1) * 86;
      const lon = rnd() * 360 - 180;
      const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
      const rr = (0.65 + Math.pow(rnd(), 2.3) * 9.5) * resS * 2.3 * cScale;
      const ry = Math.max(0.55, rr);
      const rx = Math.min(ry / cos, ry * 3.6, W * 0.07);
      const px = lon2x(lon, W), py = lat2y(lat, H);
      const isBig = ry > 12 * resS * 2.3 * cScale;
      const a0 = rnd() * 6.28, rayOn = rnd();
      const offs = [0];
      if (px < rx) offs.push(W); else if (px > W - rx) offs.push(-W);
      for (let oi = 0; oi < offs.length; oi++) {
        x.save();
        x.translate(px + offs[oi], py);
        x.scale(rx / ry, 1);
        const g3 = x.createRadialGradient(-ry * 0.18, -ry * 0.2, ry * 0.08, 0, 0, ry);
        g3.addColorStop(0, 'rgba(0,0,0,0.17)');
        g3.addColorStop(0.7, 'rgba(0,0,0,0.09)');
        g3.addColorStop(0.94, 'rgba(255,255,255,0.06)');
        g3.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g3;
        x.beginPath(); x.arc(0, 0, ry, 0, 6.2832); x.fill();
        if (ry > 1.2) {
          x.strokeStyle = 'rgba(255,255,255,0.09)';
          x.lineWidth = Math.max(0.5, ry * 0.12);
          x.beginPath(); x.arc(0, 0, ry * 0.95, 0, 6.2832); x.stroke();
        }
        if (isBig && rayOn > 0.72) {
          x.strokeStyle = 'rgba(255,255,255,0.05)';
          x.lineWidth = ry * 0.15;
          for (let k = 0; k < 4; k++) {
            const ang = a0 + k * 1.7;
            const len = 1.8 + ((k * 37) % 10) / 10;
            x.beginPath();
            x.moveTo(Math.cos(ang) * ry, Math.sin(ang) * ry);
            x.lineTo(Math.cos(ang) * ry * len, Math.sin(ang) * ry * len);
            x.stroke();
          }
        }
        x.restore();
      }
    }
    // 亮点（卡里斯托的冰质撞击点）
    if (o.bright) {
      for (let i = 0; i < 260; i++) {
        const px = rnd() * W, py = H * (0.08 + rnd() * 0.84);
        const r = 1 + rnd() * 4;
        x.fillStyle = 'rgba(240,245,255,' + (0.25 + rnd() * 0.5) + ')';
        x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
      }
    }
    return c;
  }

  /* ---------------- 气态行星 ---------------- */
  function makeGas(o) {
    const W = o.W || 2048, H = o.H || 1024;
    const pal = o.palette.map(hex);
    const rnd = mulberry32(o.seed || 1);
    const c = canvas(W, H), x = c.getContext('2d');
    const img = x.createImageData(W, H);
    const d = img.data;

    const bands = o.bands || 26;
    const turb = o.turb === undefined ? 1 : o.turb;
    const nWarp = noiseField(512, 256, 7, 5, (o.seed || 1) + 3);
    const nFine = noiseField(512, 256, 34, 4, (o.seed || 1) + 11);
    const nBig = noiseField(512, 256, 3, 3, (o.seed || 1) + 23);

    // 行颜色查找表
    const rows = new Float32Array(H * 3);
    for (let y = 0; y < H; y++) {
      const t = (y + 0.5) / H;
      const latN = (t - 0.5) * 2; // -1..1
      let s = 0.5 + 0.5 * Math.sin(latN * bands * 1.2 + Math.sin(latN * 5.3) * 0.9);
      s = clamp(s * 1.15 - 0.05, 0, 1);
      const fi = s * (pal.length - 1);
      const i0 = Math.floor(fi), fr = fi - i0;
      const c0 = pal[i0], c1 = pal[Math.min(pal.length - 1, i0 + 1)];
      let r = lerp(c0[0], c1[0], fr), g = lerp(c0[1], c1[1], fr), b = lerp(c0[2], c1[2], fr);
      // 极区变暗
      const pole = smooth(0.62, 1.0, Math.abs(latN));
      r = lerp(r, r * 0.62, pole); g = lerp(g, g * 0.66, pole); b = lerp(b, b * 0.72, pole);
      rows[y * 3] = r; rows[y * 3 + 1] = g; rows[y * 3 + 2] = b;
    }

    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let i2 = 0; i2 < W; i2++) {
        const u = (i2 + 0.5) / W;
        const w1 = bilinear(nWarp, 512, 256, u, v) - 0.5;
        const w2 = bilinear(nBig, 512, 256, u, v) - 0.5;
        // 沿纬度方向扰动，产生涡旋条带
        let yy = y + (w1 * 14 + w2 * 27) * turb;
        const fine = bilinear(nFine, 512, 256, u, v) - 0.5;
        yy += fine * 5 * turb;
        yy = clamp(yy, 0, H - 1);
        const y0 = yy | 0, y1 = Math.min(H - 1, y0 + 1), fy = yy - y0;
        const i = (y * W + i2) * 4;
        const sh = 1 + fine * 0.22;
        d[i] = clamp(lerp(rows[y0 * 3], rows[y1 * 3], fy) * sh, 0, 255);
        d[i + 1] = clamp(lerp(rows[y0 * 3 + 1], rows[y1 * 3 + 1], fy) * sh, 0, 255);
        d[i + 2] = clamp(lerp(rows[y0 * 3 + 2], rows[y1 * 3 + 2], fy) * sh, 0, 255);
        d[i + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);

    // 大红斑
    if (o.storm) {
      const px = W * 0.66, py = H * 0.635, rx = W * 0.075, ry = H * 0.052;
      x.save(); x.translate(px, py);
      const g2 = x.createRadialGradient(0, 0, 0, 0, 0, rx);
      g2.addColorStop(0, 'rgba(196,96,52,0.95)');
      g2.addColorStop(0.55, 'rgba(178,104,68,0.75)');
      g2.addColorStop(0.85, 'rgba(200,160,120,0.35)');
      g2.addColorStop(1, 'rgba(220,200,170,0)');
      x.fillStyle = g2;
      x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, 6.2832); x.fill();
      // 内部涡旋
      x.strokeStyle = 'rgba(150,70,40,0.35)';
      for (let k = 1; k < 6; k++) {
        x.lineWidth = 2;
        x.beginPath();
        x.ellipse(0, 0, rx * k / 6, ry * k / 6, 0, 0.3, 2.6);
        x.stroke();
      }
      x.restore();
    }
    if (o.darkSpot) {
      const px = W * 0.3, py = H * 0.42, rx = W * 0.05, ry = H * 0.032;
      const g2 = x.createRadialGradient(px, py, 0, px, py, rx);
      g2.addColorStop(0, 'rgba(10,24,70,0.9)');
      g2.addColorStop(0.7, 'rgba(20,44,110,0.6)');
      g2.addColorStop(1, 'rgba(30,60,140,0)');
      x.fillStyle = g2;
      x.beginPath(); x.ellipse(px, py, rx, ry, 0, 0, 6.2832); x.fill();
    }
    if (o.streaks) {
      for (let i = 0; i < 60; i++) {
        const py = H * (0.15 + rnd() * 0.7);
        const px = rnd() * W;
        const w = 20 + rnd() * 130, h = 2 + rnd() * 5;
        x.fillStyle = 'rgba(235,245,255,' + (0.10 + rnd() * 0.25) + ')';
        x.beginPath(); x.ellipse(px, py, w, h, 0, 0, 6.2832); x.fill();
      }
    }
    return c;
  }

  /* ---------------- 云雾世界（金星 / 泰坦） ---------------- */
  function makeCloudy(o) {
    const W = o.W || 2048, H = o.H || 1024;
    const base = hex(o.base || '#e7d3a0');
    const base2 = hex(o.base2 || '#c9a86a');
    const c = canvas(W, H), x = c.getContext('2d');
    const img = x.createImageData(W, H);
    const d = img.data;
    const n1 = noiseField(512, 256, 6, 5, (o.seed || 1) + 2);
    const n2 = noiseField(512, 256, 22, 5, (o.seed || 1) + 6);
    const sw = o.swirl === undefined ? 1 : o.swirl;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      const lat = (v - 0.5) * Math.PI;
      for (let i2 = 0; i2 < W; i2++) {
        const u = (i2 + 0.5) / W;
        const a = bilinear(n1, 512, 256, u, v);
        const b = bilinear(n2, 512, 256, u + a * 0.06 * sw, v + (a - 0.5) * 0.12);
        let t = a * 0.62 + b * 0.5;
        t = clamp((t - 0.35) * 1.9, 0, 1);
        const i = (y * W + i2) * 4;
        const pole = Math.pow(Math.abs(Math.sin(lat)), 3);
        d[i] = clamp(lerp(base2[0], base[0], t) * (1 - pole * 0.25) + 6, 0, 255);
        d[i + 1] = clamp(lerp(base2[1], base[1], t) * (1 - pole * 0.25) + 4, 0, 255);
        d[i + 2] = clamp(lerp(base2[2], base[2], t) * (1 - pole * 0.28) + 2, 0, 255);
        d[i + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  /* ---------------- 冰世界（欧罗巴 / 恩克拉多斯 / 特里同） ---------------- */
  function makeIce(o) {
    const W = o.W || 2048, H = o.H || 1024;
    const tint = o.tint || '#e8eef4';
    const c = canvas(W, H), x = c.getContext('2d');
    x.fillStyle = tint; x.fillRect(0, 0, W, H);
    const rnd = mulberry32(o.seed || 5);

    // 斑驳
    const n1 = noiseField(512, 256, 12, 5, (o.seed || 5) + 4);
    const img = x.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let i2 = 0; i2 < W; i2++) {
        const u = (i2 + 0.5) / W;
        const a = bilinear(n1, 512, 256, u, v);
        const i = (y * W + i2) * 4;
        d[i] = clamp(d[i] * (0.9 + a * 0.18), 0, 255);
        d[i + 1] = clamp(d[i + 1] * (0.9 + a * 0.18), 0, 255);
        d[i + 2] = clamp(d[i + 2] * (0.92 + a * 0.16), 0, 255);
      }
    }
    x.putImageData(img, 0, 0);

    // 褐红色裂纹网络
    const crackCol = o.crack || 'rgba(150,96,68,';
    for (let i = 0; i < 150; i++) {
      const x0 = rnd() * W, y0 = rnd() * H;
      const len = 120 + rnd() * 900;
      const ang = rnd() * 6.2832;
      x.strokeStyle = crackCol + (0.18 + rnd() * 0.5) + ')';
      x.lineWidth = 0.8 + rnd() * 3.4;
      x.beginPath();
      x.moveTo(x0, y0);
      let cx = x0, cy = y0, a = ang;
      for (let s = 0; s < 6; s++) {
        a += (rnd() - 0.5) * 0.9;
        cx += Math.cos(a) * len / 6;
        cy += Math.sin(a) * len / 6;
        x.lineTo(cx, cy);
      }
      x.stroke();
    }
    // 少量冲击坑
    for (let i = 0; i < (o.craters || 120); i++) {
      const px = rnd() * W, py = rnd() * H, r = 2 + Math.pow(rnd(), 2) * 26;
      x.strokeStyle = 'rgba(255,255,255,0.22)';
      x.lineWidth = Math.max(0.6, r * 0.14);
      x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.stroke();
      x.fillStyle = 'rgba(120,130,140,0.13)';
      x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
    }
    return c;
  }

  /* ---------------- 火山世界（伊奥） ---------------- */
  function makeIo(o) {
    const W = 2048, H = 1024;
    const c = canvas(W, H), x = c.getContext('2d');
    x.fillStyle = '#ded05c'; x.fillRect(0, 0, W, H);
    const rnd = mulberry32(o.seed || 77);
    const palette = ['#f2e07a', '#e8c94a', '#cf9a33', '#b8622c', '#8d4a24', '#f5efc8', '#d8a94a'];
    for (let i = 0; i < 900; i++) {
      const px = rnd() * W, py = H * (0.05 + rnd() * 0.9);
      const r = 12 + rnd() * 130;
      const col = palette[(rnd() * palette.length) | 0];
      x.globalAlpha = 0.16 + rnd() * 0.35;
      x.save(); x.translate(px, py); x.scale(1, 0.55 + rnd() * 0.5);
      const g2 = x.createRadialGradient(0, 0, 0, 0, 0, r);
      g2.addColorStop(0, col);
      g2.addColorStop(0.55, col + 'aa');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g2;
      x.beginPath(); x.arc(0, 0, r, 0, 6.2832); x.fill(); x.restore();
    }
    x.globalAlpha = 1;
    // 火山口黑点 + 硫黄晕
    for (let i = 0; i < 220; i++) {
      const px = rnd() * W, py = H * (0.1 + rnd() * 0.8), r = 2 + rnd() * 9;
      const g3 = x.createRadialGradient(px, py, 0, px, py, r * 4);
      g3.addColorStop(0, 'rgba(40,20,10,0.9)');
      g3.addColorStop(0.4, 'rgba(120,50,20,0.45)');
      g3.addColorStop(1, 'rgba(180,120,40,0)');
      x.fillStyle = g3;
      x.beginPath(); x.arc(px, py, r * 4, 0, 6.2832); x.fill();
    }
    return c;
  }

  /* ---------------- 行星环 ---------------- */
  function makeRing(o) {
    const style = o.style || 'saturn';
    const W = 2048, H = 8;
    const c = canvas(W, H), x = c.getContext('2d');
    x.clearRect(0, 0, W, H);
    const rnd = mulberry32(style === 'saturn' ? 999 : 555);
    const n = noiseField(1024, 8, 90, 4, 4242);
    for (let i = 0; i < W; i++) {
      const t = i / W;
      let a, col;
      if (style === 'saturn') {
        // C 环 / B 环 / 卡西尼缝 / A 环
        if (t < 0.16) { a = 0.18 + t * 0.9; col = [176, 160, 132]; }
        else if (t < 0.55) { a = 0.92; col = [232, 218, 186]; }
        else if (t < 0.62) { a = 0.1; col = [150, 140, 120]; }
        else if (t < 0.92) { a = 0.72; col = [216, 202, 172]; }
        else { a = 0.4 * (1 - (t - 0.92) / 0.08); col = [200, 188, 160]; }
        const nz = bilinear(n, 1024, 8, t, 0.5);
        a *= 0.55 + nz * 0.8;
        // 恩克缝
        if (t > 0.775 && t < 0.79) a *= 0.12;
        if (t > 0.24 && t < 0.255) a *= 0.4;
        // Cassini 内部细缝
        if (t > 0.41 && t < 0.418) a *= 0.3;
      } else {
        // 天王星细环
        a = 0.05;
        col = [150, 170, 180];
        const ringPos = [0.12, 0.28, 0.42, 0.55, 0.68, 0.79, 0.88, 0.95];
        for (let k = 0; k < ringPos.length; k++) {
          const dd = Math.abs(t - ringPos[k]);
          if (dd < 0.006) a = Math.max(a, 0.55 * (1 - dd / 0.006));
        }
      }
      x.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + clamp(a, 0, 1) + ')';
      x.fillRect(i, 0, 1, H);
    }
    return c;
  }

  /* ---------------- 光晕精灵 ---------------- */
  function makeGlow(inner, outer, size) {
    size = size || 256;
    const c = canvas(size, size), x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return c;
  }

  global.TEX = {
    canvas: canvas, mulberry32: mulberry32, noiseField: noiseField, bilinear: bilinear,
    lon2x: lon2x, lat2y: lat2y, drawWorldPaths: drawWorldPaths,
    makeEarth: makeEarth, makeSun: makeSun, makeRocky: makeRocky, makeGas: makeGas,
    makeCloudy: makeCloudy, makeIce: makeIce, makeIo: makeIo, makeRing: makeRing, makeGlow: makeGlow
  };
})(window);
