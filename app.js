'use strict';

const STORAGE_KEY = 'boatrace-fixed-rate-v1';
const UNIT = 100; // 舟券の最小購入単位(円)
const VENUES = [
  '桐生', '戸田', '江戸川', '平和島', '多摩川', '浜名湖', '蒲郡', '常滑',
  '津', '三国', 'びわこ', '住之江', '尼崎', '鳴門', '丸亀', '児島',
  '宮島', '徳山', '下関', '若松', '芦屋', '福岡', '唐津', '大村',
];

const $ = (id) => document.getElementById(id);
const yen = (n) => n.toLocaleString('ja-JP');
const signed = (n) => (n > 0 ? '+' : '') + yen(n);

let state = load();

function emptyState() {
  return { capital: null, rate: 5, venue: '', records: [] };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.records)) return { ...emptyState(), ...saved };
  } catch (e) { /* 読めないときは初期状態で開始 */ }
  return emptyState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* 保存できない環境ではそのセッション内のみ有効 */ }
}

function currentFunds() {
  const last = state.records[state.records.length - 1];
  return last ? last.after : state.capital;
}

// 資金×割合を100円単位で切り捨て、100円未満なら100円にする。資金が100円未満なら購入不可(0円)。
// 小数誤差を避けるため割合は0.1%単位の整数で計算する。
function stakeFor(funds, rate) {
  if (funds < UNIT) return 0;
  const tenths = Math.round(rate * 10);
  return Math.max(UNIT, Math.floor((funds * tenths) / (1000 * UNIT)) * UNIT);
}

function parseRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0.1 || rate > 100) return null;
  return Math.round(rate * 10) / 10;
}

function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${y}/${m}/${d}`;
}

/* ---------- 描画 ---------- */

function render() {
  const started = state.capital !== null;
  $('setup').hidden = started;
  $('app').hidden = !started;
  if (!started) return;

  const funds = currentFunds();
  const stake = stakeFor(funds, state.rate);
  const canBet = stake >= UNIT;

  $('current').textContent = yen(funds);
  $('stake').textContent = yen(stake);
  if (document.activeElement !== $('rate')) $('rate').value = state.rate;

  const note = $('stake-note');
  note.classList.toggle('warn', !canBet);
  note.textContent = canBet
    ? `資金 ${yen(funds)}円 × ${state.rate}% を100円単位で切り捨て(最低100円)`
    : '軍資金がなくなりました。';
  $('btn-hit').disabled = !canBet;
  $('btn-miss').disabled = !canBet;

  renderStats(funds);
  renderHistory();
  $('btn-undo').disabled = state.records.length === 0;
  $('btn-csv').disabled = state.records.length === 0;
}

function renderStats(funds) {
  const { records, capital } = state;
  const totalStake = records.reduce((sum, r) => sum + r.stake, 0);
  const totalPayout = records.reduce((sum, r) => sum + r.payout, 0);
  const hits = records.filter((r) => r.hit).length;
  const profit = funds - capital;

  $('s-capital').textContent = yen(capital);
  const profitEl = $('s-profit');
  profitEl.textContent = signed(profit);
  profitEl.className = profit > 0 ? 'plus' : profit < 0 ? 'minus' : '';
  $('s-return').textContent = totalStake ? `${((totalPayout / totalStake) * 100).toFixed(1)}%` : '-';
  $('s-hit').textContent = records.length
    ? `${((hits / records.length) * 100).toFixed(1)}%`
    : '-';
}

function renderHistory() {
  const list = $('history');
  list.replaceChildren();
  $('history-empty').hidden = state.records.length > 0;

  [...state.records].reverse().forEach((r) => {
    const li = document.createElement('li');

    const top = document.createElement('div');
    top.className = 'h-top';
    const title = document.createElement('span');
    title.textContent = `${formatDate(r.date)} ${r.venue} ${r.race}R`;
    const tag = document.createElement('span');
    tag.className = `tag ${r.hit ? 'tag-hit' : 'tag-miss'}`;
    tag.textContent = r.hit ? '的中' : '不的中';
    title.append(tag);
    const profit = r.payout - r.stake;
    const profitEl = document.createElement('span');
    profitEl.className = `h-profit ${profit > 0 ? 'plus' : profit < 0 ? 'minus' : ''}`;
    profitEl.textContent = `${signed(profit)}円`;
    top.append(title, profitEl);

    const sub = document.createElement('div');
    sub.className = 'h-sub';
    const detail = document.createElement('span');
    detail.textContent = `賭け金 ${yen(r.stake)}円(${r.rate}%)` + (r.hit ? ` / 払戻 ${yen(r.payout)}円` : '');
    const after = document.createElement('span');
    after.textContent = `資金 ${yen(r.after)}円`;
    sub.append(detail, after);

    li.append(top, sub);
    list.append(li);
  });
}

/* ---------- CSV出力 ---------- */

function buildCsv() {
  const header = ['日付', 'レース場', 'レース', '結果', '割合(%)', '賭け金', '払戻金', '収支', 'レース前資金', 'レース後資金'];
  const rows = state.records.map((r) => [
    r.date, r.venue, `${r.race}R`, r.hit ? '的中' : '不的中', r.rate,
    r.stake, r.payout, r.payout - r.stake, r.before, r.after,
  ]);
  return [header, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n';
}

function downloadCsv() {
  // Excelで文字化けしないようにBOM付きUTF-8で出力する
  const blob = new Blob(['﻿', buildCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `boatrace_teiritsu_${todayLocal().replaceAll('-', '')}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- レース入力 ---------- */

