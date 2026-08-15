/* 화면 — DOM 갱신과 입력.
 *
 * 매 프레임 innerHTML 을 갈아 끼우면 스크롤 위치가 튀고 클릭이 씹힌다.
 * 그래서 **자주 바뀌는 것(수치)** 과 **가끔 바뀌는 것(목록)** 을 분리해서,
 * 목록은 내용이 실제로 달라졌을 때만 다시 그린다.
 */
import { RACKS, COOLERS, PLANT, STAFF, PLACEABLE, FLOOR_COST } from './catalog.js';
import { fmtMoney, netWorth } from './sim.js';
import * as W from './world.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const sig = {};                    // 목록별 마지막 서명 — 바뀔 때만 다시 그린다

export const state = { tool: null, floorIdx: 0 };

export function gameDate(minutes) {
  const d = new Date(2026, 2, 1, 8, 0);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function statHtml(S) {
  const d = gameDate(S.minutes);
  const day = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const r = W.racksOf(S);
  const cap = r.cap + r.capL, used = r.used + r.usedL;
  const feedPct = S.plant.feedKw ? (S.demandKw / S.plant.feedKw) * 100 : 0;
  const pueC = S.pue > 1.8 ? 'bad' : S.pue > 1.5 ? 'warn' : 'good';
  const hot = Math.max(...S.floors.map((f) => f.tempC));
  const head = W.coolHeadroom(S, state.floorIdx);
  const tC = hot > 34 ? 'bad' : hot > 28 ? 'warn' : 'good';
  const fC = feedPct > 92 ? 'bad' : feedPct > 78 ? 'warn' : '';
  const cash = S.cash < 0 ? 'bad' : '';
  const nw = netWorth(S);
  const pnl = S.pnl;
  const opC = !pnl ? '' : pnl.operating > 0 ? 'good' : 'bad';
  return `
    <div class="stat"><b class="${cash}">${fmtMoney(S.cash)}원</b><span>자금</span></div>
    <div class="stat"><b>${fmtMoney(nw.total)}원</b><span>순자산 (설비 ${fmtMoney(nw.asset)})</span></div>
    <div class="stat"><b class="${opC}">${pnl ? (pnl.operating >= 0 ? '+' : '') + fmtMoney(pnl.operating) : '—'}</b><span>지난달 영업이익</span></div>
    <div class="stat"><b>${day} ${hm}</b><span>날짜</span></div>
    <div class="stat"><b>${S.reputation.toFixed(0)}</b><span>평판</span></div>
    <div class="stat"><b class="${fC}">${S.demandKw.toFixed(0)} / ${S.plant.feedKw} kW</b><span>전력 (수전 대비 ${feedPct.toFixed(0)}%)</span></div>
    <div class="stat"><b class="${pueC}">${S.pue ? S.pue.toFixed(2) : '—'}</b><span>PUE</span></div>
    <div class="stat"><b class="${tC}">${hot.toFixed(1)}℃</b><span>최고 실내온도</span></div>
    <div class="stat"><b>${used.toFixed(0)} / ${cap} kW</b><span>랙 사용</span></div>
    <div class="stat"><b class="${head < 0 ? 'bad' : head < 20 ? 'warn' : ''}">${head >= 0 ? '+' : ''}${head.toFixed(0)} kW</b><span>제열 여유 (${state.floorIdx + 1}F)</span></div>
    <div class="stat"><b>${S.outsideC.toFixed(1)}℃</b><span>외기${S.heatwave ? ' (폭염)' : ''}</span></div>
    ${S.utilityDown ? `<div class="stat"><b class="bad">${S.onGenerator ? `발전기 · 연료 ${S.plant.fuelL.toFixed(0)}L` : `배터리 ${S.plant.batteryKwh.toFixed(1)}kWh`}</b><span>정전 중</span></div>` : ''}
    ${S.blackout ? `<div class="stat"><b class="bad">${esc(S.trips.join(', '))}</b><span>전면 정전</span></div>` : ''}
    ${!S.blackout && S.shedKw > 0 ? `<div class="stat"><b class="bad">${S.shedKw.toFixed(0)} kW</b><span>용량 초과로 차단됨 (${esc((S.shedNames || []).join(', '))})</span></div>` : ''}`;
}

let lastStats = '';
export function renderStats(S) {
  const html = statHtml(S);
  if (html === lastStats) return;         // 같은 내용을 다시 그리면 헤더가 깜빡인다
  lastStats = html; $('stats').innerHTML = html;
}

function once(key, val, fn) {
  if (sig[key] === val) return;
  sig[key] = val; fn();
}

/* ★ 목록 서명에 잔액(S.cash)을 그대로 넣고 있었다. 잔액은 매 틱 바뀌므로
 *   목록이 **초당 20번 통째로 갈아 끼워졌다.** 사람 손가락은 버튼 위에
 *   80~150ms 머무는데, 그 사이에 버튼이 사라지면 mousedown 과 mouseup 이
 *   다른 요소에 떨어져 click 이 아예 발생하지 않는다.
 *   실측: 사람 속도(90ms 유지)로 12번 눌러서 **0번 먹혔다.**
 *   그래서 "안 눌려서 막 누르다 보면 두 번 된다"가 됐고, 건설 도구도
 *   선택이 안 바뀐 채 이전 도구가 설치됐다.
 *
 *   잔액이 목록에 실제로 필요한 이유는 하나뿐이다 — **살 수 있는지 여부.**
 *   그건 가격선을 넘을 때만 바뀌므로, 잔액 대신 그 여부만 서명에 넣는다.
 *   초당 20번이 아니라 몇 분에 한 번 다시 그린다. */
const afford = (S, costs) => costs.map((c) => (S.cash >= c ? '1' : '0')).join('');

export function renderBuild(S) {
  const specs = [...Object.values(RACKS), ...Object.values(COOLERS)];
  const nextFloor = FLOOR_COST[S.floors.length + 1] || 0;
  const k = `${state.tool}|${S.floors.length}|${afford(S, [...specs.map((x) => x.cost), nextFloor])}`;
  once('build', k, () => {
    const card = (s) => `
      <div class="item ${state.tool === s.id ? 'sel' : ''} ${S.cash < s.cost ? 'poor' : ''}" data-tool="${s.id}">
        <h4><span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>
            <span class="price ${S.cash < s.cost ? 'bad' : ''}">${fmtMoney(s.cost)}</span></h4>
        <div class="spec">${s.kind === 'rack'
          ? `수용 ${s.capacityKw}kW · ${s.cooling === 'liquid' ? '액랭' : '공랭'}`
          : `제열 ${s.removeKw}kW · COP ${s.cop} · ${s.serves === 'liquid' ? '액랭' : '공랭'}`}
          · 월 ${fmtMoney(s.opex)}</div>
        <p>${s.desc}</p>
      </div>`;
    $('tabBuild').innerHTML =
      `<div class="empty" style="padding:4px 2px;text-align:left">장비를 고르고 바닥을 클릭한다.<br>우클릭하면 철거된다.</div>` +
      Object.values(RACKS).map(card).join('') +
      `<div style="height:6px"></div>` +
      Object.values(COOLERS).map(card).join('') +
      (nextFloor
        ? `<button id="btnFloor" style="margin-top:6px" ${S.cash < nextFloor ? 'disabled' : ''}>${S.floors.length + 1}층 개설 — ${fmtMoney(nextFloor)}</button>` : '');
  });
}

export function renderPlant(S) {
  const k = Object.values(S.plantCounts).join(',') + '|' + afford(S, Object.values(PLANT).map((x) => x.cost));
  once('plant', k, () => {
    $('tabPlant').innerHTML = Object.values(PLANT).map((p) => {
      const n = S.plantCounts[p.id] || 0;
      const add = Object.entries(p.add).map(([f, v]) => {
        const label = { feedKw: '수전', trafoKw: '변압', upsKw: 'UPS', batteryKwh: '배터리',
                        genKw: '발전', fuelL: '연료', chillerKw: '냉동', econ: '외기' }[f] || f;
        const unit = f === 'fuelL' ? 'L' : f === 'batteryKwh' ? 'kWh' : f === 'econ' ? '단' : 'kW';
        return `${label} +${v}${unit}`;
      }).join(' · ');
      return `<div class="item">
        <h4><span>${p.name} <span style="color:var(--dim2)">×${n}</span></span>
            <span class="price">${fmtMoney(p.cost)}</span></h4>
        <div class="spec">${add} · 월 ${fmtMoney(p.opex)}</div>
        <p>${p.desc}</p>
        <div class="row"><button data-plant="${p.id}" ${n >= p.max || S.cash < p.cost ? 'disabled' : ''}>
          ${n >= p.max ? '최대' : S.cash < p.cost ? '자금 부족' : '증설'}</button></div>
      </div>`;
    }).join('');
  });
}

export function renderStaff(S) {
  once('staff', S.staff.map((s) => s.id).join(',') + afford(S, Object.values(STAFF).map((x) => x.salary * 2)), () => {
    $('tabStaff').innerHTML = Object.values(STAFF).map((s) => {
      const has = S.staff.some((x) => x.id === s.id);
      return `<div class="item">
        <h4><span>${s.name}</span><span class="price">월 ${fmtMoney(s.salary)}</span></h4>
        <p>${s.desc}</p>
        <div class="row"><button data-hire="${s.id}" ${has || S.cash < s.salary * 2 ? 'disabled' : ''}>${
          has ? '고용됨' : S.cash < s.salary * 2 ? '두 달치 급여 필요' : '채용'}</button></div>
      </div>`;
    }).join('');
  });
}

export function renderOffers(S) {
  once('offers', S.offers.map((o) => o.id).join(','), () => {
    $('tabOffers').innerHTML = S.offers.length ? S.offers.map((o) => `
      <div class="item">
        <h4><span><span class="swatch" style="background:${o.color}"></span>${o.name}</span>
            <span class="price">월 ${fmtMoney(o.kw * o.rate)}</span></h4>
        <div class="spec">${o.kw}kW · ${o.months}개월 · SLA ${o.sla}% · ${o.needs === 'liquid' ? '액랭 필요' : '공랭'}</div>
        <p>${o.flavor}</p>
        <div class="row"><button data-accept="${o.id}">수주</button>
          <button data-reject="${o.id}" class="ghost">거절</button></div>
      </div>`).join('') : `<div class="empty">지금은 들어온 제안이 없다.<br>평판이 오르면 더 좋은 제안이 온다.</div>`;
  });
}

export function renderActive(S) {
  const act = S.contracts.filter((c) => c.active);
  /* 장애 중에는 downMin 이 매 틱 늘어난다 — 5분 단위로 뭉개야 목록이 안 튄다 */
  once('active', act.map((c) => `${c.id}:${Math.round(c.downMin / 5)}:${c.shed ? 1 : 0}`).join(','), () => {
    $('tabActive').innerHTML = act.length ? act.map((c) => {
      const up = c.totalMin ? (1 - c.downMin / c.totalMin) * 100 : 100;
      const ok = up >= c.sla;
      const days = Math.max(0, Math.round(c.remainMin / (60 * 24)));
      return `<div class="item">
        <h4><span><span class="swatch" style="background:${c.color}"></span>${c.name}</span>
            <span class="price">월 ${fmtMoney(c.kw * c.rate)}</span></h4>
        <div class="spec">${c.kw.toFixed(0)}kW · ${c.floor + 1}층 · ${days}일 남음</div>
        <div class="sla ${ok ? 'good' : 'bad'}">가동률 ${up.toFixed(2)}% / 약정 ${c.sla}%</div>
        <div class="bar"><i style="width:${Math.min(100, up)}%;background:${ok ? 'var(--good)' : 'var(--bad)'}"></i></div>
        <div class="row"><button data-drop="${c.id}" class="ghost">해지 (위약금)</button></div>
      </div>`;
    }).join('') : `<div class="empty">진행 중인 계약이 없다.<br>제안 탭에서 수주한다.</div>`;
  });
}

/* 손익 — 돈이 어디로 갔는지.
 *
 * ★ 이 화면이 없어서 문제를 못 봤다. 3년 시뮬레이션에서 매출·전기·opex·capex 를
 *   다 더해도 44억이 비었는데, 그게 전부 **사고 대응비**였고 장부에 안 잡혔다.
 *   플레이어에게는 "열심히 했는데 돈이 준다"로만 보였을 것이다.
 *   경영 시뮬레이션에서 손익표는 편의 기능이 아니라 본체다. */
export function renderPnl(S) {
  const p = S.pnl;
  const nw = netWorth(S);
  /* 순자산은 매 틱 바뀐다 — 그대로 서명에 쓰면 매 프레임 다시 그려서 스크롤이
     튄다. 백만원 단위로 뭉개면 눈에 띄는 변화만 다시 그린다. */
  once('pnl', `${p ? p.net.toFixed(0) : 'x'}|${Math.round(nw.total / 1e6)}`, () => {
    const line = (label, v, sign, note) => `
      <div class="pnlrow"><span>${label}</span>
        <b class="${sign > 0 ? 'good' : sign < 0 ? 'bad' : ''}">${sign < 0 ? '−' : sign > 0 ? '+' : ''}${fmtMoney(Math.abs(v))}</b>
      </div>${note ? `<div class="pnlnote">${note}</div>` : ''}`;
    $('tabPnl').innerHTML = `
      <div class="item">
        <h4><span>순자산</span><span class="price">${fmtMoney(nw.total)}</span></h4>
        <div class="spec">현금 ${fmtMoney(S.cash)} + 설비 장부가 ${fmtMoney(nw.asset)}</div>
        <p>증설은 돈이 사라지는 것이 아니라 <b>자산으로 옮겨 가는 것</b>이다.
           현금만 보면 투자가 전부 손실로 보인다.</p>
      </div>
      ${!p ? `<div class="empty">첫 달 결산까지 기다린다.<br>한 달이 지나면 여기에 손익이 뜬다.</div>` : `
      <div class="item">
        <h4><span>지난달 손익</span>
            <span class="price ${p.net >= 0 ? 'good' : 'bad'}">${p.net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(p.net))}</span></h4>
        ${line('매출', p.revenue, 1)}
        ${line('전기요금', p.power, -1, `PUE ${S.pue ? S.pue.toFixed(2) : '—'} — IT 1kW 마다 ${S.pue ? S.pue.toFixed(2) : '—'}kW 를 낸다`)}
        ${line('고정비 (장비·설비·급여)', p.opex, -1)}
        ${line('사고 대응비', p.incident, -1, '수리·외주·방어장비·복구. 여기가 크면 예방이 싸다')}
        ${line('SLA 위약금', p.penalty, -1)}
        <div class="pnlrow tot"><span>영업이익</span>
          <b class="${p.operating >= 0 ? 'good' : 'bad'}">${p.operating >= 0 ? '+' : '−'}${fmtMoney(Math.abs(p.operating))}</b></div>
        ${line('증설 투자 (capex)', p.capex, -1, '자산으로 남는다 — 위 순자산에 더해져 있다')}
      </div>`}
      <div class="item">
        <h4><span>누적</span></h4>
        ${line('매출', S.ledger.revenue, 1)}
        ${line('전기요금', S.ledger.power, -1)}
        ${line('고정비', S.ledger.opex, -1)}
        ${line('사고 대응비', S.ledger.incident || 0, -1)}
        ${line('위약금', S.ledger.penalty, -1)}
        ${line('증설 투자', S.ledger.capex, -1)}
      </div>`;
  });
}

