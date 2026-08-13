/* 아이소메트릭 렌더러 (캔버스).
 *
 * kt66 관제 화면에서 배운 것을 그대로 가져왔다. 단색 세 면을 붙이면 입체로는
 * 읽히지만 **종이를 오려 붙인 것처럼** 보인다. 세 가지가 필요하다.
 *   ① 면마다 감쇠 그라디언트 — 빛이 면 위를 흐른다
 *   ② 접지 그림자 — 없으면 물체가 바닥에서 뜬다
 *   ③ 채도 억제 — 평상시가 조용해야 경보가 눈에 띈다
 *
 * 캔버스를 쓴 이유는 매 프레임 다시 그리기 때문이다. SVG 로 160개 프리즘을
 * 60fps 로 갈아 끼우면 브라우저가 버티지 못한다.
 */
import { PLACEABLE, GRID_W, GRID_H } from './catalog.js';

const TW = 62, TH = 32;              // 타일 반너비 / 반높이
const LIFT = 96;                     // 층간 높이

export function iso(gx, gy, gz = 0) {
  return { x: (gx - gy) * TW, y: (gx + gy) * TH - gz };
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}
/* 채도를 눌러 회색 쪽으로 당긴다. 고장·경보일 때만 원래 채도를 돌려준다. */
function calm(hex, k = 0.3) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  r = Math.round(r + (l - r) * k); g = Math.round(g + (l - g) * k); b = Math.round(b + (l - b) * k);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.1; ctx.stroke(); }
}

/* 접지 그림자 — 필터 없이. 어두운 마름모 두 장을 어긋나게 겹친다.
 * blur 필터는 프레임마다 비싸고, 이 정도로도 물체가 바닥에 붙는다. */
function contactShadow(ctx, gx, gy, h) {
  const c = iso(gx + 0.5, gy + 0.5);
  const sp = Math.min(1.5, 0.9 + h / 160);
  for (const [s, a] of [[1.18 * sp, 0.16], [0.86 * sp, 0.2]]) {
    poly(ctx, [
      { x: c.x, y: c.y - TH * 0.5 * s }, { x: c.x + TW * s, y: c.y },
      { x: c.x, y: c.y + TH * 0.5 * s }, { x: c.x - TW * s, y: c.y },
    ], `rgba(2,6,14,${a})`);
  }
}

/* 프리즘 하나. 윗면 · 앞면 · 옆면에 각각 다른 밝기와 그라디언트를 준다. */
function prism(ctx, gx, gy, w, d, h, color, opts = {}) {
  const z = opts.z || 0;
  const A = iso(gx, gy, z), B = iso(gx + w, gy, z), C = iso(gx + w, gy + d, z), D = iso(gx, gy + d, z);
  const A2 = iso(gx, gy, z + h), B2 = iso(gx + w, gy, z + h), C2 = iso(gx + w, gy + d, z + h), D2 = iso(gx, gy + d, z + h);

  const side = shade(color, 0.5), front = shade(color, 0.74);
  // 오른쪽 옆면
  const gS = ctx.createLinearGradient(B2.x, B2.y, C.x, C.y);
  gS.addColorStop(0, side); gS.addColorStop(1, shade(color, 0.34));
  poly(ctx, [B2, C2, C, B], gS, 'rgba(4,8,15,0.55)');
  // 앞면
  const gF = ctx.createLinearGradient(D2.x, D2.y, C.x, C.y);
  gF.addColorStop(0, front); gF.addColorStop(1, shade(color, 0.46));
  poly(ctx, [D2, C2, C, D], gF, 'rgba(4,8,15,0.55)');
  // 윗면
  const gT = ctx.createLinearGradient(A2.x, A2.y, C2.x, C2.y);
  gT.addColorStop(0, shade(color, 1.14)); gT.addColorStop(1, shade(color, 0.86));
  poly(ctx, [A2, B2, C2, D2], gT, 'rgba(4,8,15,0.5)');
  // 윗면 하이라이트 — 모서리에 빛이 걸린다
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(A2.x, A2.y); ctx.lineTo(B2.x, B2.y); ctx.stroke();
  return { top: iso(gx + w / 2, gy + d / 2, z + h) };
}

/* 온도에 따른 바닥 색 — 정보가 색으로 흐르게 한다 */
function heatColor(t) {
  if (t <= 24) return 'rgba(56,189,248,0.10)';
  if (t <= 28) return 'rgba(250,204,21,0.13)';
  if (t <= 34) return 'rgba(249,115,22,0.20)';
  if (t <= 42) return 'rgba(239,68,68,0.26)';
  return 'rgba(239,68,68,0.40)';
}

