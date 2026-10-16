/**
 * 학생 상담 예약 - Apps Script 백엔드
 *
 * 구글 시트에 연결된(컨테이너 바인딩) 스크립트로 사용합니다.
 * 시트 > 확장 프로그램 > Apps Script 에 이 파일을 붙여넣고 웹 앱으로 배포하세요.
 * 자세한 방법은 README.md 참고.
 */

// ===================== 설정 =====================
const CONFIG = {
  SHEET_NAME: '예약',
  HOLIDAY_SHEET_NAME: '휴무일',
  DAYS_AHEAD: 28, // 오늘부터 며칠 뒤까지 예약을 받을지

  // 시간대 정의 (start/end 는 HH:mm). 같은 날 시작 시각이 지나면 예약 마감.
  SLOTS: {
    LUNCH: { label: '점심시간', start: '12:40', end: '13:30' },
    AFTER: { label: '방과후', start: '16:30', end: '17:30' },
  },

  // 요일별 가능한 시간대 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토)
  // 예) 방과후를 모든 요일에 열려면 1: ['LUNCH', 'AFTER'] 처럼 추가
  DAY_SLOTS: {
    1: ['LUNCH'],
    2: ['AFTER'],
    3: ['LUNCH'],
    4: ['LUNCH'],
    5: ['LUNCH'],
  },

  // 비밀번호를 연속으로 틀리면 잠시 조회를 막음
  MAX_FAILS: 5,
  LOCK_MINUTES: 10,
};

const HEADERS = ['예약ID', '날짜', '요일', '시간대', '학번', '이름', '상태',
  '시간대코드', '비번해시', '솔트', '신청일시', '수정일시'];
const COL = {}; HEADERS.forEach((h, i) => { COL[h] = i + 1; });
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const ACTIVE = '예약';
const CANCELLED = '취소';

class UserError extends Error {}

// ===================== 진입점 =====================
function doGet(e) {
  const p = (e && e.parameter) || {};
  // GET 은 빈자리 조회만 허용 (비밀번호가 URL 에 남지 않도록)
  if (p.action !== 'availability') {
    return ContentService.createTextOutput('상담 예약 API 가 동작 중입니다.');
  }
  return handle_(p);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '잘못된 요청입니다.' });
  }
  return handle_(body);
}

const ACTIONS = {
  availability: apiAvailability_,
  book: apiBook_,
  myBookings: apiMyBookings_,
  cancel: apiCancel_,
  modify: apiModify_,
};

