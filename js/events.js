/* 사고 — 이 게임이 관리 시뮬레이션이 되는 이유.
 *
 * 사고를 그냥 "돈을 깎는 벌칙"으로 만들면 게임이 지루해진다. 좋은 사고는
 * **판단을 요구**한다. 지금 고칠 것인가 버틸 것인가, 무엇을 먼저 끊을 것인가,
 * 아까운 계약을 포기할 것인가.
 *
 * 그래서 모든 사고에 대응 선택지를 붙였고, 어느 선택도 공짜가 아니다.
 */
import { fmtMoney } from './sim.js';
import { PLACEABLE } from './catalog.js';

let seq = 1;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ★ 대응 비용은 **시설 규모에 비례**해야 한다.
 *
 *   예전엔 전부 고정값이었다. CRAC 한 대 외주 출동 1,200만원은 50kW 짜리
 *   시설(월 영업이익 375만원)에는 세 달치 이익이고, 500kW 짜리에는 푼돈이다.
 *   3년 시뮬레이션에서 사고 대응비만 **월 6,714만원** — 잘 굴린 시설 영업이익의
 *   71% — 이 나갔고, 초반에는 벌어들이는 것보다 사고비가 커서 무엇을 해도
 *   현금이 줄었다. "무조건 망하는 게임"으로 느껴진 진짜 이유가 이것이다.
 *   이제 월매출에 연동한다. 작을 땐 작게, 클 땐 크게 — 판단의 무게는 같게. */
function monthly(S) {
  let m = 0;
  for (const c of S.contracts) if (c.active) m += c.kw * c.rate;
  return m;
}
const rel = (S, frac, floor) => Math.round(Math.max(floor, monthly(S) * frac) / 100_000) * 100_000;

function coolers(S) {
  const out = [];
  S.floors.forEach((f, fi) => f.tiles.forEach((t, ti) => {
    if (t && PLACEABLE[t.type]?.kind === 'cooler') out.push({ fi, ti, t });
  }));
  return out;
}

