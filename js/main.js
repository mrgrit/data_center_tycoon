/* 부트스트랩과 루프.
 *
 * 시뮬레이션 틱과 렌더 프레임을 분리했다. 16× 배속에서도 그림은 60fps 로
 * 흐르고, 계산만 여러 번 돈다. 둘을 묶으면 배속이 곧 프레임 저하가 된다.
 */
import { step, fmtMoney, placeLoad } from './sim.js';
import { maybeFire, resolve } from './events.js';
import * as W from './world.js';
import * as U from './ui.js';
import { draw, pick } from './render.js';
import { PLACEABLE, GRID_W } from './catalog.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');

let S = W.load();
if (S) { U.hint('저장된 게임을 이어서 시작한다'); }
else { S = W.newGame(); W.recalcPlant(S); W.refreshOffers(S);
       W.log(S, 'info', '데이터센터를 인수했다. 1층과 기본 설비가 있다.'); }

const view = { w: 0, h: 0, camX: 0, camY: 0, zoom: 1, hover: -1, floorIdx: 0, ghost: false };

/* ── 캔버스 크기 ─────────────────────────────────────────── */
function resize() {
  const r = cv.parentElement.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.w = r.width; view.h = r.height;
  view.zoom = Math.min(1, Math.max(0.5, r.width / 1150));
}
new ResizeObserver(resize).observe(cv.parentElement);
resize();

/* ── 입력 ────────────────────────────────────────────────── */
let drag = null;
cv.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.shiftKey) drag = { x: e.clientX, y: e.clientY, cx: view.camX, cy: view.camY };
});
window.addEventListener('mouseup', () => (drag = null));
cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  if (drag) { view.camX = drag.cx + (e.clientX - drag.x); view.camY = drag.cy + (e.clientY - drag.y); return; }
  view.hover = pick(e.clientX - r.left, e.clientY - r.top, view);
  view.ghost = !!U.state.tool;
});
cv.addEventListener('mouseleave', () => (view.hover = -1));
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoom = Math.min(1.7, Math.max(0.42, view.zoom * (e.deltaY < 0 ? 1.1 : 0.91)));
}, { passive: false });

cv.addEventListener('click', (e) => {
  const r = cv.getBoundingClientRect();
  const i = pick(e.clientX - r.left, e.clientY - r.top, view);
  if (i < 0) return;
  if (!U.state.tool) {
    const t = S.floors[U.state.floorIdx].tiles[i];
    if (t) { const s = PLACEABLE[t.type];
      U.hint(`${s.name} — ${s.kind === 'rack' ? `${(t.loadKw || 0).toFixed(1)} / ${s.capacityKw} kW` : `제열 ${s.removeKw}kW`}${t.broken ? ' · 고장' : ''}`); }
    return;
  }
  const err = W.build(S, U.state.floorIdx, i, U.state.tool);
  if (err) U.hint(err); else U.invalidate();
});
cv.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const i = pick(e.clientX - r.left, e.clientY - r.top, view);
  if (i < 0) return;
  const err = W.demolish(S, U.state.floorIdx, i);
  if (err) U.hint(err); else U.invalidate();
});

/* ── 패널 클릭 ───────────────────────────────────────────── */
function tabs(barId, prefix) {
  $(barId).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    [...$(barId).children].forEach((x) => x.classList.toggle('on', x === b));
    for (const t of ['build', 'plant', 'staff', 'offers', 'active', 'pnl', 'log']) {
      const el = $('tab' + t[0].toUpperCase() + t.slice(1));
      if (el && el.id.startsWith('tab') && prefix.includes(t)) el.classList.toggle('hide', t !== b.dataset.tab);
    }
  });
}
tabs('leftTabs', ['build', 'plant', 'staff']);
tabs('rightTabs', ['offers', 'active', 'pnl', 'log']);

