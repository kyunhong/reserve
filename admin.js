(() => {
  const CFG = window.APP_CONFIG || {};
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const PW_KEY = 'counsel-admin-pw';
  const $ = (id) => document.getElementById(id);
  const state = { password: null, slots: {} };

  async function remoteApi(action, params = {}) {
    const res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify({ action, ...params }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '요청에 실패했습니다.');
    return json.data;
  }

  // 데모 모드: 예약 화면(app.js)이 localStorage 에 저장한 데모 예약을 그대로 보여줌
  async function demoApi(action, params = {}) {
    const SLOTS = {
      MORNING: { label: '아침', start: '08:20' },
      LUNCH: { label: '점심시간', start: '13:30' },
      AFTER_EARLY: { label: '방과후', start: '16:10' },
      AFTER: { label: '방과후', start: '17:10' },
    };
    if (action === 'availability') return { slots: SLOTS };
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem('counsel-demo-bookings')) || []; } catch {}
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return rows
      .filter((r) => params.all || (r.status === '예약' && r.date >= today))
      .map(({ password, ...r }) => ({ createdAt: '', updatedAt: '', ...r }))
      .sort((a, b) => (a.date + SLOTS[a.slot].start).localeCompare(b.date + SLOTS[b.slot].start));
  }

  const api = CFG.API_URL ? remoteApi : demoApi;

  const store = {
    get() { try { return sessionStorage.getItem(PW_KEY); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(PW_KEY, v); } catch {} },
    clear() { try { sessionStorage.removeItem(PW_KEY); } catch {} },
  };

  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dateLabel = (s) => { const d = parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; };
  const slotLabel = (key) => { const s = state.slots[key]; return s ? `${s.label} ${s.start}~` : key; };

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
      state.slots = avail.slots;
      render(rows);
      return true;
    } catch (err) {
      $('listMsg').textContent = err.message;
      return false;
    } finally {
      $('refresh').disabled = false;
    }
  }

  function render(rows) {
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
      store.set(state.password);
    } else {
      showList(false);
      $('loginMsg').textContent = $('listMsg').textContent;
    }
  });

  $('refresh').addEventListener('click', load);
  $('showAll').addEventListener('change', load);
  $('logout').addEventListener('click', () => {
    store.clear();
    state.password = null;
    $('adminPw').value = '';
    $('loginMsg').textContent = '';
    showList(false);
  });

  $('demoNote').hidden = !!CFG.API_URL;
  const saved = store.get();
  if (saved) {
    state.password = saved;
    showList(true);
    load().then((ok) => { if (!ok) { store.clear(); showList(false); } });
  }
})();