function handle_(p) {
  try {
    const fn = ACTIONS[p.action];
    if (!fn) throw new UserError('알 수 없는 요청입니다.');
    return json_({ ok: true, data: fn(p) });
  } catch (err) {
    if (err instanceof UserError) return json_({ ok: false, error: err.message });
    console.error(err);
    return json_({ ok: false, error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 처음 한 번 편집기에서 실행: 권한 승인 + 시트 생성 */
function setup() {
  sheet_();
  holidaySheet_();
}

// ===================== API =====================
function apiAvailability_() {
  const booked = new Set(rows_().filter(r => r.status === ACTIVE).map(r => r.date + '|' + r.slot));
  const holidays = holidays_();
  const { today, nowHm } = now_();

  const days = calendarDates_().map(d => {
    const keys = CONFIG.DAY_SLOTS[d.weekday] || [];
    const holiday = holidays[d.date] || null;
    return {
      date: d.date,
      weekday: d.weekday,
      holiday,
      slots: keys.map(key => {
        let status = 'open';
        if (holiday) status = 'closed';
        else if (d.date === today && nowHm >= CONFIG.SLOTS[key].start) status = 'closed';
        else if (booked.has(d.date + '|' + key)) status = 'booked';
        return { key, status };
      }),
    };
  }).filter(d => d.slots.length > 0);

  return { today, slots: CONFIG.SLOTS, days };
}

function apiBook_(p) {
  const studentId = cleanStudentId_(p.studentId);
  const name = cleanName_(p.name);
  const password = cleanPassword_(p.password);
  const date = String(p.date || '');
  const slot = String(p.slot || '');

  return withLock_(() => {
    const rows = rows_();
    assertSlotAvailable_(date, slot, rows, null);

    const salt = Utilities.getUuid();
    const id = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const stamp = stamp_();
    const record = {};
    record['예약ID'] = id;
    record['날짜'] = date;
    record['요일'] = WEEKDAYS[weekdayOf_(date)];
    record['시간대'] = slotText_(slot);
    record['학번'] = studentId;
    record['이름'] = name;
    record['상태'] = ACTIVE;
    record['시간대코드'] = slot;
    record['비번해시'] = hash_(password, salt);
    record['솔트'] = salt;
    record['신청일시'] = stamp;
    record['수정일시'] = '';
    const sh = sheet_();
    sh.getRange(sh.getLastRow() + 1, 1, 1, HEADERS.length)
      .setValues([HEADERS.map(h => record[h])]);
    return { id, date, slot };
  });
}

function apiMyBookings_(p) {
  const mine = verify_(p.studentId, p.password, rows_());
  return mine.map(publicView_);
}

function apiCancel_(p) {
  return withLock_(() => {
    const target = findMine_(p);
    const sh = sheet_();
    sh.getRange(target.row, COL['상태']).setValue(CANCELLED);
    sh.getRange(target.row, COL['수정일시']).setValue(stamp_());
    return { id: target.id };
  });
}

function apiModify_(p) {
  const date = String(p.date || '');
  const slot = String(p.slot || '');
  return withLock_(() => {
    const target = findMine_(p);
    assertSlotAvailable_(date, slot, rows_(), target.id);
    const sh = sheet_();
    sh.getRange(target.row, COL['날짜'], 1, 2).setValues([[date, WEEKDAYS[weekdayOf_(date)]]]);
    sh.getRange(target.row, COL['시간대']).setValue(slotText_(slot));
    sh.getRange(target.row, COL['시간대코드']).setValue(slot);
    sh.getRange(target.row, COL['수정일시']).setValue(stamp_());
    return { id: target.id, date, slot };
  });
}

// ===================== 검증 =====================
function cleanStudentId_(v) {
  const s = String(v || '').trim();
  if (!/^\d{4,6}$/.test(s)) throw new UserError('학번은 숫자 4~6자리로 입력해 주세요.');
  return s;
}

function cleanName_(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  if (!/^[가-힣a-zA-Z ]{1,20}$/.test(s)) throw new UserError('이름은 한글/영문 20자 이내로 입력해 주세요.');
  return s;
}

function cleanPassword_(v) {
  const s = String(v || '');
  if (s.length < 4 || s.length > 20) throw new UserError('비밀번호는 4~20자로 입력해 주세요.');
  return s;
}

/** 예약 가능한 날짜·시간대인지, 이미 찬 자리인지 확인 (exceptId: 수정 중인 본인 예약) */
function assertSlotAvailable_(date, slot, rows, exceptId) {
  if (!CONFIG.SLOTS[slot]) throw new UserError('시간대를 다시 선택해 주세요.');
  const day = calendarDates_().find(d => d.date === date);
  if (!day) throw new UserError('예약할 수 없는 날짜입니다.');
  if (!(CONFIG.DAY_SLOTS[day.weekday] || []).includes(slot)) {
    throw new UserError(WEEKDAYS[day.weekday] + '요일에는 해당 시간대 상담이 없습니다.');
  }
  if (holidays_()[date]) throw new UserError('휴무일에는 예약할 수 없습니다.');
  const { today, nowHm } = now_();
  if (date === today && nowHm >= CONFIG.SLOTS[slot].start) {
    throw new UserError('이미 지난 시간대입니다.');
  }
  const taken = rows.some(r => r.status === ACTIVE && r.date === date && r.slot === slot && r.id !== exceptId);
  if (taken) throw new UserError('이미 예약된 시간입니다. 다른 시간을 선택해 주세요.');
}

/** 학번+비밀번호가 맞는 다가오는 예약 목록. 연속으로 틀리면 잠시 잠금. */
function verify_(studentIdRaw, password, rows) {
  const studentId = cleanStudentId_(studentIdRaw);
  const cache = CacheService.getScriptCache();
  const key = 'fail_' + studentId;
  const fails = Number(cache.get(key) || 0);
  if (fails >= CONFIG.MAX_FAILS) {
    throw new UserError('비밀번호를 여러 번 틀려 ' + CONFIG.LOCK_MINUTES + '분 동안 조회할 수 없습니다.');
  }
  const { today } = now_();
  const pw = String(password || '');
  const mine = rows.filter(r =>
    r.studentId === studentId && r.status === ACTIVE && r.date >= today &&
    hash_(pw, r.salt) === r.hash);
  if (!mine.length) {
    cache.put(key, String(fails + 1), CONFIG.LOCK_MINUTES * 60);
    throw new UserError('학번과 비밀번호가 일치하는 예약이 없습니다.');
  }
  cache.remove(key);
  return mine.sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
}

function findMine_(p) {
  const mine = verify_(p.studentId, p.password, rows_());
  const target = mine.find(r => r.id === String(p.id || ''));
  if (!target) throw new UserError('예약을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.');
  return target;
}

// ===================== 시트 =====================
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_NAME);
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@'); // 날짜·학번이 자동 변환되지 않도록 텍스트로
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(COL['시간대코드'], 3); // 시간대코드, 비번해시, 솔트
  }
  return sh;
}

function holidaySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HOLIDAY_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.HOLIDAY_SHEET_NAME);
    sh.getRange(1, 1, 1, 2).setValues([['날짜 (예: 2026-10-20)', '사유']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, HEADERS.length).getValues().map((r, i) => ({
    row: i + 2,
    id: String(r[COL['예약ID'] - 1]),
    date: toDateStr_(r[COL['날짜'] - 1]),
    slot: String(r[COL['시간대코드'] - 1]),
    studentId: String(r[COL['학번'] - 1]),
    name: String(r[COL['이름'] - 1]),
    status: String(r[COL['상태'] - 1]),
    hash: String(r[COL['비번해시'] - 1]),
    salt: String(r[COL['솔트'] - 1]),
  }));
}