export function draw(ctx, S, view) {
  const { w, h, camX, camY, zoom, hover, floorIdx, ghost } = view;
  ctx.clearRect(0, 0, w, h);

  // 배경 — 위가 밝고 아래가 어두운 무대
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0d1726'); bg.addColorStop(0.55, '#0a1020'); bg.addColorStop(1, '#070b16');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const vg = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.15, w / 2, h * 0.5, h * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2 + camX, h * 0.30 + camY);
  ctx.scale(zoom, zoom);

  const floors = S.floors;
  for (let fi = 0; fi < floors.length; fi++) {
    const f = floors[fi];
    const z = fi * LIFT;
    const active = fi === floorIdx;
    ctx.globalAlpha = active ? 1 : 0.42;

    // 바닥판
    const p0 = iso(-0.4, -0.4, z), p1 = iso(GRID_W + 0.4, -0.4, z),
          p2 = iso(GRID_W + 0.4, GRID_H + 0.4, z), p3 = iso(-0.4, GRID_H + 0.4, z);
    poly(ctx, [{ x: p0.x, y: p0.y + 13 }, { x: p1.x, y: p1.y + 13 }, { x: p2.x, y: p2.y + 13 }, { x: p3.x, y: p3.y + 13 }], 'rgba(2,5,12,0.55)');
    const gp = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
    gp.addColorStop(0, '#16273f'); gp.addColorStop(1, '#0b1526');
    poly(ctx, [p0, p1, p2, p3], gp, 'rgba(80,140,220,0.28)');
    poly(ctx, [p0, p1, p2, p3], heatColor(f.tempC));

    // 타일 격자
    ctx.strokeStyle = 'rgba(120,180,250,0.22)'; ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_W; x++) {
      const a = iso(x, 0, z), b = iso(x, GRID_H, z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let y = 0; y <= GRID_H; y++) {
      const a = iso(0, y, z), b = iso(GRID_W, y, z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    /* 층 이름표 — 판 **바깥** 왼쪽에. 처음엔 판 안쪽 위 모서리에 뒀는데
       거기가 타일 (0,0) 자리라 뒷줄 랙을 덮었다. 늘 비어 있는 곳에 둬야 한다. */
    const lp = iso(-1.1, GRID_H * 0.45, z + 18);
    ctx.font = '600 15px ui-sans-serif,system-ui,sans-serif';
    ctx.fillStyle = active ? 'rgba(190,220,255,0.95)' : 'rgba(150,180,220,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText(`${fi + 1}F`, lp.x - 14, lp.y);
    ctx.font = '500 11px ui-sans-serif,system-ui,sans-serif';
    ctx.fillStyle = active ? 'rgba(150,190,235,0.75)' : 'rgba(130,160,200,0.35)';
    ctx.fillText(`${f.tempC.toFixed(1)}℃ · ${f.itKw.toFixed(0)}kW`, lp.x - 14, lp.y + 15);
    ctx.textAlign = 'left';

    // 장비 — 화가 순서(뒤에서 앞으로)
    const order = [];
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) order.push({ x, y, i: y * GRID_W + x });
    for (const o of order) {
      const t = f.tiles[o.i];
      if (!t) {
        if (active && hover === o.i) {
          const a = iso(o.x, o.y, z), b = iso(o.x + 1, o.y, z), c = iso(o.x + 1, o.y + 1, z), d = iso(o.x, o.y + 1, z);
          poly(ctx, [a, b, c, d], ghost ? 'rgba(74,222,128,0.22)' : 'rgba(125,180,255,0.16)', 'rgba(150,200,255,0.5)');
        }
        continue;
      }
      const spec = PLACEABLE[t.type];
      if (!spec) continue;
      const isRack = spec.kind === 'rack';
      const hh = isRack ? 44 + (spec.capacityKw / 50) * 30 : 30;
      const fill = t.broken ? '#ef4444' : calm(spec.color, f.tempC > 30 ? 0.05 : 0.32);
      contactShadow(ctx, o.x, o.y, hh);
      const r = prism(ctx, o.x + 0.12, o.y + 0.12, 0.76, 0.76, hh, fill, { z });

      // 사용률 막대 — 랙이 얼마나 찼는지
      if (isRack && spec.capacityKw) {
        const u = Math.min(1, (t.loadKw || 0) / spec.capacityKw);
        const bx = iso(o.x + 0.12, o.y + 0.88, z + 6), by = iso(o.x + 0.88, o.y + 0.88, z + 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(bx.x, bx.y); ctx.lineTo(by.x, by.y); ctx.stroke();
        ctx.strokeStyle = u > 0.9 ? '#fbbf24' : '#4ade80'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(bx.x, bx.y);
        ctx.lineTo(bx.x + (by.x - bx.x) * u, bx.y + (by.y - bx.y) * u); ctx.stroke();
      }
      if (t.broken) {
        ctx.font = '700 16px ui-sans-serif,system-ui'; ctx.fillStyle = '#fecaca';
        ctx.textAlign = 'center'; ctx.fillText('!', r.top.x, r.top.y - 8); ctx.textAlign = 'left';
      }
      if (active && hover === o.i) {
        const a = iso(o.x, o.y, z), b = iso(o.x + 1, o.y, z), c2 = iso(o.x + 1, o.y + 1, z), d = iso(o.x, o.y + 1, z);
        poly(ctx, [a, b, c2, d], null, 'rgba(160,210,255,0.7)');
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (S.blackout) {
    ctx.fillStyle = 'rgba(120,10,10,0.28)'; ctx.fillRect(0, 0, w, h);
  }
}

/* 화면 좌표 → 타일 인덱스. 아이소메트릭 역변환이다. */
export function pick(px, py, view) {
  const { w, h, camX, camY, zoom, floorIdx } = view;
  const x = (px - (w / 2 + camX)) / zoom;
  const y = (py - (h * 0.30 + camY)) / zoom + floorIdx * LIFT;
  const gx = Math.floor((x / TW + y / TH) / 2);
  const gy = Math.floor((y / TH - x / TW) / 2);
  if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return -1;
  return gy * GRID_W + gx;
}
