/* 물리·경제 모형 — 게임의 심장.
 *
 * 설계 원칙 하나: **모든 전기는 결국 열이 된다.** 서버가 쓴 kW 는 그대로 kW 의
 * 열이고, 그 열을 빼려면 또 전기가 든다. 그 되먹임이 이 게임의 긴장 전체를
 * 만든다 — 매출을 늘리려고 부하를 올리면 열이 오르고, 열을 빼려니 전기가 늘고,
 * 전기가 늘면 전력 경로의 어느 지점이 먼저 찬다.
 *
 * 두 번째 원칙: **용량은 총량이 아니라 경로의 각 지점에서 따로 성립해야 한다.**
 * 수전 → 변압기 → UPS → 랙. 총합이 남아도 한 지점이 모자라면 거기서 끊긴다.
 * 실무에서 증설 사고가 나는 자리가 정확히 여기다.
 */
import { KWH_PRICE, TICK_MIN, AMBIENT_TARGET, PLACEABLE, PLANT } from './catalog.js';

/* 바깥 기온 — 계절 + 하루 주기. 냉각 효율이 여기에 통째로 매달려 있다. */
export function outsideTemp(minutes, heatwave = 0) {
  const day = minutes / (60 * 24);
  const season = 13 + 13 * Math.sin((day / 365) * 2 * Math.PI - Math.PI / 2);
  const diurnal = 4.5 * Math.sin((day % 1) * 2 * Math.PI - Math.PI / 2);
  return season + diurnal + heatwave;
}

/* 실제 COP — 카탈로그 값은 이상적인 값이고, 더울수록 떨어진다.
 * 바깥이 35℃ 인 날의 냉각기는 15℃ 인 날의 절반쯤 일한다. 여름에 요금이
 * 튀는 이유가 이것이고, 이코노마이저가 겨울에만 효과가 큰 이유도 이것이다. */
export function effectiveCop(baseCop, outC, econCount) {
  let cop = baseCop * (1 - Math.max(0, outC - 15) * 0.018);
  if (outC < 12 && econCount > 0) cop *= 1 + Math.min(econCount, 3) * 0.55;
  return Math.max(0.8, cop);
}

/* 층별 열수지.
 *
 * ★ 냉각 전력은 **설치 용량이 아니라 실제로 뺀 열**에 비례해야 한다.
 *   처음엔 설치된 냉각기 전부를 최대로 돌리는 것으로 계산했는데, 그러면
 *   48kW 짜리 전산실에 155kW 짜리 냉각을 붙였다는 이유만으로 PUE 가 2.1 이
 *   나왔다. 여유를 갖는 것이 곧 벌점이 되는 셈이라 게임으로도 틀렸고,
 *   실제 장비도 부하에 따라 출력을 조절하므로 물리적으로도 틀렸다.
 *   (Node 로 120일을 돌려 보고 나서야 보였다 — 화면만 봤으면 못 잡았다.)
 *
 *   다만 완전히 공짜는 아니다. 팬과 순환은 부하가 없어도 돈다. 그래서
 *   설치 용량의 일부는 상시 소비로 남긴다.
 */
const IDLE_FRAC = 0.07;          // 무부하 상시 소비 (팬·순환)
const OVERSHOOT = 1.08;          // 목표보다 조금 더 빼서 설정온도로 당긴다

export function floorThermal(floor, outC, econCount) {
  let itAir = 0, itLiq = 0;
  let capAir = 0, capLiq = 0, idleKw = 0;
  let wAir = 0, wLiq = 0;                    // COP 가중합 (용량 가중 평균용)

  for (const t of floor.tiles) {
    if (!t) continue;
    const spec = PLACEABLE[t.type];
    if (!spec) continue;
    if (spec.kind === 'rack') {
      if (spec.cooling === 'liquid') itLiq += t.loadKw || 0;
      else itAir += t.loadKw || 0;
    } else if (spec.kind === 'cooler' && !t.broken) {
      const cop = effectiveCop(spec.cop, outC, econCount);
      const cap = spec.removeKw * (t.efficiency ?? 1);
      if (spec.serves === 'liquid') { capLiq += cap; wLiq += cap / cop; }
      else { capAir += cap; wAir += cap / cop; }
      idleKw += (cap / cop) * IDLE_FRAC;
    }
  }
  const copAir = capAir > 0 ? capAir / wAir : 1;
  const copLiq = capLiq > 0 ? capLiq / wLiq : 1;

  return { itKw: itAir + itLiq, itAir, itLiq, capAir, capLiq, copAir, copLiq, idleKw };
}