export function renderLog(S) {
  once('log', S.log.length ? `${S.log.length}:${S.log[0].t}` : '0', () => {
    $('tabLog').innerHTML = S.log.length ? S.log.map((l) => {
      const d = gameDate(l.t);
      return `<div class="logline"><span class="t">${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span><span class="${l.kind}">${esc(l.msg)}</span></div>`;
    }).join('') : `<div class="empty">아직 기록이 없다.</div>`;
  });
}

export function renderFloorbar(S) {
  once('floorbar', `${S.floors.length}|${state.floorIdx}`, () => {
    $('floorbar').innerHTML = S.floors.map((_, i) =>
      `<button data-floor="${i}" class="${i === state.floorIdx ? 'on' : ''}">${i + 1}F</button>`)
      .reverse().join('');
  });
}

let hintTimer = 0;
export function hint(msg, ms = 2600) {
  const el = $('hint');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function showEvent(S, ev, onPick) {
  $('mTitle').textContent = ev.name;
  $('mText').textContent = ev.text;
  /* ★ 직원이 없어 못 고르는 선택지를 그냥 보여 주면, 눌렀을 때 "그 직원이
     없다"는 로그만 남고 **사고가 아무 조치 없이 사라진다.** 4분짜리 실주행에서
     정확히 이게 일어났다 — 기술자 없이 '자체 수리'를 고르는 바람에 CRAC 두 대가
     고장 난 채 복구되지 않았고 실온이 75℃ 까지 갔다. 고를 수 없는 것은
     고를 수 없게 보여야 한다. */
  $('mOpts').innerHTML = ev.options.map((o, i) => {
    const blocked = o.needStaff && !S.staff.some((s) => s.id === o.needStaff);
    return `
    <button class="opt" data-opt="${i}" ${blocked ? 'disabled' : ''}>
      <b>${o.label}</b>
      ${o.cost ? `<span class="cost">비용 ${fmtMoney(o.cost)}${o.minutes ? ` · ${o.minutes}분` : ''}</span>` : ''}
      ${blocked ? `<small class="bad">${STAFF[o.needStaff].name} 가 없어 고를 수 없다 — 인력 탭에서 채용한다</small>`
                : o.note ? `<small>${o.note}</small>` : ''}
    </button>`;
  }).join('');
  $('modal').classList.remove('hide');
  $('mOpts').onclick = (e) => {
    const b = e.target.closest('[data-opt]');
    if (!b || b.disabled) return;
    $('modal').classList.add('hide');
    onPick(ev.options[+b.dataset.opt]);
  };
}

export function showOver(title, text, onAgain) {
  $('oTitle').textContent = title;
  $('oText').textContent = text;
  $('over').classList.remove('hide');
  $('oBtn').onclick = onAgain;
}

export function invalidate() { for (const k in sig) delete sig[k]; }
