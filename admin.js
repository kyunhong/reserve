(() => {
  const CFG = window.APP_CONFIG || {};
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const PW_KEY = 'counsel-admin-pw';
  const VIEW_KEY = 'counsel-admin-view';
  const $ = (id) => document.getElementById(id);
  const state = { password: null, avail: null, rows: [], view: 'calendar' };

  async function remoteApi(action, params = {}) {
    const res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify({ action, ...params }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '요청에 실패했습니다.');
    return json.data;
  }

  // 데모 모드: 예약 화면(app.js)이 localStorage 에 저장한 데모 예약을 그대로 보여줌
  async function demoApi(action, params = {}) {
    // apps-script/Code.gs 의 CONFIG 와 같게 유지
    const SLOTS = {
      MORNING: { label: '아침', start: '08:20' },
      LUNCH: { label: '점심시간', start: '13:30' },
      AFTER_EARLY: { label: '방과후', start: '16:10' },
      AFTER: { label: '방과후', start: '17:10' },
    };
    const DAY_SLOTS = {
      1: ['MORNING', 'LUNCH', 'AFTER_EARLY'],
      2: ['MORNING', 'LUNCH', 'AFTER'],
      3: ['MORNING', 'LUNCH', 'AFTER'],
      4: ['MORNING', 'LUNCH', 'AFTER'],
      5: ['MORNING', 'LUNCH', 'AFTER_EARLY'],
    };
    const now = new Date();
    const today = fmt(now);
    const nowHm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (action === 'availability') {
      const days = Array.from({ length: 29 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() + i);
        const date = fmt(d);
        return {
          date, weekday: d.getDay(), holiday: null,
          slots: (DAY_SLOTS[d.getDay()] || []).map((key) => ({
            key, status: date === today && nowHm >= SLOTS[key].start ? 'closed' : 'open',
          })),
        };
      }).filter((d) => d.slots.length);
      return { today, slots: SLOTS, days };
    }
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem('counsel-demo-bookings')) || []; } catch {}
    return rows
      .filter((r) => params.all || (r.status === '예약' && r.date >= today))
      .map(({ password, ...r }) => ({ createdAt: '', updatedAt: '', ...r }))
      .sort((a, b) => (a.date + SLOTS[a.slot].start).localeCompare(b.date + SLOTS[b.slot].start));
  }

  const api = CFG.API_URL ? remoteApi : demoApi;

  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    clear(k) { try { sessionStorage.removeItem(k); } catch {} },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dateLabel = (s) => { const d = parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; };
  const slotLabel = (key) => { const s = state.avail && state.avail.slots[key]; return s ? `${s.label} ${s.start}~` : key; };

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  async function load() {
    $('listMsg').textContent = '';
    $('refresh').disabled = true;
    try {
      const [avail, rows] = await Promise.all([
        api('availability'),
        api('adminList', { adminPassword: state.password, all: $('showAll').checked }),
      ]);
      // config.js 의 LAST_DATE 이후와 EXCLUDE_DATES 날짜는 학생 화면과 똑같이 달력에서 뺀다
      const last = CFG.LAST_DATE || '';
      const excluded = CFG.EXCLUDE_DATES || [];
      if (avail.days) avail.days = avail.days.filter((d) => (!last || d.date <= last) && !excluded.includes(d.date));
      state.avail = avail;
      state.rows = rows;
      render();
      return true;
    } catch (err) {
      $('listMsg').textContent = err.message;
      return false;
    } finally {
      $('refresh').disabled = false;
    }
  }

  function render() {
    const calendar = state.view === 'calendar';
    $('viewCalendar').setAttribute('aria-pressed', calendar);
    $('viewList').setAttribute('aria-pressed', !calendar);
    $('showAllWrap').hidden = calendar;
    if (calendar) renderCalendar(); else renderList();
  }

  // ===================== 달력 보기 =====================
  function renderCalendar() {
    const { days, today } = state.avail;
    const active = state.rows.filter((r) => r.status === '예약' && r.date >= today);
    const byKey = new Map(active.map((r) => [`${r.date}|${r.slot}`, r]));
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    const total = days.reduce((n, d) => n + d.slots.length, 0);
    $('summary').textContent = `예약 기간 · 예약 ${active.length}건 / 전체 ${total}칸`;

    const list = $('list');
    list.innerHTML = '';
    if (!days.length) { list.append(el('div', { class: 'loading' }, '예약 가능한 날짜가 없습니다.')); return; }

    const cal = el('div', { class: 'admin-cal' });
    cal.append(el('div', { class: 'grid head' }, ...['월', '화', '수', '목', '금'].map((d) => el('div', { class: 'dow' }, d))));

    const monday = parse(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const last = parse(days[days.length - 1].date);

    for (; monday <= last; monday.setDate(monday.getDate() + 7)) {
      const week = el('div', { class: 'grid week' });
      for (let i = 0; i < 5; i++) {
        const d = new Date(monday); d.setDate(d.getDate() + i);
        const date = fmt(d);
        const info = byDate[date];
        const label = `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
        if (!info) { week.append(el('div', { class: 'day blank' }, el('span', { class: 'date' }, label))); continue; }

        const taken = info.slots.filter((s) => byKey.has(`${date}|${s.key}`)).length;
        const cell = el('div', { class: 'day' + (date === today ? ' today' : '') },
          el('div', { class: 'day-head' },
            el('span', { class: 'date' }, label),
            taken ? el('span', { class: 'count' }, `${taken}건`) : null));
        if (info.holiday) cell.append(el('span', { class: 'note' }, info.holiday));

        for (const s of info.slots) {
          const meta = state.avail.slots[s.key];
          const r = byKey.get(`${date}|${s.key}`);
          const cls = r ? 'taken' : s.status === 'closed' ? 'closed' : 'free';
          cell.append(el('div', { class: `aslot ${cls}`, title: `${dateLabel(date)} ${slotLabel(s.key)}` },
            el('span', { class: 't' }, `${meta.start} ${meta.label}`),
            el('span', { class: 'who' }, r ? `${r.studentId} ${r.name}` : cls === 'closed' ? '마감' : '비어 있음')));
        }
        week.append(cell);
      }
      cal.append(week);
    }
    list.append(cal);
  }

  // ===================== 목록 보기 =====================
  function renderList() {
    const rows = state.rows;
    const list = $('list');
    list.innerHTML = '';
    const active = rows.filter((r) => r.status === '예약').length;
    $('summary').textContent = $('showAll').checked
      ? `전체 ${rows.length}건 (유효 ${active}건)`
      : `다가오는 예약 ${rows.length}건`;
    if (!rows.length) {
      list.append(el('div', { class: 'loading' }, '예약이 없습니다.'));
      return;
    }
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    for (const [date, items] of groups) {
      const tbody = el('tbody');
      for (const r of items) {
        tbody.append(el('tr', { class: r.status === '예약' ? '' : 'cancelled' },
          el('td', {}, slotLabel(r.slot)),
          el('td', {}, r.studentId),
          el('td', {}, r.name),
          el('td', {}, r.status === '예약' ? el('span', { class: 'tag' }, '예약') : r.status),
          el('td', {}, r.createdAt || ''),
          el('td', {}, r.updatedAt || '')));
      }
      list.append(el('div', { class: 'day-group' },
        el('h3', {}, `${dateLabel(date)} · ${items.length}건`),
        el('div', { class: 'table-wrap' },
          el('table', {},
            el('thead', {}, el('tr', {}, ...['시간', '학번', '이름', '상태', '신청일시', '수정일시'].map((h) => el('th', {}, h)))),
            tbody))));
    }
  }

  // ===================== 이벤트 =====================
  function showList(on) {
    $('loginCard').hidden = on;
    $('listCard').hidden = !on;
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('loginForm').querySelector('[type=submit]');
    btn.disabled = true;
    state.password = $('adminPw').value;
    showList(true);
    const ok = await load();
    btn.disabled = false;
    if (ok) {
      store.set(PW_KEY, state.password);
    } else {
      showList(false);
      $('loginMsg').textContent = $('listMsg').textContent;
    }
  });

  function setView(view) {
    state.view = view;
    store.set(VIEW_KEY, view);
    if (state.avail) render();
  }
  $('viewCalendar').addEventListener('click', () => setView('calendar'));
  $('viewList').addEventListener('click', () => setView('list'));
  $('refresh').addEventListener('click', load);
  $('showAll').addEventListener('change', load);
  $('logout').addEventListener('click', () => {
    store.clear(PW_KEY);
    state.password = null;
    $('adminPw').value = '';
    $('loginMsg').textContent = '';
    showList(false);
  });

  $('demoNote').hidden = !!CFG.API_URL;
  state.view = store.get(VIEW_KEY) === 'list' ? 'list' : 'calendar';
  const saved = store.get(PW_KEY);
  if (saved) {
    state.password = saved;
    showList(true);
    load().then((ok) => { if (!ok) { store.clear(PW_KEY); showList(false); } });
  }
})();