/* 실제로 뺀 열과 거기 든 전기. 냉동기 용량 제약을 공랭 쪽에 적용한다. */
export function coolingWork(th, floorTemp, chillerAvail) {
  const target = AMBIENT_TARGET;
  /* 더우면 더 세게 돌린다 — 설정온도로 당기는 몫 */
  const pull = Math.max(0, floorTemp - target) * 2.2;
  const wantAir = Math.min(th.capAir, th.itAir * OVERSHOOT + pull);
  const wantLiq = Math.min(th.capLiq, th.itLiq * OVERSHOOT + pull);
  const airRatio = th.capAir > 0 ? Math.min(1, chillerAvail / Math.max(th.capAir, 1e-6)) : 1;
  const remAir = wantAir * airRatio;
  const remLiq = wantLiq;
  const kw = remAir / th.copAir + remLiq / th.copLiq + th.idleKw;
  return { removed: remAir + remLiq, kw, limited: airRatio < 0.999 };
}

/* 한 틱을 전진시킨다. state 를 직접 고치고, 그 틱에 벌어진 일을 돌려준다. */
export function step(S) {
  const notes = [];
  S.minutes += TICK_MIN;
  const outC = outsideTemp(S.minutes, S.heatwave);
  S.outsideC = outC;

  /* 일시적 부하 증폭(DDoS)이 끝나면 반드시 원래대로 돌린다.
     되돌리는 일을 선택지에만 맡기면 안 고른 만큼 영구히 남는다. */
  if (S.ddosUntil && S.minutes >= S.ddosUntil) {
    S.ddosUntil = 0;
    for (const c of S.contracts) if (c.active) c.kw = c.baseKw;
    notes.push({ kind: 'info', msg: '트래픽이 평시 수준으로 돌아왔다' });
  }

  /* ── 1. 층별 열 ─────────────────────────────────────────── */
  let itKw = 0, coolKw = 0;
  for (const f of S.floors) {
    /* 사고 대응으로 층 전원을 내렸으면 그 층은 열도 안 나고 서비스도 안 된다.
       events 에서 powerOffUntil 을 걸어 놓고 여기서 보지 않으면, 학생 입장에서는
       '전원을 껐다고 했는데 아무 일도 안 일어나는' 상태가 된다. */
    f.powerOff = (f.powerOffUntil || 0) > S.minutes;
    const th = floorThermal(f, outC, S.plant.econ);
    if (f.powerOff) th.itAir = th.itLiq = th.itKw = 0;

    /* ★ 냉동기 고장은 **한 대**가 서는 것이지 냉수가 통째로 끊기는 것이 아니다.
       예전엔 chillerDown 이면 가용량을 0 으로 만들었는데, 그러면 냉동기를
       몇 대를 사든 한 대 고장에 전산실 전체가 삶긴다. 2년 시뮬레이션에서
       과열 시간 9,086분이 냉동기 고장 시간과 정확히 겹쳤다 — 이 게임에서
       가장 중요한 교훈(설비도 N+1 이어야 한다)을 배우는 것이 **불가능**했다.
       투자로 막을 수 없는 사고는 벌이지 교보재가 아니다. */
    const perUnit = 250;
    const chillerAvail = Math.max(0, S.plant.chillerKw - (S.chillerDownUnits || 0) * perUnit);
    const work = coolingWork(th, f.tempC ?? AMBIENT_TARGET, chillerAvail);
    f.itKw = th.itKw; f.removeKw = work.removed; f.coolKw = work.kw;
    f.chillerLimited = work.limited;
    f.capKw = th.capAir + th.capLiq;

    const net = th.itKw - work.removed;                 // +면 덥혀지고 -면 식는다
    const mass = 95 + f.tiles.filter(Boolean).length * 7;
    f.tempC = (f.tempC ?? AMBIENT_TARGET) + (net / mass) * TICK_MIN * 2.2;
    f.tempC = Math.max(AMBIENT_TARGET - 1.5, Math.min(75, f.tempC));

    itKw += th.itKw;
    coolKw += work.kw;
  }

  /* ── 2. 전력 경로 ───────────────────────────────────────── */
  const upsLoss = itKw * 0.05 + coolKw * 0.02;         // 무정전 장치·배전 손실
  let demandKw = itKw + coolKw + upsLoss;
  S.itKw = itKw; S.coolKw = coolKw; S.demandKw = demandKw;
  S.pue = itKw > 0 ? demandKw / itKw : 0;

  const P = S.plant;
  S.trips = [];
  if (S.utilityDown) {
    if (P.genKw > 0 && P.fuelL > 5) {
      S.onGenerator = true;
      const burn = (Math.min(demandKw, P.genKw) / 300) * 55 * (TICK_MIN / 60);  // L/h 환산
      P.fuelL = Math.max(0, P.fuelL - burn);
      if (demandKw > P.genKw) S.trips.push('발전기 용량 초과');
    } else {
      S.onGenerator = false;
      const drain = demandKw * (TICK_MIN / 60);
      P.batteryKwh = Math.max(0, P.batteryKwh - drain);
      if (P.batteryKwh <= 0) S.trips.push('배터리 소진 — 전면 정전');
    }
  } else {
    S.onGenerator = false;
    if (P.batteryKwh < P.batteryKwhMax) P.batteryKwh = Math.min(P.batteryKwhMax, P.batteryKwh + 0.4);
    if (P.fuelL < P.fuelLMax) P.fuelL = Math.min(P.fuelLMax, P.fuelL + 0.5);
    if (demandKw > P.feedKw)  S.trips.push('수전 용량 초과');
    if (demandKw > P.trafoKw) S.trips.push('변압기 용량 초과');
    if (demandKw > P.upsKw)   S.trips.push('UPS 용량 초과');
  }
  S.blackout = S.trips.length > 0;

  /* ── 3. 서비스 품질 ─────────────────────────────────────── */
  let served = 0, degraded = 0;
  for (const c of S.contracts) {
    if (!c.active) continue;
    const f = S.floors[c.floor];
    let ok = !S.blackout && !(f && f.powerOff);
    if (ok && f) {
      if (f.tempC > 40) ok = false;                    // 셧다운 구간
      else if (f.tempC > 28) degraded += c.kw;         // 스로틀 — SLA 는 깎인다
    }
    if (ok) served += c.kw; else c.downMin += TICK_MIN;
    c.totalMin += TICK_MIN;
    if (f && f.tempC > 28 && ok) c.degradedMin += TICK_MIN;
  }
  S.servedKw = served; S.degradedKw = degraded;

  /* ── 4. 돈 ──────────────────────────────────────────────── */
  const hours = TICK_MIN / 60;
  const powerCost = S.blackout ? 0 : demandKw * KWH_PRICE * hours;
  let revenue = 0;
  for (const c of S.contracts) {
    if (!c.active) continue;
    const f = S.floors[c.floor];
    const down = S.blackout || (f && (f.tempC > 40 || f.powerOff));
    const slow = f && f.tempC > 28;
    if (down) continue;                                 // 못 준 만큼은 못 받는다
    revenue += (c.kw * c.rate / (30 * 24)) * hours * (slow ? 0.6 : 1);
  }
  let opex = 0;
  for (const f of S.floors) for (const t of f.tiles) if (t) opex += (PLACEABLE[t.type]?.opex || 0);
  for (const k in S.plantCounts) opex += (PLANT[k]?.opex || 0) * S.plantCounts[k];
  for (const s of S.staff) opex += s.salary;
  const opexTick = opex / (30 * 24 * 60) * TICK_MIN;
  const salaryTick = 0;

  S.cash += revenue - powerCost - opexTick - salaryTick;
  S.ledger.revenue += revenue;
  S.ledger.power += powerCost;
  S.ledger.opex += opexTick;

  /* ── 4.5 월 단위 SLA 정산 ───────────────────────────────
   *
   * ★ 원래는 계약이 끝날 때만 SLA 를 따졌다. 계약이 8~18개월짜리라, 온도가
   *   75℃ 로 삶기고 전 계약이 죽어 있어도 **몇 달 동안 아무 신호가 없었다.**
   *   매출이 준다는 것 말고는 화면에 위약금도 평판 하락도 안 뜬다.
   *   실제 계약도 월 단위로 정산한다. 늦은 벌은 배움이 되지 않는다. */
  for (const c of S.contracts) {
    if (!c.active) continue;
    c.monthMin = (c.monthMin || 0) + TICK_MIN;
    c.monthDown = (c.monthDown || 0) + ((S.blackout || (S.floors[c.floor] && (S.floors[c.floor].tempC > 40 || S.floors[c.floor].powerOff))) ? TICK_MIN : 0);
    if (c.monthMin >= 30 * 24 * 60) {
      const up = (1 - c.monthDown / c.monthMin) * 100;
      if (up < c.sla) {
        const miss = Math.min(1, (c.sla - up) / Math.max(c.sla, 1) * 12);
        /* 위약금은 그 계약 월 매출의 배수를 넘지 않는다. 상한이 없으면
           한 번 어긋났을 때 복구 불가능한 숫자가 나와 게임이 끝나 버린다. */
        const monthly = c.baseKw * c.rate;
        const pen = Math.min(monthly * 1.2, monthly * (0.15 + miss));
        S.cash -= pen; S.ledger.penalty += pen;
        S.reputation = Math.max(0, S.reputation - (up < 90 ? 6 : 2));
        notes.push({ kind: 'bad', msg: `월 정산 — ${c.name} 가동률 ${up.toFixed(2)}% (약정 ${c.sla}%) 위약금 ${fmtMoney(pen)}` });
      }
      c.monthMin = 0; c.monthDown = 0;
    }
  }

  /* ── 5. 계약 만료 ───────────────────────────────────────── */
  for (const c of S.contracts) {
    if (!c.active) continue;
    c.remainMin -= TICK_MIN;
    if (c.remainMin <= 0) {
      c.active = false;
      const uptime = c.totalMin ? (1 - c.downMin / c.totalMin) * 100 : 100;
      const met = uptime >= c.sla;
      freeLoad(S, c);
      if (met) { S.reputation = Math.min(100, S.reputation + 2); notes.push({ kind: 'good', msg: `계약 만료 — ${c.name} SLA 달성 (${uptime.toFixed(2)}%)` }); }
      else {
        const penalty = c.kw * c.rate * 0.5;
        S.cash -= penalty; S.ledger.penalty += penalty;
        S.reputation = Math.max(0, S.reputation - 8);
        notes.push({ kind: 'bad', msg: `계약 만료 — ${c.name} SLA 미달 (${uptime.toFixed(2)}% < ${c.sla}%) 위약금 ${fmtMoney(penalty)}` });
      }
    }
  }
  return notes;
}

