(() => {
  const CFG = window.APP_CONFIG || {};
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const $ = (id) => document.getElementById(id);

  const state = {
    data: null,        // availability 응답
    picked: null,      // { date, slot }
    creds: null,       // 내 예약 조회에 쓴 { studentId, password }
    modifying: null,   // 변경 중인 예약
  };

  // ===================== API =====================
  async function remoteApi(action, params = {}) {
    // Content-Type 을 지정하지 않아 text/plain 으로 전송 → CORS preflight 없이 Apps Script 호출 가능
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...params }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '요청에 실패했습니다.');
    return json.data;
  }

  // config.js 에 API_URL 이 없을 때 쓰는 데모용 가짜 서버 (localStorage)
  const mockApi = (() => {
    // apps-script/Code.gs 의 CONFIG 와 같게 유지
    const SLOTS = {
      MORNING: { label: '아침', start: '08:20' },
      LUNCH: { label: '점심시간', start: '13:30' },
      AFTER_EARLY: { label: '방과후', start: '16:10' },
      AFTER: { label: '방과후', start: '17:10' },
    };
    const DAY_SLOTS = {
      1: ['MORNING', 'LUNCH', 'AFTER_EARLY'],
      2: ['MORNING', 'AFTER'],
      3: ['MORNING', 'LUNCH', 'AFTER'],
      4: ['MORNING', 'LUNCH', 'AFTER'],
      5: ['MORNING', 'LUNCH', 'AFTER_EARLY'],
    };
    const KEY = 'counsel-demo-bookings';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
    const save = (rows) => { try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch {} };
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const dates = () => Array.from({ length: 29 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i);
      return { date: fmt(d), weekday: d.getDay() };
    });
    const fail = (m) => { throw new Error(m); };
    const check = (date, slot, rows, exceptId) => {
      const day = dates().find((d) => d.date === date) || fail('예약할 수 없는 날짜입니다.');
      if (!(DAY_SLOTS[day.weekday] || []).includes(slot)) fail('해당 요일에는 그 시간대 상담이 없습니다.');
      if (date === fmt(new Date()) && nowHm() >= SLOTS[slot].start) fail('이미 지난 시간대입니다.');
      if (rows.some((r) => r.status === '예약' && r.date === date && r.slot === slot && r.id !== exceptId)) {
        fail('이미 예약된 시간입니다. 다른 시간을 선택해 주세요.');
      }
    };
    const mine = (p, rows) => {
      const list = rows.filter((r) => r.studentId === String(p.studentId).trim() && r.password === p.password
        && r.status === '예약' && r.date >= fmt(new Date()));
      if (!list.length) fail('학번과 비밀번호가 일치하는 예약이 없습니다.');
      return list.sort((a, b) => (a.date + SLOTS[a.slot].start).localeCompare(b.date + SLOTS[b.slot].start));
    };
    const handlers = {
      availability() {
        const rows = load(); const today = fmt(new Date());
        const days = dates().map((d) => ({
          date: d.date, weekday: d.weekday, holiday: null,
          slots: (DAY_SLOTS[d.weekday] || []).map((key) => ({
            key,
            status: d.date === today && nowHm() >= SLOTS[key].start ? 'closed'
              : rows.some((r) => r.status === '예약' && r.date === d.date && r.slot === key) ? 'booked' : 'open',
          })),
        })).filter((d) => d.slots.length);
        return { today, slots: SLOTS, days };
      },
      book(p) {
        if (!/^\d{4,6}$/.test(String(p.studentId).trim())) fail('학번은 숫자 4~6자리로 입력해 주세요.');
        if (!/^[가-힣a-zA-Z ]{1,20}$/.test(String(p.name).trim())) fail('이름은 한글/영문 20자 이내로 입력해 주세요.');
        if (String(p.password).length < 4) fail('비밀번호는 4~20자로 입력해 주세요.');
        const rows = load(); check(p.date, p.slot, rows, null);
        const id = Math.random().toString(36).slice(2, 12);
        rows.push({ id, date: p.date, slot: p.slot, studentId: String(p.studentId).trim(), name: String(p.name).trim(),
          password: p.password, status: '예약' });
        save(rows); return { id };
      },
      myBookings(p) { return mine(p, load()); },
      cancel(p) {
        const rows = load(); const t = mine(p, rows).find((r) => r.id === p.id) || fail('예약을 찾을 수 없습니다.');
        t.status = '취소'; save(rows); return { id: t.id };
      },
      modify(p) {
        const rows = load(); const t = mine(p, rows).find((r) => r.id === p.id) || fail('예약을 찾을 수 없습니다.');
        check(p.date, p.slot, rows, t.id); t.date = p.date; t.slot = p.slot; save(rows); return { id: t.id };
      },
    };
    return async (action, params = {}) => {
      await new Promise((r) => setTimeout(r, 200));
      return handlers[action](params);
    };
  })();

  const api = CFG.API_URL ? remoteApi : mockApi;

  // ===================== 표시 도우미 =====================
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateLabel = (s) => { const d = parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; };
  const slotLabel = (key) => {
    const s = state.data && state.data.slots[key];
    return s ? `${s.label} ${s.start}~` : key;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function openDialog(d) { d.querySelectorAll('.msg').forEach((m) => { m.textContent = ''; }); d.showModal(); }
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  async function busy(button, fn) {
    button.disabled = true;
    try { return await fn(); } finally { button.disabled = false; }
  }

  // ===================== 탭 =====================
  function showTab(which) {
    const book = which === 'book';
    $('tabBook').setAttribute('aria-selected', book);
    $('tabMine').setAttribute('aria-selected', !book);
    $('panelBook').hidden = !book;
    $('panelMine').hidden = book;
  }
  $('tabBook').addEventListener('click', () => showTab('book'));
  $('tabMine').addEventListener('click', () => showTab('mine'));

  // ===================== 달력 =====================
  async function loadCalendar() {
    try {
      const data = await api('availability');
      // config.js 의 LAST_DATE 이후와 EXCLUDE_DATES 날짜는 달력에서 뺀다
      const last = CFG.LAST_DATE || '';
      const excluded = CFG.EXCLUDE_DATES || [];
      data.days = data.days.filter((d) => (!last || d.date <= last) && !excluded.includes(d.date));
      state.data = data;
      renderCalendar();
    } catch (err) {
      $('calendar').innerHTML = `<div class="loading">${esc(err.message)}<br><button class="btn small" id="retry">다시 시도</button></div>`;
      $('retry').addEventListener('click', loadCalendar);
    }
  }

  function renderCalendar() {
    const { days, today, slots } = state.data;
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    const root = $('calendar');
    root.innerHTML = '';
    if (!days.length) { root.innerHTML = '<div class="loading">예약 가능한 날짜가 없습니다.</div>'; return; }

    root.append(el('div', { class: 'grid' }, ...['월', '화', '수', '목', '금'].map((d) => el('div', { class: 'dow' }, d))));

    const start = parse(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // 이번 주 월요일
    const last = parse(days[days.length - 1].date);

    for (const monday = start; monday <= last; monday.setDate(monday.getDate() + 7)) {
      const week = el('div', { class: 'grid week' });
      for (let i = 0; i < 5; i++) {
        const d = new Date(monday); d.setDate(d.getDate() + i);
        const key = fmt(d);
        const info = byDate[key];
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        // '휴무일' 탭에 적힌 날은 선택할 시간대 없이 빈칸으로 둔다
        if (!info || info.holiday) { week.append(el('div', { class: 'day blank' }, el('span', { class: 'date' }, label))); continue; }
        const cell = el('div', { class: 'day' + (key === today ? ' today' : '') }, el('span', { class: 'date' }, label));
        for (const s of info.slots) {
          const meta = slots[s.key];
          const text = s.status === 'open' ? meta.label : s.status === 'booked' ? '예약됨' : '마감';
          cell.append(el('button', {
            class: `slot ${s.status}`,
            type: 'button',
            disabled: s.status !== 'open',
            title: `${dateLabel(key)} ${slotLabel(s.key)}`,
            onclick: () => pickSlot(key, s.key),
          }, text, el('small', {}, `${meta.start}~`)));
        }
        week.append(cell);
      }
      root.append(week);
    }
  }

  function pickSlot(date, slot) {
    state.picked = { date, slot };
    const when = `${dateLabel(date)} ${slotLabel(slot)}`;
    if (state.modifying) {
      confirmAction('예약 변경', `${dateLabel(state.modifying.date)} ${slotLabel(state.modifying.slot)}\n→ ${when} 으로 바꿀까요?`, async () => {
        await api('modify', { ...state.creds, id: state.modifying.id, date, slot });
        stopModify();
        await Promise.all([loadCalendar(), refreshMine()]);
        showTab('mine');
        setLookupMsg('예약을 변경했습니다.', 'ok');
      });
      return;
    }
    $('bookPicked').textContent = when;
    openDialog($('bookDialog'));
    $('bkId').focus();
  }

  $('bookForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('bookForm').querySelector('[type=submit]');
    await busy(btn, async () => {
      try {
        await api('book', {
          ...state.picked,
          studentId: $('bkId').value.trim(),
          name: $('bkName').value.trim(),
          password: $('bkPw').value,
        });
        $('bookDialog').close();
        $('bkPw').value = '';
        await loadCalendar();
        alert(`예약되었습니다!\n${dateLabel(state.picked.date)} ${slotLabel(state.picked.slot)}`);
      } catch (err) {
        $('bookMsg').textContent = err.message;
        loadCalendar(); // 그 사이 다른 사람이 예약했을 수 있으니 갱신
      }
    });
  });

  // ===================== 확인 창 =====================
  let confirmFn = null;
  function confirmAction(title, text, fn) {
    $('confirmTitle').textContent = title;
    $('confirmText').innerText = text;
    confirmFn = fn;
    openDialog($('confirmDialog'));
  }
  $('confirmOk').addEventListener('click', async (e) => {
    await busy(e.currentTarget, async () => {
      try {
        await confirmFn();
        $('confirmDialog').close();
      } catch (err) {
        $('confirmMsg').textContent = err.message;
      }
    });
  });

  // ===================== 내 예약 =====================
  function setLookupMsg(text, kind = 'err') {
    $('lookupMsg').className = `msg ${kind}`;
    $('lookupMsg').textContent = text;
  }

  $('lookupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    state.creds = { studentId: $('lkId').value.trim(), password: $('lkPw').value };
    await busy(e.submitter || $('lookupForm').querySelector('[type=submit]'), refreshMine);
  });

  async function refreshMine() {
    const list = $('myList');
    list.innerHTML = '';
    setLookupMsg('');
    if (!state.creds) return;
    let items;
    try {
      items = await api('myBookings', state.creds);
    } catch (err) {
      setLookupMsg(err.message);
      return;
    }
    if (!state.data) await loadCalendar();
    for (const b of items) {
      list.append(el('li', {},
        el('div', {},
          el('div', { class: 'when' }, `${dateLabel(b.date)} ${slotLabel(b.slot)}`),
          el('div', { class: 'who' }, `${b.studentId} ${b.name}`)),
        el('div', { class: 'actions' },
          el('button', { class: 'btn small', type: 'button', onclick: () => startModify(b) }, '변경'),
          el('button', {
            class: 'btn small danger', type: 'button',
            onclick: () => confirmAction('예약 취소', `${dateLabel(b.date)} ${slotLabel(b.slot)} 예약을 취소할까요?`, async () => {
              await api('cancel', { ...state.creds, id: b.id });
              await Promise.all([loadCalendar(), refreshMine()]);
              setLookupMsg('예약을 취소했습니다.', 'ok');
            }),
          }, '취소'))));
    }
  }

  function startModify(b) {
    state.modifying = b;
    $('modifyText').textContent = `${dateLabel(b.date)} ${slotLabel(b.slot)} 예약을 바꿀 새 시간을 선택하세요.`;
    $('modifyBanner').hidden = false;
    showTab('book');
  }

  function stopModify() {
    state.modifying = null;
    $('modifyBanner').hidden = true;
  }
  $('modifyStop').addEventListener('click', () => { stopModify(); showTab('mine'); });

  // ===================== 시작 =====================
  if (CFG.TITLE) { $('title').textContent = CFG.TITLE; document.title = CFG.TITLE; }
  $('demoNote').hidden = !!CFG.API_URL;
  loadCalendar();
})();
