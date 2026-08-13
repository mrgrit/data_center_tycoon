/* 장비·계약 카탈로그 — 게임의 모든 수치가 여기 모여 있다.
 *
 * 숫자를 코드 곳곳에 흩어 놓으면 균형을 잡을 수 없다. 한 파일에 모아 두면
 * "GPU 랙이 너무 싸다" 같은 판단을 한눈에 하고 한 줄로 고칠 수 있다.
 *
 * 단위는 전부 실제 단위다 — kW, ℃, 리터, 원. 교보재를 겸하는 게임이라
 * 화면에 뜨는 수치가 현실의 수치와 같은 뜻이어야 한다.
 */

export const TICK_MIN = 1;              // 1틱 = 게임 내 1분
export const KWH_PRICE = 165;           // 원/kWh (산업용 대략치)
export const AMBIENT_TARGET = 22;       // 목표 실내온도(℃)

/* 랙 — 전산실 바닥에 놓는다. capacityKw 만큼 워크로드를 받는다. */
export const RACKS = {
  rack_std: {
    id: 'rack_std', kind: 'rack', name: '표준 랙', short: 'STD',
    cost: 12_000_000, opex: 120_000, capacityKw: 10, color: '#3b82f6',
    cooling: 'air',
    desc: '일반 서버용 19인치 랙. 공랭으로 충분하다.',
  },
  rack_hd: {
    id: 'rack_hd', kind: 'rack', name: '고밀도 랙', short: 'HD',
    cost: 28_000_000, opex: 260_000, capacityKw: 25, color: '#6366f1',
    cooling: 'air',
    desc: '같은 바닥 면적에 2.5배를 담는다. 공랭의 한계 근처라 기류가 중요하다.',
  },
  rack_gpu: {
    id: 'rack_gpu', kind: 'rack', name: 'GPU 랙', short: 'GPU',
    cost: 90_000_000, opex: 900_000, capacityKw: 50, color: '#a855f7',
    cooling: 'liquid',
    desc: 'AI 학습용. 액랭(CDU)이 없으면 열을 못 뺀다.',
    requires: 'cdu',
  },
};

/* 냉각 — 같은 층의 열을 뺀다. COP 가 높을수록 같은 열을 적은 전기로 뺀다. */
export const COOLERS = {
  crac: {
    id: 'crac', kind: 'cooler', name: '항온항습기(CRAC)', short: 'CRAC',
    cost: 30_000_000, opex: 230_000, removeKw: 40, cop: 3.0, serves: 'air',
    color: '#0ea5e9',
    desc: '가장 흔한 공랭 장비. 튼튼하지만 효율은 낮다.',
  },
  inrow: {
    id: 'inrow', kind: 'cooler', name: '인로우 냉각', short: 'InRow',
    cost: 38_000_000, opex: 250_000, removeKw: 35, cop: 4.2, serves: 'air',
    color: '#22d3ee',
    desc: '랙 사이에 끼운다. 열원에 가까워 같은 열을 적은 전기로 뺀다.',
  },
  cdu: {
    id: 'cdu', kind: 'cooler', name: '액랭 분배장치(CDU)', short: 'CDU',
    cost: 120_000_000, opex: 800_000, removeKw: 150, cop: 8.0, serves: 'liquid',
    color: '#14b8a6',
    desc: '직수냉. 공랭으로 불가능한 밀도를 감당한다. 대신 물이 랙 안으로 들어간다.',
  },
};

export const PLACEABLE = { ...RACKS, ...COOLERS };