/* 계약을 랙에 배치한다. 용량이 모자라면 실패 — 이 판정이 곧 증설 압력이다. */
export function placeLoad(S, contract) {
  const wantLiquid = contract.needs === 'liquid';
  for (let fi = 0; fi < S.floors.length; fi++) {
    const f = S.floors[fi];
    let free = 0;
    for (const t of f.tiles) {
      if (!t) continue;
      const spec = PLACEABLE[t.type];
      if (spec?.kind !== 'rack') continue;
      if (wantLiquid !== (spec.cooling === 'liquid')) continue;
      free += spec.capacityKw - (t.loadKw || 0);
    }
    if (free + 1e-6 < contract.kw) continue;
    let need = contract.kw;
    for (const t of f.tiles) {
      if (!t || need <= 0) continue;
      const spec = PLACEABLE[t.type];
      if (spec?.kind !== 'rack') continue;
      if (wantLiquid !== (spec.cooling === 'liquid')) continue;
      const room = spec.capacityKw - (t.loadKw || 0);
      const put = Math.min(room, need);
      t.loadKw = (t.loadKw || 0) + put;
      (contract.placed ||= []).push({ floor: fi, tile: f.tiles.indexOf(t), kw: put });
      need -= put;
    }
    contract.floor = fi;
    return true;
  }
  return false;
}

export function freeLoad(S, contract) {
  for (const p of contract.placed || []) {
    const t = S.floors[p.floor]?.tiles[p.tile];
    if (t) t.loadKw = Math.max(0, (t.loadKw || 0) - p.kw);
  }
  contract.placed = [];
}

export function fmtMoney(n) {
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(2) + '억';
  if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
  return Math.round(n).toLocaleString('ko-KR');
}