/** { 'yyyy-MM-dd': '사유' } */
function holidays_() {
  const sh = holidaySheet_();
  const n = sh.getLastRow() - 1;
  const map = {};
  if (n <= 0) return map;
  sh.getRange(2, 1, n, 2).getValues().forEach(([d, reason]) => {
    const date = toDateStr_(d);
    if (date) map[date] = String(reason || '휴무');
  });
  return map;
}

function publicView_(r) {
  return { id: r.id, date: r.date, slot: r.slot, name: r.name, studentId: r.studentId };
}

// ===================== 유틸 =====================
function tz_() { return Session.getScriptTimeZone() || 'Asia/Seoul'; }

function now_() {
  const d = new Date();
  return {
    today: Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'),
    nowHm: Utilities.formatDate(d, tz_(), 'HH:mm'),
  };
}

function stamp_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }

/** 오늘부터 DAYS_AHEAD 일까지 [{date, weekday}] */
function calendarDates_() {
  const out = [];
  const base = new Date();
  for (let i = 0; i <= CONFIG.DAYS_AHEAD; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    out.push({
      date: Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'),
      weekday: Number(Utilities.formatDate(d, tz_(), 'u')) % 7, // u: 1=월 … 7=일
    });
  }
  return out;
}

function weekdayOf_(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function toDateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return String(v || '').trim();
}

function slotText_(key) {
  const s = CONFIG.SLOTS[key];
  return s.label + ' (' + s.start + '~' + s.end + ')';
}

function hash_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new UserError('접속자가 많습니다. 잠시 후 다시 시도해 주세요.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
