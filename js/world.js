/* 게임 상태와 그 상태를 바꾸는 행동들. 저장·불러오기도 여기 있다. */
import { GRID_W, GRID_H, PLACEABLE, PLANT, CONTRACT_TYPES, STAFF, FLOOR_COST, RACKS } from './catalog.js';
import { placeLoad, freeLoad, fmtMoney, floorThermal } from './sim.js';

let cid = 1;

/* 인수 시점의 시설 — **빈 방이 아니라 돌아가는 데이터센터**를 물려받는다.
 *
 * ★ 예전엔 빈 바닥에서 시작했다. 그러면 첫 몇 분이 통째로 "짓기"이고, 돈이
 *   들어오기 시작할 때까지 게임 내 한 달이 걸린다. 로그는 "데이터센터를
 *   인수했다"고 하는데 화면은 빈 방이라 말과 그림도 안 맞았다.
 *   작게라도 이미 도는 시설을 주면 첫 판단(계약을 받을까? 열은 되나?)이
 *   바로 시작되고, 증설의 효과가 '전과 후'로 보인다. */
function starterFloor() {
  const f = makeFloor();
  const put = (i, type) => (f.tiles[i] = { type, loadKw: 0, broken: false, efficiency: 1 });
  [0, 1, 8, 9].forEach((i) => put(i, 'rack_std'));      // 표준랙 4 = 40kW
  [16, 17].forEach((i) => put(i, 'crac'));              // CRAC 2 = 제열 80kW
  return f;
}

export function newGame() {
  return {
    minutes: 8 * 60,
    cash: 1_200_000_000,
    reputation: 20,
    floors: [starterFloor()],
    plantCounts: { feed: 1, transformer: 1, ups: 1, chiller: 1, generator: 0, economizer: 0 },
    plant: {},
    staff: [],
    contracts: [],
    offers: [],
    repairs: [],
    log: [],
    ledger: { revenue: 0, power: 0, opex: 0, penalty: 0, capex: 0, incident: 0 },
    utilityDown: false, utilityMin: 0,
    heatwave: 0, heatwaveMin: 0,
    chillerDown: false, chillerMin: 0,
    pendingEvent: null,
    speed: 1, paused: false,
    outsideC: 20, itKw: 0, coolKw: 0, demandKw: 0, pue: 0,
    servedKw: 0, degradedKw: 0, blackout: false, trips: [],
    gameOver: null,
  };
}

export function makeFloor() {
  return { tiles: Array(GRID_W * GRID_H).fill(null), tempC: 22, itKw: 0, removeKw: 0, coolKw: 0 };
}

/* 플랜트 카운트로부터 실제 용량을 다시 계산한다.
 * 카운트를 진실원천으로 두면 저장·불러오기와 환불이 전부 단순해진다. */
export function recalcPlant(S) {
  const p = { feedKw: 0, trafoKw: 0, upsKw: 0, batteryKwhMax: 0, genKw: 0, fuelLMax: 0, chillerKw: 0, econ: 0 };
  for (const [k, n] of Object.entries(S.plantCounts)) {
    const spec = PLANT[k]; if (!spec) continue;
    for (const [field, v] of Object.entries(spec.add)) {
      if (field === 'batteryKwh') p.batteryKwhMax += v * n;
      else if (field === 'fuelL') p.fuelLMax += v * n;
      else p[field] = (p[field] || 0) + v * n;
    }
  }
  const old = S.plant || {};
  p.batteryKwh = Math.min(old.batteryKwh ?? p.batteryKwhMax, p.batteryKwhMax);
  p.fuelL = Math.min(old.fuelL ?? p.fuelLMax, p.fuelLMax);
  S.plant = p;
}

export function log(S, kind, msg) {
  S.log.unshift({ t: S.minutes, kind, msg });
  S.log.length = Math.min(S.log.length, 120);
}

export function build(S, floorIdx, tileIdx, typeId) {
  const spec = PLACEABLE[typeId];
  if (!spec) return '알 수 없는 장비';
  const f = S.floors[floorIdx];
  if (!f) return '없는 층';
  if (f.tiles[tileIdx]) return '이미 자리가 찼다';
  if (S.cash < spec.cost) return `자금 부족 — ${fmtMoney(spec.cost)} 필요`;
  if (spec.requires) {
    const has = f.tiles.some((t) => t && t.type === spec.requires);
    if (!has) return `같은 층에 ${PLACEABLE[spec.requires].name} 가 먼저 있어야 한다`;
  }
  S.cash -= spec.cost; S.ledger.capex += spec.cost;
  f.tiles[tileIdx] = { type: typeId, loadKw: 0, broken: false, efficiency: 1 };
  log(S, 'info', `${floorIdx + 1}층에 ${spec.name} 설치 (${fmtMoney(spec.cost)})`);
  return null;
}

export function demolish(S, floorIdx, tileIdx) {
  const f = S.floors[floorIdx]; const t = f?.tiles[tileIdx];
  if (!t) return '빈 자리다';
  if ((t.loadKw || 0) > 0) return '워크로드가 올라가 있다 — 계약을 먼저 정리해야 한다';
  const spec = PLACEABLE[t.type];
  const refund = Math.round(spec.cost * 0.4);
  S.cash += refund;
  f.tiles[tileIdx] = null;
  log(S, 'info', `${spec.name} 철거 (환급 ${fmtMoney(refund)})`);
  return null;
}

export function buyPlant(S, key) {
  const spec = PLANT[key];
  const n = S.plantCounts[key] || 0;
  if (n >= spec.max) return '더 늘릴 수 없다';
  if (S.cash < spec.cost) return `자금 부족 — ${fmtMoney(spec.cost)} 필요`;
  S.cash -= spec.cost; S.ledger.capex += spec.cost;
  S.plantCounts[key] = n + 1;
  recalcPlant(S);
  log(S, 'good', `${spec.name} 증설 (${fmtMoney(spec.cost)})`);
  return null;
}