document.body.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tool],[data-plant],[data-hire],[data-accept],[data-reject],[data-drop],[data-floor],#btnFloor');
  if (!el) return;
  let err = null;
  if (el.dataset.tool) { U.state.tool = U.state.tool === el.dataset.tool ? null : el.dataset.tool; }
  else if (el.dataset.plant) err = W.buyPlant(S, el.dataset.plant);
  else if (el.dataset.hire) err = W.hire(S, el.dataset.hire);
  else if (el.dataset.accept) err = W.accept(S, +el.dataset.accept);
  else if (el.dataset.reject) { S.offers = S.offers.filter((o) => o.id !== +el.dataset.reject); W.refreshOffers(S); }
  else if (el.dataset.drop) err = W.drop(S, +el.dataset.drop);
  else if (el.dataset.floor) { U.state.floorIdx = view.floorIdx = +el.dataset.floor; }
  else if (el.id === 'btnFloor') err = W.addFloor(S);
  if (err) U.hint(err);
  U.invalidate();
});

$('btnSave').onclick = () => U.hint(W.save(S) ? '저장했다' : '저장 실패 — 브라우저 저장소를 확인하라');
$('btnReset').onclick = () => {
  if (!confirm('진행 상황을 버리고 새로 시작한다.')) return;
  W.clearSave(); S = W.newGame(); W.recalcPlant(S); W.refreshOffers(S);
  U.state.floorIdx = view.floorIdx = 0; U.invalidate();
};
function setSpeedUI(v) {
  document.querySelectorAll('.speed [data-speed]').forEach((x) => x.classList.toggle('on', +x.dataset.speed === v));
}
document.querySelectorAll('.speed [data-speed]').forEach((b) => {
  b.onclick = () => { S.speed = +b.dataset.speed; setSpeedUI(S.speed); };
});
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault();
    if (S.speed) { S.lastSpeed = S.speed; S.speed = 0; } else { S.speed = S.lastSpeed || 1; }
    setSpeedUI(S.speed); }
  if (e.key === 'Escape') { U.state.tool = null; U.invalidate(); }
});

/* ── 루프 ────────────────────────────────────────────────── */
let acc = 0, last = Date.now(), lastOffer = 0, lastSave = 0;
/* ★ 260ms/게임분은 너무 느렸다. 16× 를 켜도 게임 내 한 달에 실시간 11.7분,
   투자 회수까지 17개월이면 5시간이다. 경영 시뮬레이션은 앞의 몇 분 안에
   '늘어나는 것'이 보여야 한다. 90ms 로 줄이고 60× 를 추가했다 —
   최고 배속에서 한 달이 약 65초, 3년이 약 40분이다. */
const MS_PER_TICK = 90;

function tickOnce() {
  const notes = step(S);
  for (const n of notes) W.log(S, n.kind, n.msg);

  // 수리 완료
  S.repairs = S.repairs.filter((r) => {
    if (S.minutes < r.at) return true;
    if (r.ref?.t) { r.ref.t.broken = false; W.log(S, 'good', `${r.ref.fi + 1}층 냉각 장비 복구`); }
    return false;
  });
  // 지속형 사건의 남은 시간
  if (S.utilityDown) { S.utilityMin -= 1; if (S.utilityMin <= 0) { S.utilityDown = false; W.log(S, 'good', '수전 복구'); } }
  if (S.heatwave) { S.heatwaveMin -= 1; if (S.heatwaveMin <= 0) { S.heatwave = 0; W.log(S, 'info', '폭염이 끝났다'); } }
  if (S.chillerDown) { S.chillerMin -= 1; if (S.chillerMin <= 0) { S.chillerDown = false; S.chillerDownUnits = 0; W.log(S, 'good', '냉동기 복구'); } }

  // 새 사고
  if (!S.pendingEvent) {
    const ev = maybeFire(S);
    if (ev) {
      /* 사고 전 배속을 기억했다가 그대로 돌려준다. 예전엔 처리 후 무조건 1× 로
         떨어져서, 60× 로 보고 있던 사람이 사고를 처리할 때마다 배속을 다시
         눌러야 했다. 사고는 판단을 요구하는 것이지 조작을 요구하는 게 아니다. */
      const resume = S.speed || 1;
      S.pendingEvent = true; S.speed = 0;
      setSpeedUI(0);
      W.log(S, 'warn', `사고 발생 — ${ev.name}`);
      U.showEvent(S, ev, (opt) => {
        for (const l of resolve(S, ev, opt)) W.log(S, l.kind, l.msg);
        S.pendingEvent = null; S.speed = resume;
        setSpeedUI(resume);
        U.invalidate();
      });
    }
  }
  // 제안 갱신 — 게임 내 하루에 한 번 정도
  const nOff = S.offers.length;
  S.offers = S.offers.filter((o) => !o.expiresAt || S.minutes < o.expiresAt);
  if (S.offers.length !== nOff || S.minutes - lastOffer > 60 * 8) { lastOffer = S.minutes; W.refreshOffers(S); }
  // 자동 저장 — 게임 내 하루에 한 번
  if (S.minutes - lastSave > 60 * 24) { lastSave = S.minutes; W.save(S); }

  // 패배 판정
  if (S.cash < -100_000_000 && !S.gameOver) {
    S.gameOver = 'bankrupt'; S.speed = 0;
    U.showOver('파산', `자금이 ${fmtMoney(S.cash)}원까지 내려갔다. 데이터센터는 채권자에게 넘어갔다.`,
      () => { W.clearSave(); location.reload(); });
  }
}

