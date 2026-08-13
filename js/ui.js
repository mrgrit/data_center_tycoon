/* 화면 — DOM 갱신과 입력.
 *
 * 매 프레임 innerHTML 을 갈아 끼우면 스크롤 위치가 튀고 클릭이 씹힌다.
 * 그래서 **자주 바뀌는 것(수치)** 과 **가끔 바뀌는 것(목록)** 을 분리해서,
 * 목록은 내용이 실제로 달라졌을 때만 다시 그린다.
 */
import { RACKS, COOLERS, PLANT, STAFF, PLACEABLE, FLOOR_COST } from './catalog.js';
import { fmtMoney } from './sim.js';
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
  return `
    <div class="stat"><b class="${cash}">${fmtMoney(S.cash)}원</b><span>자금</span></div>
    <div class="stat"><b>${day} ${hm}</b><span>날짜</span></div>
    <div class="stat"><b>${S.reputation.toFixed(0)}</b><span>평판</span></div>
    <div class="stat"><b class="${fC}">${S.demandKw.toFixed(0)} / ${S.plant.feedKw} kW</b><span>전력 (수전 대비 ${feedPct.toFixed(0)}%)</span></div>
    <div class="stat"><b class="${pueC}">${S.pue ? S.pue.toFixed(2) : '—'}</b><span>PUE</span></div>
    <div class="stat"><b class="${tC}">${hot.toFixed(1)}℃</b><span>최고 실내온도</span></div>
    <div class="stat"><b>${used.toFixed(0)} / ${cap} kW</b><span>랙 사용</span></div>
    <div class="stat"><b class="${head < 0 ? 'bad' : head < 20 ? 'warn' : ''}">${head >= 0 ? '+' : ''}${head.toFixed(0)} kW</b><span>제열 여유 (${state.floorIdx + 1}F)</span></div>
    <div class="stat"><b>${S.outsideC.toFixed(1)}℃</b><span>외기${S.heatwave ? ' (폭염)' : ''}</span></div>
    ${S.utilityDown ? `<div class="stat"><b class="bad">${S.onGenerator ? `발전기 · 연료 ${S.plant.fuelL.toFixed(0)}L` : `배터리 ${S.plant.batteryKwh.toFixed(1)}kWh`}</b><span>정전 중</span></div>` : ''}
    ${S.blackout ? `<div class="stat"><b class="bad">${esc(S.trips.join(', '))}</b><span>차단</span></div>` : ''}`;
}

export function renderStats(S) { $('stats').innerHTML = statHtml(S); }

function once(key, val, fn) {
  if (sig[key] === val) return;
  sig[key] = val; fn();
}

export function renderBuild(S) {
  const k = `${S.cash | 0}|${state.tool}`;
  once('build', k, () => {
    const card = (s) => `
      <div class="item ${state.tool === s.id ? 'sel' : ''}" data-tool="${s.id}">
        <h4><span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>
            <span class="price">${fmtMoney(s.cost)}</span></h4>
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
      (FLOOR_COST[S.floors.length + 1]
        ? `<button id="btnFloor" style="margin-top:6px">${S.floors.length + 1}층 개설 — ${fmtMoney(FLOOR_COST[S.floors.length + 1])}</button>` : '');
  });
}

export function renderPlant(S) {
  const k = Object.values(S.plantCounts).join(',') + '|' + (S.cash | 0);
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
        <div class="row"><button data-plant="${p.id}" ${n >= p.max ? 'disabled' : ''}>
          ${n >= p.max ? '최대' : '증설'}</button></div>
      </div>`;
    }).join('');
  });
}

export function renderStaff(S) {
  once('staff', S.staff.map((s) => s.id).join(',') + (S.cash | 0), () => {
    $('tabStaff').innerHTML = Object.values(STAFF).map((s) => {
      const has = S.staff.some((x) => x.id === s.id);
      return `<div class="item">
        <h4><span>${s.name}</span><span class="price">월 ${fmtMoney(s.salary)}</span></h4>
        <p>${s.desc}</p>
        <div class="row"><button data-hire="${s.id}" ${has ? 'disabled' : ''}>${has ? '고용됨' : '채용'}</button></div>
      </div>`;
    }).join('');
  });
}

export function renderOffers(S) {
  once('offers', S.offers.map((o) => o.id).join(',') + (S.cash | 0), () => {
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
  once('active', act.map((c) => `${c.id}:${c.downMin | 0}`).join(','), () => {
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

export function showEvent(ev, onPick) {
  $('mTitle').textContent = ev.name;
  $('mText').textContent = ev.text;
  $('mOpts').innerHTML = ev.options.map((o, i) => `
    <button class="opt" data-opt="${i}">
      <b>${o.label}</b>
      ${o.cost ? `<span class="cost">비용 ${fmtMoney(o.cost)}${o.minutes ? ` · ${o.minutes}분` : ''}</span>` : ''}
      ${o.note ? `<small>${o.note}</small>` : ''}
    </button>`).join('');
  $('modal').classList.remove('hide');
  $('mOpts').onclick = (e) => {
    const b = e.target.closest('[data-opt]'); if (!b) return;
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