export function addFloor(S) {
  const next = S.floors.length + 1;
  const cost = FLOOR_COST[next];
  if (!cost) return '더 올릴 수 없다';
  if (S.cash < cost) return `자금 부족 — ${fmtMoney(cost)} 필요`;
  S.cash -= cost; S.ledger.capex += cost;
  S.floors.push(makeFloor());
  log(S, 'good', `${next}층 개설 (${fmtMoney(cost)})`);
  return null;
}

export function hire(S, id) {
  const spec = STAFF[id];
  if (S.staff.some((s) => s.id === id)) return '이미 고용했다';
  if (S.cash < spec.salary * 2) return '두 달치 급여는 있어야 한다';
  S.staff.push({ ...spec });
  log(S, 'info', `${spec.name} 채용 (월 ${fmtMoney(spec.salary)})`);
  return null;
}

/* 제안 생성 — 평판이 좋을수록 좋은 계약이 온다. */
export function refreshOffers(S) {
  const pool = CONTRACT_TYPES.filter((t) => S.reputation >= t.minRep);
  /* 제안이 3개뿐이면 현금이 있어도 늘릴 수가 없다 — 성장 속도의 상한이
     자금이 아니라 '들어오는 일감 수'가 되어 버린다. */
  const want = 5;
  while (S.offers.length < want) {
    const t = pool[Math.floor(Math.random() * pool.length)];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const kw = Math.round(rnd(t.kw[0], t.kw[1]));
    S.offers.push({
      id: cid++, type: t.id, name: t.name, color: t.color, flavor: t.flavor,
      kw, baseKw: kw, rate: Math.round(rnd(t.rate[0], t.rate[1]) / 1000) * 1000,
      months: Math.round(rnd(t.months[0], t.months[1])), sla: t.sla, needs: t.needs,
      /* ★ 제안에 유효기간을 준다. 없으면 못 받는 제안(예: 액랭 설비가 없는데
         들어온 AI 계약)이 목록을 영구히 막는다. 평판이 100 이 된 시뮬레이션에서
         5칸이 전부 액랭 건으로 차서, 받을 수 있는 공랭 계약이 3년째에
         10건 → 3건으로 줄었다. 일감이 없어서가 아니라 자리가 없어서였다. */
      expiresAt: S.minutes + 60 * 24 * (5 + Math.floor(Math.random() * 9)),
    });
  }
}

export function accept(S, offerId) {
  const i = S.offers.findIndex((o) => o.id === offerId);
  if (i < 0) return '없는 제안';
  const o = S.offers[i];
  const c = { ...o, active: true, downMin: 0, totalMin: 0, degradedMin: 0,
              remainMin: o.months * 30 * 24 * 60, placed: [], floor: 0 };
  if (!placeLoad(S, c)) {
    return o.needs === 'liquid'
      ? `GPU 랙 여유가 ${o.kw}kW 필요하다 (CDU 도 함께)`
      : `랙 여유가 ${o.kw}kW 필요하다`;
  }
  S.contracts.push(c);
  S.offers.splice(i, 1);
  refreshOffers(S);
  log(S, 'good', `계약 체결 — ${c.name} ${c.kw}kW · ${c.months}개월 · SLA ${c.sla}%`);
  /* 랙에 자리가 있다고 받을 수 있는 것이 아니다. 열을 뺄 수 있어야 받는 것이다.
     막지는 않는다 — 판단은 플레이어의 몫이고, 이 판단이 이 게임의 핵심이다.
     다만 모르고 지나가지는 않게 한다. */
  const head = coolHeadroom(S, c.floor);
  if (head < 0) log(S, 'bad', `${c.floor + 1}층 제열 용량이 ${(-head).toFixed(0)}kW 모자란다 — 온도가 오른다`);
  else if (head < 15) log(S, 'warn', `${c.floor + 1}층 제열 여유가 ${head.toFixed(0)}kW 뿐이다`);
  return null;
}

export function drop(S, contractId) {
  const c = S.contracts.find((x) => x.id === contractId);
  if (!c || !c.active) return '없는 계약';
  c.active = false; freeLoad(S, c);
  const penalty = c.kw * c.rate * 0.8;
  S.cash -= penalty; S.ledger.penalty += penalty;
  S.reputation = Math.max(0, S.reputation - 10);
  log(S, 'bad', `계약 해지 — ${c.name} 위약금 ${fmtMoney(penalty)}, 평판 -10`);
  return null;
}

/* 그 층에서 지금 부하를 다 빼고도 남는 제열 능력(kW). 음수면 못 뺀다. */
export function coolHeadroom(S, fi) {
  const f = S.floors[fi]; if (!f) return 0;
  const th = floorThermal(f, S.outsideC ?? 20, S.plant.econ);
  return (th.capAir + th.capLiq) - th.itKw;
}

export function racksOf(S) {
  let cap = 0, used = 0, capL = 0, usedL = 0;
  for (const f of S.floors) for (const t of f.tiles) {
    if (!t) continue; const s = PLACEABLE[t.type];
    if (s?.kind !== 'rack') continue;
    if (s.cooling === 'liquid') { capL += s.capacityKw; usedL += t.loadKw || 0; }
    else { cap += s.capacityKw; used += t.loadKw || 0; }
  }
  return { cap, used, capL, usedL };
}

const KEY = 'dct.save.v1';
export function save(S) {
  try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch { return false; }
}
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const S = JSON.parse(raw);
    recalcPlant(S);
    return S;
  } catch { return null; }
}
export function clearSave() { try { localStorage.removeItem(KEY); } catch {} }