function readRace() {
  const date = $('date').value;
  const venue = $('venue').value;
  const race = Number($('race').value);
  const errorEl = $('race-error');

  let error = '';
  if (!date) error = '日付を入力してください。';
  else if (!venue) error = 'レース場を選択してください。';
  else if (!race) error = 'レースを選択してください。';
  else if (state.records.some((r) => r.date === date && r.venue === venue && r.race === race)) {
    error = `${formatDate(date)} ${venue} ${race}R はすでに記録済みです。`;
  }
  errorEl.textContent = error;
  return error ? null : { date, venue, race };
}

function addRecord(race, hit, payout) {
  const before = currentFunds();
  const stake = stakeFor(before, state.rate);
  state.records.push({
    ...race,
    hit,
    stake,
    payout,
    rate: state.rate,
    before,
    after: before - stake + payout,
  });
  state.venue = race.venue;
  save();

  // 同じ場の次のレースを入力しやすいように進める
  if (race.race < 12) $('race').value = String(race.race + 1);
  render();
}

let pendingRace = null;

function openHitDialog() {
  const race = readRace();
  if (!race) return;
  pendingRace = race;
  const stake = stakeFor(currentFunds(), state.rate);
  $('hit-summary').textContent = `${formatDate(race.date)} ${race.venue} ${race.race}R / 賭け金 ${yen(stake)}円`;
  $('payout').value = '';
  $('hit-error').textContent = '';
  $('hit-dialog').showModal();
  $('payout').focus();
}

function confirmAction(title, text, yesLabel, onYes) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yesLabel;
  $('confirm-yes').onclick = () => {
    $('confirm-dialog').close();
    onYes();
  };
  $('confirm-dialog').showModal();
}

/* ---------- イベント ---------- */

function init() {
  const venue = $('venue');
  venue.append(new Option('選択してください', ''));
  VENUES.forEach((v) => venue.append(new Option(v, v)));
  venue.value = state.venue;

  const race = $('race');
  race.append(new Option('選択してください', ''));
  for (let i = 1; i <= 12; i += 1) race.append(new Option(`${i}R`, String(i)));
  race.value = '1';

  $('date').value = todayLocal();

  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const capital = Number($('setup-capital').value);
    const rate = parseRate($('setup-rate').value);
    let error = '';
    if (!Number.isInteger(capital) || capital < UNIT) error = '軍資金は100円以上の整数で入力してください。';
    else if (rate === null) error = '割合は0.1〜100%で入力してください。';
    $('setup-error').textContent = error;
    if (error) return;
    state.capital = capital;
    state.rate = rate;
    save();
    render();
  });

  $('rate').addEventListener('input', () => {
    const rate = parseRate($('rate').value);
    if (rate === null) return;
    state.rate = rate;
    save();
    render();
  });
  $('rate').addEventListener('blur', () => { $('rate').value = state.rate; });

  ['date', 'venue', 'race'].forEach((id) => {
    $(id).addEventListener('change', () => { $('race-error').textContent = ''; });
  });

  $('btn-hit').addEventListener('click', openHitDialog);
  $('btn-miss').addEventListener('click', () => {
    const r = readRace();
    if (r) addRecord(r, false, 0);
  });

  $('btn-csv').addEventListener('click', downloadCsv);

  $('hit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payout = Number($('payout').value);
    if (!Number.isInteger(payout) || payout < 1) {
      $('hit-error').textContent = '払戻金額を1円以上の整数で入力してください。';
      return;
    }
    $('hit-dialog').close();
    addRecord(pendingRace, true, payout);
  });
  $('hit-cancel').addEventListener('click', () => $('hit-dialog').close());
  $('confirm-no').addEventListener('click', () => $('confirm-dialog').close());

  $('btn-undo').addEventListener('click', () => {
    const last = state.records[state.records.length - 1];
    if (!last) return;
    confirmAction(
      '直前の記録を取り消しますか?',
      `${formatDate(last.date)} ${last.venue} ${last.race}R(${last.hit ? '的中' : '不的中'})を取り消し、資金を ${yen(last.before)}円 に戻します。`,
      '取り消す',
      () => {
        state.records.pop();
        save();
        $('date').value = last.date;
        $('venue').value = last.venue;
        $('race').value = String(last.race);
        render();
      },
    );
  });

  $('btn-reset').addEventListener('click', () => {
    confirmAction(
      'すべてリセットしますか?',
      '軍資金の設定と履歴をすべて削除します。元に戻せません。',
      'リセットする',
      () => {
        state = emptyState();
        save();
        $('setup-capital').value = '';
        $('setup-rate').value = '5';
        $('venue').value = '';
        $('race').value = '1';
        $('date').value = todayLocal();
        render();
      },
    );
  });

  render();
}

init();