/* ★ 시뮬레이션을 rAF 에서 떼어냈다.
 *   ① rAF 는 탭이 가려지면 멈춘다. 그러면 다른 창을 보는 동안 데이터센터도
 *      같이 멈춘다 — 경영 시뮬레이션에서 이건 버그다.
 *   ② rAF 의 시간 간격이 환경에 따라 0 에 가깝게 들어오면 누적기가 영영
 *      한 틱을 못 채운다. 실제로 헤드리스에서 40초를 돌려도 게임 내 시계가
 *      1분도 안 갔다 — 화면은 멀쩡히 그려지고 있어서 더 헷갈렸다.
 *   타이머는 자기 간격을 보장하므로 둘 다 해결된다. 그림은 계속 rAF 가 그린다. */
function simLoop() {
  const now = Date.now();
  const dt = Math.min(400, now - last); last = now;
  if (S.speed > 0 && !S.pendingEvent && !S.gameOver) {
    acc += dt * S.speed;
    let guard = 0;
    while (acc >= MS_PER_TICK && guard++ < 200) { acc -= MS_PER_TICK; tickOnce(); }
  }
  /* 수치는 여기서 갱신한다. rAF 에만 걸어 두면 탭이 가려졌을 때 화면의 숫자가
     실제 상태와 갈라진다 — 돌아왔을 때 값이 튀어 보인다. 목록처럼 무거운 것만
     rAF 에 남긴다. */
  U.renderStats(S);
}
setInterval(simLoop, 50);

function frame() {
  view.floorIdx = U.state.floorIdx;
  view.ghost = !!U.state.tool;
  draw(ctx, S, view);
  U.renderBuild(S); U.renderPlant(S); U.renderStaff(S);
  U.renderOffers(S); U.renderActive(S); U.renderPnl(S); U.renderLog(S); U.renderFloorbar(S);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
U.hint('장비를 고르고 바닥을 클릭한다 · 휠=확대 · Shift+드래그=이동 · Space=일시정지', 6000);

/* ── 체험 모드 (?demo=1) ──────────────────────────────────────
 * 빈 바닥에서 시작하면 "무엇부터 해야 하나"가 막막하다. 강의에서 보여 줄 때도
 * 매번 손으로 짓고 있을 수 없다. 한 줄짜리 시작 구성을 만들어 둔다. */
if (new URLSearchParams(location.search).has('demo')) {
  S = W.newGame(); W.recalcPlant(S);
  S.cash = 2_000_000_000;
  for (const k of ['feed', 'transformer', 'ups', 'chiller']) { W.buyPlant(S, k); W.buyPlant(S, k); }
  W.buyPlant(S, 'generator');
  /* 인수 시설이 0,1,8,9(표준랙)과 16,17(CRAC)을 이미 쓰고 있다 — 빈 자리에만 짓는다 */
  const put = (i, type) => W.build(S, 0, i, type);
  [2, 3, 10, 11].forEach((i) => put(i, 'rack_std'));
  [4, 12, 20, 21].forEach((i) => put(i, 'rack_hd'));
  [18, 19, 26].forEach((i) => put(i, 'inrow'));
  W.hire(S, 'tech'); W.hire(S, 'ops');
  W.refreshOffers(S);
  for (const o of [...S.offers]) W.accept(S, o.id);
  S.cash = 1_400_000_000;
  W.log(S, 'info', '체험 모드 — 1층에 랙 12대와 냉각 4대, 계약 몇 건이 들어가 있다.');
  U.invalidate();
}