export const EVENTS = [
  {
    id: 'crac_fail', name: '냉각 장비 정지', weight: 22, minDay: 3,
    can: (S) => coolers(S).length > 0,
    fire(S) {
      const c = pick(coolers(S));
      c.t.broken = true;
      return {
        text: `${c.fi + 1}층 ${PLACEABLE[c.t.type].name} 1대가 멈췄다. 그 층의 냉각 능력이 줄었다.`,
        ref: c,
        options: [
          { label: '자체 수리 (기술자 필요)', cost: rel(S, 0.02, 800_000), needStaff: 'tech', minutes: 90,
            note: '기술자가 있으면 싸고 빠르다. 없으면 이 선택지가 막힌다.' },
          { label: '외주 긴급 출동', cost: rel(S, 0.07, 1_800_000), minutes: 240,
            note: '비싸고 느리다. 그 동안 온도는 계속 오른다.' },
          { label: '일단 둔다', cost: 0, minutes: 0, leave: true,
            note: '남은 장비로 버틴다. 여유가 있으면 옳은 판단일 수도 있다.' },
        ],
      };
    },
  },
  {
    id: 'utility_out', name: '한전 정전', weight: 5, minDay: 8,
    fire(S) {
      S.utilityDown = true;
      /* 2년에 68번은 현실의 30배였고, 그러면 발전기 유무가 아니라 운이
         SLA 를 정한다. 실제 수전 정전은 연 1~2회다. 빈도를 낮추는 대신
         한 번의 무게를 키운다 — 드물게 오고 오래 간다. */
      S.utilityMin = 90 + Math.floor(Math.random() * 300);
      const gen = S.plant.genKw > 0;
      return {
        text: gen
          ? `수전이 끊겼다. 발전기가 받는다. 연료 ${Math.round(S.plant.fuelL)}L 남았다.`
          : `수전이 끊겼다. 발전기가 없다 — 남은 것은 UPS 배터리 ${S.plant.batteryKwh.toFixed(0)}kWh 뿐이고, `
            + `지금 부하 ${S.demandKw.toFixed(0)}kW 로는 ${(S.plant.batteryKwh / Math.max(S.demandKw, 1) * 60).toFixed(0)}분이면 바닥난다. `
            + `UPS 는 초 단위를 메우는 장비다. 시간 단위는 발전기의 몫이다.`,
        options: [
          { label: '비필수 부하 차단', cost: 0, minutes: 0, shed: true,
            note: '저단가 계약부터 끊어 소모를 늦춘다. SLA 는 깎인다.' },
          { label: '연료 긴급 반입', cost: rel(S, 0.03, 1_200_000), minutes: 60, fuel: 1500,
            note: '발전기가 있어야 의미가 있다.' },
          { label: '그대로 버틴다', cost: 0, minutes: 0, leave: true,
            note: '복구가 빠르면 아무 일도 아니다. 아니면 전면 정전이다.' },
        ],
      };
    },
  },
  {
    id: 'heatwave', name: '폭염', weight: 14, minDay: 15,
    fire(S) {
      S.heatwave = 8 + Math.floor(Math.random() * 6);
      S.heatwaveMin = 60 * (12 + Math.floor(Math.random() * 36));
      return {
        text: `폭염이다. 바깥 기온이 ${S.heatwave}℃ 더 오른다. 냉각기 효율이 그만큼 떨어진다.`,
        options: [
          { label: '설정 온도를 올린다', cost: 0, minutes: 0, setpoint: 2,
            note: '전기는 아끼지만 여유 온도가 줄어든다. 사고가 나면 시간이 없다.' },
          { label: '부하를 미리 줄인다', cost: 0, minutes: 0, shed: true,
            note: '들어오는 열 자체를 줄인다. 매출도 줄어든다.' },
          { label: '아무것도 안 한다', cost: 0, minutes: 0, leave: true },
        ],
      };
    },
  },
  {
    id: 'chiller_down', name: '냉동기 정지', weight: 9, minDay: 25,
    can: (S) => S.plant.chillerKw > 0,
    fire(S) {
      S.chillerDown = true;
      S.chillerDownUnits = 1;
      S.chillerMin = 90 + Math.floor(Math.random() * 180);
      const left = Math.max(0, S.plant.chillerKw - 250);
      return {
        text: `냉동기 1대가 정지했다. 남은 냉수 공급 ${left}kW. `
          + (left <= 0
              ? '예비 냉동기가 없어 공랭 계열(CRAC·InRow)이 전부 냉수를 못 받는다.'
              : '예비 용량이 있어 당장은 버틴다 — 여유가 얼마나 남았는지가 관건이다.'),
        options: [
          { label: '긴급 정비', cost: rel(S, 0.09, 2_500_000), minutes: 90, fixChiller: true },
          { label: '부하 차단으로 버틴다', cost: 0, minutes: 0, shed: true },
          { label: '기다린다', cost: 0, minutes: 0, leave: true },
        ],
      };
    },
  },
  {
    id: 'ddos', name: '트래픽 폭주(DDoS)', weight: 10, minDay: 20,
    can: (S) => !S.ddosUntil,
    fire(S) {
      /* ★ 예전엔 여기서 c.kw *= 1.25 만 하고 되돌리는 일을 '방어 장비 임대'
         선택지에만 맡겼다. 그 선택을 안 하면 배수가 **영구히 누적**된다.
         2년 시뮬레이션에서 55번 터지자 1.25^55 ≈ 360만 배가 되어 부하가
         발산했고, 위약금이 2,514억까지 갔다. 화면으로는 절대 못 봤을 것이다.
         이제 지속시간을 두고 자동으로 원복한다. 선택지는 '빨리 끝내는' 값이다. */
      S.ddosUntil = S.minutes + 120 + Math.floor(Math.random() * 300);
      for (const c of S.contracts) if (c.active) c.kw = c.baseKw * 1.25;
      return {
        text: '외부에서 대량 트래픽이 들어온다. 계약 부하가 25% 튀었다 — 전력도 열도 같이 튄다.',
        options: [
          { label: '방어 장비 임대', cost: rel(S, 0.05, 1_200_000), minutes: 120, mitigate: true,
            note: '부하를 원래대로 되돌린다.' },
          { label: '해당 계약만 차단', cost: 0, minutes: 0, shed: true,
            note: '가장 큰 계약을 끊는다. SLA 위반이지만 나머지는 지킨다.' },
          { label: '견딘다', cost: 0, minutes: 0, leave: true },
        ],
      };
    },
  },
  {
    id: 'leak', name: 'CDU 누수', weight: 8, minDay: 30,
    can: (S) => coolers(S).some((c) => c.t.type === 'cdu'),
    fire(S) {
      const c = pick(coolers(S).filter((x) => x.t.type === 'cdu'));
      return {
        text: `${c.fi + 1}층 CDU 에서 누수가 감지됐다. 온도는 아직 정상이다 — 그러나 통전 중인 장비 옆에 물이 있다.`,
        ref: c,
        options: [
          { label: '해당 구역 전원 차단', cost: 0, minutes: 30, powerOff: c,
            note: '안전이 먼저다. 그 층 계약은 그 시간 동안 죽는다.' },
          { label: '가동 중 응급 조치', cost: rel(S, 0.04, 1_200_000), minutes: 60, risky: 0.35,
            note: '운이 나쁘면 사고가 커진다. 운이 좋으면 무중단으로 끝난다.' },
          { label: '온도 정상이니 둔다', cost: 0, minutes: 0, leave: true, risky: 0.6,
            note: '온도는 느린 시계만 보여 준다. 빠른 시계는 전기 사고다.' },
        ],
      };
    },
  },
  {
    id: 'audit', name: '고객 실사', weight: 8, minDay: 40,
    fire(S) {
      return {
        text: '대형 고객이 실사를 나온다. 이중화·유지보수 이력·전력 여유를 본다.',
        options: [
          { label: '정식 대응', cost: rel(S, 0.02, 900_000), minutes: 120, audit: true,
            note: '여유가 넉넉하면 평판이 오른다. 아니면 그대로 드러난다.' },
          { label: '최소 대응', cost: 0, minutes: 0, leave: true },
        ],
      };
    },
  },
  {
    id: 'ransom', name: '랜섬웨어 시도', weight: 7, minDay: 45,
    fire(S) {
      const guarded = S.staff.some((s) => s.id === 'sec');
      return {
        text: guarded
          ? '랜섬웨어 시도가 있었다. 보안 담당이 초기에 잡았다 — 피해는 제한적이다.'
          : '관리망이 암호화됐다. 보안 담당이 없어 초기 대응이 늦었다.',
        options: guarded
          ? [{ label: '정상 복구', cost: rel(S, 0.02, 900_000), minutes: 60 }]
          : [
              { label: '백업에서 복구', cost: rel(S, 0.12, 3_000_000), minutes: 300, note: '느리지만 확실하다.' },
              { label: '협상한다', cost: rel(S, 0.30, 8_000_000), minutes: 60, rep: -12,
                note: '빠르지만 비싸고, 알려지면 평판이 깎인다.' },
            ],
      };
    },
  },
];