/* 설비(플랜트) — 바닥에 놓지 않고 용량으로 산다. 전력 경로의 각 지점이다. */
export const PLANT = {
  feed: {
    id: 'feed', name: '수전 용량 증설', cost: 40_000_000, opex: 200_000,
    add: { feedKw: 200 }, max: 8,
    desc: '한전에서 받는 용량. 이걸 넘으면 아무것도 못 늘린다.',
  },
  transformer: {
    id: 'transformer', name: '변압기', cost: 60_000_000, opex: 180_000,
    add: { trafoKw: 250 }, max: 8,
    desc: '수전을 받아 건물로 내린다. 여기가 병목이면 수전이 남아도 소용없다.',
  },
  ups: {
    id: 'ups', name: 'UPS', cost: 80_000_000, opex: 400_000,
    add: { upsKw: 150, batteryKwh: 25 }, max: 10,
    desc: '정전 순간을 메운다. 용량과 지속시간은 다른 값이다.',
  },
  generator: {
    id: 'generator', name: '비상 발전기', cost: 140_000_000, opex: 500_000,
    add: { genKw: 300, fuelL: 2000 }, max: 6,
    desc: '정전이 길어지면 이것뿐이다. 연료가 없으면 쇳덩이다.',
  },
  chiller: {
    id: 'chiller', name: '냉동기', cost: 90_000_000, opex: 330_000,
    add: { chillerKw: 250 }, max: 8,
    desc: '냉각 장비에 냉수를 공급한다. 이 용량이 모자라면 CRAC 이 아무리 많아도 못 뺀다.',
  },
  economizer: {
    id: 'economizer', name: '외기 이코노마이저', cost: 70_000_000, opex: 150_000,
    add: { econ: 1 }, max: 3,
    desc: '바깥이 추우면 냉동기를 끄고 외기로 식힌다. 겨울 전기요금이 눈에 띄게 준다.',
  },
};

/* 계약 — 수익원. kW 를 요구하고 SLA 를 요구한다.
 *
 * ★ 단가의 하한은 전기요금이 정한다. 1kW 를 한 달 내내 켜 두면
 *   1 × 165원 × 720시간 = 약 119,000원이고, PUE 1.5 면 178,000원이다.
 *   처음에 단가를 95,000~130,000원으로 잡았다가 120일 시뮬레이션에서
 *   **매출보다 전기요금이 큰** 구조가 나왔다. 무엇을 해도 망하는 게임이었다.
 *   실제 코로케이션 단가(kW 당 월 30~50만원대)에 맞춰 다시 잡았다. */
export const CONTRACT_TYPES = [
  {
    id: 'web', name: '웹 호스팅', color: '#38bdf8',
    kw: [4, 14], rate: [330_000, 400_000], months: [6, 18], sla: 99.0,
    minRep: 0, needs: 'air',
    flavor: '중소 쇼핑몰. 요구는 소박하고 돈도 소박하다.',
  },
  {
    id: 'db', name: '기간계 DB', color: '#818cf8',
    kw: [10, 30], rate: [430_000, 520_000], months: [12, 36], sla: 99.9,
    minRep: 12, needs: 'air',
    flavor: '금융권 백업 사이트. 멈추면 위약금이 아프다.',
  },
  {
    id: 'stream', name: '스트리밍 엣지', color: '#22d3ee',
    kw: [18, 45], rate: [390_000, 470_000], months: [6, 24], sla: 99.5,
    minRep: 40, needs: 'air',
    flavor: '저녁에 부하가 몰린다. 피크를 견딜 수 있는가.',
  },
  {
    id: 'ai_inf', name: 'AI 추론 서비스', color: '#c084fc',
    kw: [40, 90], rate: [520_000, 650_000], months: [12, 24], sla: 99.9,
    minRep: 55, needs: 'liquid',
    flavor: 'GPU 랙과 액랭이 있어야 받을 수 있다. 단가가 다르다.',
  },
  {
    id: 'ai_train', name: 'AI 학습 클러스터', color: '#f472b6',
    kw: [90, 200], rate: [600_000, 780_000], months: [18, 36], sla: 99.5,
    minRep: 70, needs: 'liquid',
    flavor: '한 건으로 매출이 뒤집힌다. 전력도 열도 한 건으로 뒤집힌다.',
  },
];

/* 직원 — 사고 대응 속도와 예방을 좌우한다. */
export const STAFF = {
  tech:   { id: 'tech',   name: '설비 기술자', salary: 3_200_000,
            desc: '고장 수리 시간을 줄인다. 없으면 외주를 불러야 하고 비싸고 느리다.' },
  ops:    { id: 'ops',    name: '운영 담당',   salary: 3_500_000,
            desc: '경보를 먼저 잡는다. 사고가 커지기 전에 알려 준다.' },
  sec:    { id: 'sec',    name: '보안 담당',   salary: 3_800_000,
            desc: '사이버 사고의 피해를 줄인다. 평판 하락도 막아 준다.' },
};

export const FLOOR_COST = [0, 0, 180_000_000, 320_000_000, 520_000_000];
export const GRID_W = 8;
export const GRID_H = 5;
