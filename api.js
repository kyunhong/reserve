// 예약 화면(app.js)과 관리자 화면(admin.js)이 함께 쓰는 서버 호출.
// config.js 에 API_URL 이 없으면 브라우저 localStorage 에 저장하는 데모 서버를 쓴다.
(() => {
  const CFG = window.APP_CONFIG || {};

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

  // ===================== 데모 서버 =====================
  // apps-script/Code.gs 의 DEFAULT_SETTINGS 와 같게 유지
  const DEFAULT_SETTINGS = {
    title: '매홀고 2-6 박홍균과 상담 예약',
    notice: '비어 있는 시간을 눌러 예약하세요. 예약할 때 정한 비밀번호로 취소·변경할 수 있어요.',
    daysAhead: 28,
    lastDate: '2026-11-06',
    slots: [
      { key: 'MORNING', label: '아침', start: '08:20', days: [1, 2, 3, 4, 5] },
      { key: 'LUNCH', label: '점심시간', start: '13:30', days: [1, 2, 3, 4, 5] },
      { key: 'AFTER_EARLY', label: '방과후', start: '16:10', days: [1, 5] },
      { key: 'AFTER', label: '방과후', start: '17:10', days: [2, 3, 4] },
    ],
    closedDates: [{ date: '2026-10-20', reason: '모의고사' }],
  };
  const BOOKINGS_KEY = 'counsel-demo-bookings';
  const SETTINGS_KEY = 'counsel-demo-settings';
  const ACTIVE = '예약';

  const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const weekdayOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
  const fail = (m) => { throw new Error(m); };

  function demoServer() {
    const settings = () => read(SETTINGS_KEY, DEFAULT_SETTINGS);
    const slotMap = (st) => Object.fromEntries(st.slots.map((s) => [s.key, { label: s.label, start: s.start }]));
    const daySlots = (st, wd) => st.slots.filter((s) => s.days.includes(wd)).map((s) => s.key);
    const holidays = (st) => Object.fromEntries(st.closedDates.map((c) => [c.date, c.reason]));
    const now = () => { const d = new Date(); return { today: fmt(d), nowHm: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
    const dates = (st) => {
      const out = [];
      for (let i = 0; i <= st.daysAhead; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        const date = fmt(d);
        if (st.lastDate && date > st.lastDate) break;
        out.push({ date, weekday: d.getDay() });
      }
      return out;
    };
    const check = (date, slot, rows, exceptId) => {
      const st = settings(); const map = slotMap(st);
      if (!map[slot]) fail('시간대를 다시 선택해 주세요.');
      const day = dates(st).find((d) => d.date === date) || fail('예약할 수 없는 날짜입니다.');
      if (!daySlots(st, day.weekday).includes(slot)) fail('해당 요일에는 그 시간대 상담이 없습니다.');
      if (holidays(st)[date]) fail('휴무일에는 예약할 수 없습니다.');
      const { today, nowHm } = now();
      if (date === today && nowHm >= map[slot].start) fail('이미 지난 시간대입니다.');
      if (rows.some((r) => r.status === ACTIVE && r.date === date && r.slot === slot && r.id !== exceptId)) {
        fail('이미 예약된 시간입니다. 다른 시간을 선택해 주세요.');
      }
    };
    const sortRows = (rows) => {
      const map = slotMap(settings());
      const key = (r) => r.date + (map[r.slot] ? map[r.slot].start : r.slot);
      return rows.sort((a, b) => key(a).localeCompare(key(b)));
    };
    const mine = (p, rows) => {
      const list = rows.filter((r) => r.studentId === String(p.studentId).trim() && r.password === p.password
        && r.status === ACTIVE && r.date >= now().today);
      if (!list.length) fail('학번과 비밀번호가 일치하는 예약이 없습니다.');
      return sortRows(list);
    };
    const strip = ({ password, ...r }) => ({ createdAt: '', updatedAt: '', ...r });

    return {
      availability() {
        const st = settings(); const map = slotMap(st); const hol = holidays(st);
        const rows = read(BOOKINGS_KEY, []); const { today, nowHm } = now();
        const days = dates(st).map((d) => ({
          date: d.date, weekday: d.weekday, holiday: hol[d.date] || null,
          slots: daySlots(st, d.weekday).map((key) => ({
            key,
            status: hol[d.date] || (d.date === today && nowHm >= map[key].start) ? 'closed'
              : rows.some((r) => r.status === ACTIVE && r.date === d.date && r.slot === key) ? 'booked' : 'open',
          })),
        })).filter((d) => d.slots.length);
        return { today, title: st.title, notice: st.notice, slots: map, days };
      },
      book(p) {
        if (!/^\d{4,6}$/.test(String(p.studentId).trim())) fail('학번은 숫자 4~6자리로 입력해 주세요.');
        if (!/^[가-힣a-zA-Z ]{1,20}$/.test(String(p.name).trim())) fail('이름은 한글/영문 20자 이내로 입력해 주세요.');
        if (String(p.password).length < 4) fail('비밀번호는 4~20자로 입력해 주세요.');
        const rows = read(BOOKINGS_KEY, []); check(p.date, p.slot, rows, null);
        const id = Math.random().toString(36).slice(2, 12);
        rows.push({ id, date: p.date, slot: p.slot, studentId: String(p.studentId).trim(), name: String(p.name).trim(),
          password: p.password, status: ACTIVE });
        write(BOOKINGS_KEY, rows); return { id };
      },
      myBookings(p) { return mine(p, read(BOOKINGS_KEY, [])).map(strip); },
      cancel(p) {
        const rows = read(BOOKINGS_KEY, []);
        const t = mine(p, rows).find((r) => r.id === p.id) || fail('예약을 찾을 수 없습니다.');
        t.status = '취소'; write(BOOKINGS_KEY, rows); return { id: t.id };
      },
      modify(p) {
        const rows = read(BOOKINGS_KEY, []);
        const t = mine(p, rows).find((r) => r.id === p.id) || fail('예약을 찾을 수 없습니다.');
        check(p.date, p.slot, rows, t.id); t.date = p.date; t.slot = p.slot; write(BOOKINGS_KEY, rows); return { id: t.id };
      },
      // 데모에서는 관리자 비밀번호를 검사하지 않는다
      adminList(p) {
        const { today } = now();
        return sortRows(read(BOOKINGS_KEY, []).filter((r) => p.all || (r.status === ACTIVE && r.date >= today))).map(strip);
      },
      adminGetSettings() { return settings(); },
      adminSaveSettings(p) {
        const next = JSON.parse(JSON.stringify(p.settings));
        if (!next.slots.length) fail('상담 시간대를 하나 이상 만들어 주세요.');
        next.slots.forEach((s, i) => {
          if (!s.label) fail(`${i + 1}번째 시간대의 이름을 입력해 주세요.`);
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start)) fail(`${s.label} 시간대의 시작 시각을 다시 확인해 주세요.`);
          if (!s.key) s.key = 'S' + Math.random().toString(16).slice(2, 10);
        });
        next.slots.sort((a, b) => a.start.localeCompare(b.start));
        next.closedDates = next.closedDates.filter((c) => c.date).sort((a, b) => a.date.localeCompare(b.date));
        const { today } = now();
        const closed = new Set(next.closedDates.map((c) => c.date));
        const rows = read(BOOKINGS_KEY, []);
        const conflicts = rows.filter((r) => {
          if (r.status !== ACTIVE || r.date < today) return false;
          const s = next.slots.find((x) => x.key === r.slot);
          return !s || !s.days.includes(weekdayOf(r.date)) || (next.lastDate && r.date > next.lastDate) || closed.has(r.date);
        });
        if (conflicts.length && !p.confirmCancel) {
          const old = slotMap(settings());
          return { saved: false, conflicts: conflicts.map((r) => ({ ...strip(r), slotText: old[r.slot] ? `${old[r.slot].label} ${old[r.slot].start}~` : r.slot })) };
        }
        conflicts.forEach((r) => { r.status = '취소'; });
        write(BOOKINGS_KEY, rows);
        write(SETTINGS_KEY, next);
        return { saved: true, cancelled: conflicts.length, settings: next };
      },
    };
  }

  const demo = demoServer();
  async function demoApi(action, params = {}) {
    await new Promise((r) => setTimeout(r, 150));
    if (!demo[action]) throw new Error('알 수 없는 요청입니다.');
    return demo[action](params);
  }

  window.CounselApi = {
    isDemo: !CFG.API_URL,
    call: CFG.API_URL ? remoteApi : demoApi,
  };
})();