export function maybeFire(S) {
  const day = S.minutes / (60 * 24);
  if (day < 3 || S.pendingEvent) return null;
  /* 규모가 커질수록 사고가 잦다 — 아무것도 없는 초반에 몰아치면 배울 새가 없다 */
  const scale = 1 + Math.min(2.5, S.demandKw / 250);
  /* 빈도를 두 번 고쳤다. 처음엔 120일에 366건(하루 3건)이라 두더지잡기였고,
     낮춘 뒤에도 3년에 364건 — **3일에 1건** 이었다. 사고 하나가 모달을 띄우고
     게임을 멈추는데 3일에 1건이면 운영이 아니라 소방이다. 게다가 대응비가
     쌓여 월 6,714만원이 나갔다. 지금은 초반 ~2주에 1건, 대형 시설 ~6일에 1건. */
  if (Math.random() > 0.000034 * scale) return null;
  const pool = EVENTS.filter((e) => day >= e.minDay && (!e.can || e.can(S)));
  if (!pool.length) return null;
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * total;
  for (const e of pool) { r -= e.weight; if (r <= 0) return { def: e, ...e.fire(S), id: seq++, name: e.name }; }
  return null;
}

/* 선택의 결과를 적용한다. 모든 선택이 무언가를 지불한다. */
export function resolve(S, ev, opt) {
  const log = [];
  if (opt.needStaff && !S.staff.some((s) => s.id === opt.needStaff)) {
    return [{ kind: 'bad', msg: '해당 직원이 없어 그 선택은 불가능하다.' }];
  }
  if (opt.cost) {
    S.cash -= opt.cost;
    /* ★ 이걸 장부에 안 남기면 손익표가 거짓말을 한다. 3년 시뮬레이션에서
       매출·전기·opex·capex 를 다 합쳐도 44억이 비었는데, 그게 전부 여기였다.
       플레이어는 돈이 어디로 갔는지 알 방법이 없었다. */
    S.ledger.incident = (S.ledger.incident || 0) + opt.cost;
    log.push({ kind: 'info', msg: `${ev.name} 대응 — ${fmtMoney(opt.cost)} 지출` });
  }
  if (ev.ref && !opt.leave) {
    S.repairs.push({ ref: ev.ref, at: S.minutes + (opt.minutes || 0) });
    log.push({ kind: 'info', msg: `${opt.minutes}분 뒤 복구 예정` });
  }
  if (opt.leave && ev.ref) log.push({ kind: 'warn', msg: '고장난 채로 둔다 — 남은 냉각으로 버틴다' });
  if (opt.fuel) { S.plant.fuelL = Math.min(S.plant.fuelLMax, S.plant.fuelL + opt.fuel); log.push({ kind: 'good', msg: `연료 ${opt.fuel}L 반입` }); }
  if (opt.fixChiller) { S.chillerDown = false; S.chillerDownUnits = 0; S.chillerMin = 0; log.push({ kind: 'good', msg: '냉동기 복구' }); }
  if (opt.mitigate) {
    S.ddosUntil = 0;
    for (const c of S.contracts) if (c.active) c.kw = c.baseKw;
    log.push({ kind: 'good', msg: '트래픽 정상화' });
  }
  if (opt.setpoint) { S.setpointBonus = (S.setpointBonus || 0) + opt.setpoint; log.push({ kind: 'warn', msg: '설정 온도 상향 — 여유가 줄었다' }); }
  if (opt.shed) {
    const act = S.contracts.filter((c) => c.active).sort((a, b) => a.rate - b.rate);
    const victim = ev.def.id === 'ddos' ? act[act.length - 1] : act[0];
    if (victim) {
      victim.active = false;
      S.reputation = Math.max(0, S.reputation - 4);
      log.push({ kind: 'warn', msg: `${victim.name} 계약을 끊었다 — 평판 -4` });
    }
  }
  if (opt.powerOff) {
    S.floors[opt.powerOff.fi].powerOffUntil = S.minutes + (opt.minutes || 30);
    log.push({ kind: 'warn', msg: `${opt.powerOff.fi + 1}층 전원 차단 ${opt.minutes}분` });
  }
  if (opt.audit) {
    const margin = S.plant.feedKw > 0 ? 1 - S.demandKw / S.plant.feedKw : 0;
    if (margin > 0.35) { S.reputation = Math.min(100, S.reputation + 5); log.push({ kind: 'good', msg: '실사 통과 — 평판 +5' }); }
    else { S.reputation = Math.max(0, S.reputation - 4); log.push({ kind: 'bad', msg: '전력 여유 부족이 지적됐다 — 평판 -4' }); }
  }
  if (opt.rep) { S.reputation = Math.max(0, S.reputation + opt.rep); log.push({ kind: 'bad', msg: `평판 ${opt.rep}` }); }
  if (opt.risky && Math.random() < opt.risky) {
    const dmg = Math.max(5_000_000, monthly(S) * (0.10 + Math.random() * 0.20));
    S.cash -= dmg; S.ledger.incident = (S.ledger.incident || 0) + dmg; S.reputation = Math.max(0, S.reputation - 10);
    log.push({ kind: 'bad', msg: `사고가 커졌다 — 손실 ${fmtMoney(dmg)}, 평판 -10` });
  }
  return log;
}
