// Apps Script 웹 앱 배포 URL (…/exec 로 끝나는 주소)을 넣으세요.
// 비워 두면 브라우저에만 저장되는 "데모 모드"로 동작합니다.
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxfPfpSSPqFcse2gIZc_8fax0It2rSbGfUSmv4FGmX0TDcJw7uI0UdJA2syXXXfG8iDbw/exec',
  TITLE: '상담 예약',
  // 이 날짜까지만 달력에 보여 줍니다 (비우면 서버 설정대로 4주). 형식: 'YYYY-MM-DD'
  LAST_DATE: '2026-11-06',
  // 예약을 받지 않는 날 (달력에서 빈칸). 예: 모의고사, 행사
  EXCLUDE_DATES: ['2026-10-20'],
};
