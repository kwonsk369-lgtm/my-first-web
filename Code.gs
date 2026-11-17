/**
 * 배전공사 단가·사토장·퀴즈 통합 대시보드 (Google Apps Script 웹앱)
 * ------------------------------------------------------------------
 * 파일 구성 : Code.gs (이 파일) + Index.html
 * 처음 1회  : 편집기 상단에서 함수 'setup' 선택 → 실행 → 권한 승인
 * 배포      : 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자)
 */

// ===================== 1. 기본 설정 =====================
var TZ = 'Asia/Seoul';

// 스크립트 속성(프로젝트 설정 → 스크립트 속성)에 같은 이름으로 넣으면 아래 기본값 대신 사용됩니다.
var DEFAULTS = {
  APP_TITLE: '배전공사 단가 · 사토장 · 학습 대시보드',
  KORAS_URL: 'https://www.koras.org/05/sale_3.jsp',          // ?barea=101~116
  ENG_WAGE_URL: 'https://cmpi.or.kr/sub_new/noim.asp?n_type=engi',
  DEFAULT_RADIUS_KM: '20',
  KAKAO_REST_KEY: '',                                         // 선택: 카카오 REST API 키
  NAVER_CLIENT_ID: '',                                        // 선택: 네이버 클라우드 Maps Client ID
  NAVER_CLIENT_SECRET: ''                                     // 선택: 네이버 클라우드 Maps Client Secret
};

function prop_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? DEFAULTS[key] : v;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

// ===================== 2. 웹앱 진입점 =====================
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.appTitle = prop_('APP_TITLE');
  return t.evaluate()
    .setTitle(prop_('APP_TITLE'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 처음 1회 실행: 권한 승인 + 기본 스크립트 속성 등록 + 연결 점검 */
function setup() {
  var sp = PropertiesService.getScriptProperties();
  ['DEFAULT_RADIUS_KM', 'KORAS_URL', 'ENG_WAGE_URL'].forEach(function (k) {
    if (!sp.getProperty(k)) sp.setProperty(k, DEFAULTS[k]);
  });
  var r = UrlFetchApp.fetch('https://www.koras.org/05/sale.jsp', { muteHttpExceptions: true });
  Logger.log('KORAS 연결 상태: ' + r.getResponseCode());
  var g = geocode_('서울특별시 중구 세종대로 110');   // 결과의 by 값으로 카카오/네이버/Google 중 무엇이 쓰였는지 확인
  Logger.log('주소 변환 테스트: ' + JSON.stringify(g));
  Logger.log('설정 완료 ' + now_());
}

// ===================== 3. 정적 데이터 =====================
// (1) 대한건설협회 건설업 임금실태조사(시중노임단가) - 배전공사 관련 직종, 원/일(8시간)
// 출처: 대한건설협회「2026년 하반기 적용 건설업 임금실태조사 보고서」(2026.9.1 공표)
var LABOR = {
  source: '대한건설협회 「2026년 하반기 적용 건설업 임금실태조사 보고서」',
  published: '2026-09-01',
  nextRelease: '2027년 1월 1일(상반기 적용분) 예정',
  periods: ['2026.9.1', '2026.1.1', '2025.9.1', '2025.1.1'],
  periodLabels: ['2026 하반기', '2026 상반기', '2025 하반기', '2025 상반기'],
  rows: [
    { code: '1002', name: '보통인부',        v: [172698, 172068, 171037, 169804] },
    { code: '1075', name: '내선전공',        v: [276108, 273676, 273539, 268915] },
    { code: '1076', name: '특고압케이블전공', v: [444519, 440616, 439248, 436458] },
    { code: '1078', name: '저압케이블전공',   v: [306274, 304156, 303632, 300337] },
    { code: '1081', name: '배전전공',        v: [420978, 414968, 413173, 408559] },
    { code: '1082', name: '배전활선전공',     v: [562067, 562439, 560837, 557881] }
  ]
};

// (4) 엔지니어링업체 임금실태조사 - 전기부문 숙련기술자 기본값(버튼으로 갱신 가능), 원/일
var ENG_DEFAULT = {
  source: '한국엔지니어링협회 엔지니어링업체 임금실태조사 (기본 내장값)',
  fetchedAt: '',
  status: 'default',
  years: [
    { year: '2026', applyDate: '2026-01-01', note: '2025.12.2 공표 · 월평균 근무일수 20.3일',
      grades: { '중급숙련기술자': 246556, '초급숙련기술자': 209640 } },
    { year: '2025', applyDate: '2025-01-01', note: '2024.12 공표 · 월평균 근무일수 20.5일',
      grades: { '중급숙련기술자': 237151, '초급숙련기술자': 197097 } }
  ]
};

// KORAS 지역 코드
var KORAS_AREAS = [
  ['101', '서울'], ['102', '부산'], ['103', '대구'], ['104', '인천'], ['105', '광주'], ['106', '대전'],
  ['107', '울산'], ['108', '경기'], ['109', '강원'], ['110', '충북'], ['111', '충남'], ['112', '전북'],
  ['113', '전남'], ['114', '경북'], ['115', '경남'], ['116', '제주']
];
var KORAS_COLS = ['도로공사용', '콘크리트용 잔골재', '콘크리트용 굵은골재', '아스팔트콘크리트용', '순환토사', '기타'];

// ===================== 4. 화면 초기 데이터 =====================
function getInitialData() {
  return {
    labor: LABOR,
    eng: loadJson_('ENG_WAGE_CACHE') || ENG_DEFAULT,
    koras: loadJson_('KORAS_CACHE'),
    dumps: getDumpList(),
    needPin: !!PropertiesService.getScriptProperties().getProperty('UPLOAD_PIN'),
    radius: Number(prop_('DEFAULT_RADIUS_KM')) || 20
  };
}

// ===================== 5. 한국건설자원협회 순환골재 단가 =====================
function refreshKoras() {
  var base = prop_('KORAS_URL');
  var reqs = KORAS_AREAS.map(function (a) {
    return { url: base + '?barea=' + a[0], muteHttpExceptions: true, followRedirects: true,
             headers: { 'User-Agent': 'Mozilla/5.0' } };
  });
  var resps = UrlFetchApp.fetchAll(reqs);
  var rows = [], errors = [];
  resps.forEach(function (resp, i) {
    var area = KORAS_AREAS[i][1];
    if (resp.getResponseCode() !== 200) { errors.push(area + ' HTTP ' + resp.getResponseCode()); return; }
    try {
      parseKoras_(decode_(resp)).forEach(function (r) { r.sido = area; rows.push(r); });
    } catch (e) { errors.push(area + ' 파싱 오류: ' + e.message); }
  });
  if (!rows.length) {
    throw new Error('순환골재 표를 읽지 못했습니다. ' + errors.join(' / '));
  }
  var data = { fetchedAt: now_(), source: base, cols: KORAS_COLS, rows: rows, errors: errors };
  saveJson_('KORAS_CACHE', data);
  return data;
}

/** "보유량(단가)" 형식 셀 6개로 끝나는 행을 업체 행으로 인식 */
function parseKoras_(html) {
  var out = [];
  var cellRe = /^\s*([\d,]+)\s*(?:\(\s*([\d,]*|-)\s*\))?\s*$/;
  var lastSigungu = '';
  parseTables_(html).forEach(function (tbl) {
    tbl.forEach(function (row) {
      var c = row.cells;
      if (c.length < 7) return;
      var vals = c.slice(c.length - 6);
      if (!vals.every(function (v) { return cellRe.test(v); })) return;
      var company = c[c.length - 7];
      var sigungu = c.length >= 8 ? c[c.length - 8] : lastSigungu;
      lastSigungu = sigungu;
      if (/한국건설자원협회/.test(company)) return; // 협회 시험 입력값 제외
      var items = vals.map(function (v) {
        var m = v.match(cellRe);
        var qty = toNum_(m[1]);
        var price = (m[2] && m[2] !== '-') ? toNum_(m[2]) : null;
        return { qty: qty, price: price };
      });
      out.push({ sigungu: sigungu, company: company, items: items });
    });
  });
  return out;
}

// ===================== 6. 엔지니어링 임금 (전기부문) =====================
function refreshEngWage() {
  var url = prop_('ENG_WAGE_URL');
  var pages = [url, url + '&page=2', url + '&gotopage=2', url + '&pg=2', url + '&nPage=2'];
  var found = {}, year = '', applyDate = '', tried = [];
  for (var i = 0; i < pages.length; i++) {
    var resp = UrlFetchApp.fetch(pages[i], { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0' } });
    tried.push(pages[i] + ' → ' + resp.getResponseCode());
    if (resp.getResponseCode() !== 200) continue;
    var text = htmlToText_(decode_(resp));
    var ym = text.match(/엔지니어링기술자\s*\(\s*(\d{4})\s*년\s*\)/);
    var am = text.match(/적용일자\s*[:：]\s*(\d{4}-\d{2}-\d{2})/);
    if (ym && !year) year = ym[1];
    if (am && !applyDate) applyDate = am[1];
    var re = /(기술사|특급기술자|고급기술자|중급기술자|초급기술자|고급숙련기술자|중급숙련기술자|초급숙련기술자)\s*\(\s*전기[^\d]{0,6}?([\d,]{6,9})\s+([\d,]{6,9})/g, m;
    while ((m = re.exec(text)) !== null) {
      found[m[1]] = { cur: toNum_(m[2]), prev: toNum_(m[3]) };
    }
    if (found['중급숙련기술자'] && found['초급숙련기술자']) break;
  }
  if (!found['중급숙련기술자'] || !found['초급숙련기술자']) {
    var old = loadJson_('ENG_WAGE_CACHE') || ENG_DEFAULT;
    old.lastError = '갱신 실패(' + now_() + '): 사이트 구조가 바뀌었거나 접속이 차단되었습니다. 기존 값을 표시합니다.';
    old.tried = tried;
    return old;
  }
  var y = Number(year) || new Date().getFullYear();
  var data = {
    source: '대한건설협회 거래가격(cmpi.or.kr) 엔지니어링기술자 노임 · 원자료: 한국엔지니어링협회',
    fetchedAt: now_(), status: 'live',
    years: [
      { year: String(y), applyDate: applyDate || (y + '-01-01'), note: '불러온 최신값',
        grades: { '중급숙련기술자': found['중급숙련기술자'].cur, '초급숙련기술자': found['초급숙련기술자'].cur } },
      { year: String(y - 1), applyDate: (y - 1) + '-01-01', note: '사이트의 직전 단가',
        grades: { '중급숙련기술자': found['중급숙련기술자'].prev, '초급숙련기술자': found['초급숙련기술자'].prev } }
    ],
    allGrades: found
  };
  saveJson_('ENG_WAGE_CACHE', data);
  return data;
}

// ===================== 7. 대구·경북 사토장 목록 =====================
/*
 * 구글 서버에서는 토싸이클(tocycle.com)에 접속이 차단됩니다("사용할 수 없는 주소").
 * 그래서 사용자가 토싸이클에서 내려받은 엑셀(반경검색 결과)을 웹앱에 올리면
 * 그 목록을 저장해 두고 대구·경북 사토장 주소를 보여주는 방식으로 바꿨습니다.
 */
function getDumpList() {
  return loadJson_('DUMP_LIST') || { updatedAt: '', rows: [], files: [] };
}

/** rows: [{kind,name,ceo,address,manager,tel,memo}] / replace=true면 기존 목록을 지우고 새로 저장 */
function saveDumpRows(rows, pin, replace, fileName) {
  var need = PropertiesService.getScriptProperties().getProperty('UPLOAD_PIN');
  if (need && String(pin || '') !== need) throw new Error('업로드 비밀번호(UPLOAD_PIN)가 맞지 않습니다.');
  if (!rows || !rows.length) throw new Error('파일에서 업체 목록(구분·업체명·주소)을 찾지 못했습니다.');
  var cur = replace ? { rows: [], files: [] } : getDumpList();
  var seen = {};
  cur.rows.forEach(function (r) { seen[r.name + '|' + r.address] = 1; });
  var added = 0;
  rows.forEach(function (r) {
    var k = (r.name || '') + '|' + (r.address || '');
    if (!r.name || seen[k]) return;
    seen[k] = 1; added++;
    cur.rows.push({ kind: String(r.kind || '').slice(0, 20), name: String(r.name).slice(0, 80),
      ceo: String(r.ceo || '').slice(0, 30), address: String(r.address || '').slice(0, 150),
      manager: String(r.manager || '').slice(0, 30), tel: String(r.tel || '').slice(0, 40), src: '파일' });
  });
  cur.files = (cur.files || []).concat([{ name: fileName || '업로드', at: now_(), rows: rows.length, added: added }]).slice(-20);
  cur.updatedAt = now_();
  saveJson_('DUMP_LIST', cur);
  return cur;
}

/**
 * 기준 주소 → 각 사토장까지 실제 도로 이동거리 (네이버 Directions 5, 자동차·실시간 최적 경로)
 * 반환 dist[key] = { road: km, min: 소요분, line: 직선km, err: 실패사유 }
 */
function calcDumpDistances(address, names) {
  var origin = geocode_(address);
  if (!origin) throw new Error('기준 주소를 좌표로 바꾸지 못했습니다.');
  var nId = prop_('NAVER_CLIENT_ID'), nSecret = prop_('NAVER_CLIENT_SECRET');
  if (!nId || !nSecret) throw new Error('도로거리 계산에는 스크립트 속성 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET이 필요합니다.');
  var list = getDumpList().rows.filter(function (r) { return names.indexOf(r.name + '|' + r.address) >= 0; }).slice(0, 150);
  var need = list.filter(function (r) { return r.lat == null; });
  var g2 = geocodeMany_(need.map(function (r) { return r.address; })), gi = 0;
  var geo = list.map(function (r) { return r.lat != null ? { lat: r.lat, lng: r.lng } : g2[gi++]; });
  var out = {}, cache = CacheService.getScriptCache(), todo = [];
  list.forEach(function (r, i) {
    var k = r.name + '|' + r.address, g = geo[i];
    if (!g) { out[k] = { err: '주소 좌표 변환 실패' }; return; }
    var line = round1_(haversine_(origin.lat, origin.lng, g.lat, g.lng));
    var ck = 'rt_' + [origin.lng, origin.lat, g.lng, g.lat].map(function (v) { return Number(v).toFixed(5); }).join('_');
    var hit = cache.get(ck);
    if (hit) { out[k] = JSON.parse(hit); out[k].line = line; return; }
    out[k] = { line: line };
    todo.push({ k: k, ck: ck, url: 'https://maps.apigw.ntruss.com/map-direction/v1/driving?start=' + origin.lng + ',' + origin.lat
      + '&goal=' + g.lng + ',' + g.lat + '&option=traoptimal' });
  });
  var errMsg = { 1: '출발지와 도착지가 같음', 2: '도로 근처가 아님', 3: '자동차 경로 없음', 4: '경유지 오류', 5: '거리 초과' };
  for (var s = 0; s < todo.length; s += 20) {
    var chunk = todo.slice(s, s + 20);
    var resps = UrlFetchApp.fetchAll(chunk.map(function (t) {
      return { url: t.url, muteHttpExceptions: true, headers: { 'x-ncp-apigw-api-key-id': nId, 'x-ncp-apigw-api-key': nSecret } };
    }));
    resps.forEach(function (resp, i) {
      var t = chunk[i], j = null;
      try { j = JSON.parse(resp.getContentText()); } catch (e) {}
      var sum = j && j.route && j.route.traoptimal && j.route.traoptimal[0] && j.route.traoptimal[0].summary;
      if (sum) {
        out[t.k].road = Math.round(sum.distance / 100) / 10;
        out[t.k].min = Math.round(sum.duration / 60000);
        cache.put(t.ck, JSON.stringify({ road: out[t.k].road, min: out[t.k].min }), 21600);
      } else {
        out[t.k].err = j && j.code ? (errMsg[j.code] || j.message || ('오류 ' + j.code))
          : ('HTTP ' + resp.getResponseCode() + (resp.getResponseCode() === 401 || resp.getResponseCode() === 403 || resp.getResponseCode() === 429
            ? ' (네이버 콘솔에서 Directions 5 체크 필요)' : ''));
      }
    });
  }
  return { origin: origin, dist: out, at: now_(), mode: '도로' };
}

/**
 * 공공데이터포털 '국토교통부_토석정보공유시스템 토석정보공유서비스' (apis.data.go.kr)
 *  - 사토장·토취장·골재업체 정보: addr, comClass, master, memName, orgComName, xpos(위도), ypos(경도)
 *  - 스크립트 속성 DATA_GO_KR_KEY 필수 · 오퍼레이션 /SoilComList · 대구·경북 주소만 저장
 */
var TOCYCLE_API_BASE = 'https://apis.data.go.kr/1613000/Tocycle/';
// 공공데이터포털 활용신청 상세기능: 2. 사토장, 토취장, 골재업체정보 /SoilComList
var TOCYCLE_API_CANDIDATES = ['SoilComList'];

function refreshDumpsFromApi(arg) {
  var key = PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY');
  if (!key) throw new Error('스크립트 속성 DATA_GO_KR_KEY(공공데이터포털 인증키)가 없습니다.');
  var keyQ = /%/.test(key) ? key : encodeURIComponent(key);
  var fixed = PropertiesService.getScriptProperties().getProperty('TOCYCLE_API_OP');
  var ops = fixed ? [fixed] : TOCYCLE_API_CANDIDATES, log = [], hit = null;
  var call = function (op, page) {
    var url = TOCYCLE_API_BASE + op + '?serviceKey=' + keyQ + '&pageNo=' + page + '&numOfRows=1000&_type=json';
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var txt = r.getContentText('UTF-8'), j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    return { code: r.getResponseCode(), json: j, text: txt };
  };
  for (var i = 0; i < ops.length && !hit; i++) {
    var res = call(ops[i], 1);
    var body = res.json && res.json.response && res.json.response.body;
    var items = body && body.items ? body.items.item : null;
    if (items && !Array.isArray(items)) items = [items];
    var ok = items && items.length && (items[0].comClass !== undefined || items[0].orgComName !== undefined);
    log.push(ops[i] + ' → HTTP ' + res.code + (ok ? ' ✔ ' + body.totalCount + '건' : ' ✖ ' + htmlToText_(res.text).slice(0, 80)));
    if (ok) hit = { op: ops[i], total: +body.totalCount || items.length, items: items };
    else if (res.json && res.json.response && res.json.response.header) log.push('  응답: ' + JSON.stringify(res.json.response.header));
  }
  if (!hit) {
    var keepD = getDumpList(); keepD.apiLog = log; keepD.apiError = '공공데이터 API에서 사토장 목록을 받지 못했습니다(' + now_() + ').';
    saveJson_('DUMP_LIST', keepD);
    throw new Error(keepD.apiError + '\n' + log.join('\n'));
  }
  for (var p = 2; (p - 1) * 1000 < hit.total && p <= 20; p++) {
    var more = call(hit.op, p), b = more.json && more.json.response && more.json.response.body;
    var it = b && b.items ? b.items.item : [];
    hit.items = hit.items.concat(Array.isArray(it) ? it : [it]);
  }
  var rows = hit.items.filter(Boolean).map(function (x) {
    var lat = Number(x.xpos), lng = Number(x.ypos);
    if (lat > 100 && lng < 100) { var t = lat; lat = lng; lng = t; }
    return { kind: x.comClass || '', name: x.orgComName || '', ceo: x.master || '', address: x.addr || '',
             manager: x.memName || '', tel: '', period: [x.gongsiSdate, x.gongsiEdate].filter(Boolean).join('~'),
             lat: lat || null, lng: lng || null, src: 'API' };
  }).filter(function (r) { return r.name && /^\s*(대구|경북|경상북도)/.test(r.address); });
  var cur = getDumpList();
  cur.rows = rows;   // 공공데이터 API 자료로 전부 교체
  cur.apiTotal = hit.items.length;
  cur.updatedAt = now_(); cur.apiAt = now_(); cur.apiCount = rows.length; cur.apiLog = log; delete cur.apiError;
  cur.files = (cur.files || []).concat([{ name: '공공데이터포털 API(' + hit.op + ')', at: now_(), rows: rows.length }]).slice(-20);
  saveJson_('DUMP_LIST', cur);
  return cur;
}

/** 자동 갱신 트리거: 제비율 매일 06시, 사토장(API 키 있을 때) 매주 월 07시 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (/^(checkRateUpdate|refreshDumpsFromApi)$/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkRateUpdate').timeBased().everyDays(1).atHour(6).create();
  if (PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY')) {
    ScriptApp.newTrigger('refreshDumpsFromApi').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  }
  Logger.log('자동 갱신 트리거 설치 완료');
}

// ===================== 8. 주소 → 좌표 =====================
function geocode_(address) {
  var cache = CacheService.getScriptCache();
  var ck = 'geo_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, address, Utilities.Charset.UTF_8));
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var result = null;
  var kakao = prop_('KAKAO_REST_KEY');
  if (kakao) {
    ['address', 'keyword'].some(function (kind) {
      var r = UrlFetchApp.fetch('https://dapi.kakao.com/v2/local/search/' + kind + '.json?query='
        + encodeURIComponent(address), { headers: { Authorization: 'KakaoAK ' + kakao }, muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return false;
      var d = JSON.parse(r.getContentText()).documents || [];
      if (!d.length) return false;
      result = { lat: Number(d[0].y), lng: Number(d[0].x),
                 label: d[0].address_name || d[0].place_name || address, by: '카카오' };
      return true;
    });
  }
  var nId = prop_('NAVER_CLIENT_ID'), nSecret = prop_('NAVER_CLIENT_SECRET');
  if (!result && nId && nSecret) {
    var nr = UrlFetchApp.fetch('https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query='
      + encodeURIComponent(address), { muteHttpExceptions: true,
        headers: { 'x-ncp-apigw-api-key-id': nId, 'x-ncp-apigw-api-key': nSecret, 'Accept': 'application/json' } });
    if (nr.getResponseCode() === 200) {
      var na = JSON.parse(nr.getContentText()).addresses || [];
      if (na.length) result = { lat: Number(na[0].y), lng: Number(na[0].x),
        label: na[0].roadAddress || na[0].jibunAddress || address, by: '네이버' };
    } else {
      Logger.log('네이버 지오코딩 오류 ' + nr.getResponseCode() + ': ' + nr.getContentText().slice(0, 200));
    }
  }
  if (!result) {
    var g = Maps.newGeocoder().setRegion('kr').setLanguage('ko').geocode(address);
    if (g.status === 'OK' && g.results.length) {
      var loc = g.results[0].geometry.location;
      result = { lat: loc.lat, lng: loc.lng, label: g.results[0].formatted_address, by: 'Google' };
    }
  }
  if (result) cache.put(ck, JSON.stringify(result), 21600);
  return result;
}

/** 여러 주소를 한 번에 좌표로 (네이버 키가 있으면 20건씩 동시 요청) */
function geocodeMany_(addresses) {
  var out = new Array(addresses.length), cache = CacheService.getScriptCache();
  var keyOf = function (a) { return 'geo_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, a, Utilities.Charset.UTF_8)); };
  var todo = [];
  addresses.forEach(function (a, i) {
    if (!a) return;
    var hit = cache.get(keyOf(a));
    if (hit) out[i] = JSON.parse(hit); else todo.push(i);
  });
  var nId = prop_('NAVER_CLIENT_ID'), nSecret = prop_('NAVER_CLIENT_SECRET');
  if (nId && nSecret) {
    for (var s = 0; s < todo.length; s += 20) {
      var chunk = todo.slice(s, s + 20), reqs = [];
      chunk.forEach(function (i) {
        reqs.push({ url: 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=' + encodeURIComponent(cleanAddr_(addresses[i])),
          muteHttpExceptions: true, headers: { 'x-ncp-apigw-api-key-id': nId, 'x-ncp-apigw-api-key': nSecret, 'Accept': 'application/json' } });
      });
      UrlFetchApp.fetchAll(reqs).forEach(function (resp, k) {
        var i = chunk[k];
        if (resp.getResponseCode() !== 200) return;
        var na = (JSON.parse(resp.getContentText()).addresses) || [];
        if (na.length) {
          out[i] = { lat: Number(na[0].y), lng: Number(na[0].x), label: na[0].roadAddress || na[0].jibunAddress, by: '네이버' };
          cache.put(keyOf(addresses[i]), JSON.stringify(out[i]), 21600);
        }
      });
    }
  }
  // 남은 것: 한 건씩 (카카오 → 네이버 → Google), 최대 30건
  var budget = 30;
  todo.forEach(function (i) { if (!out[i] && budget-- > 0) out[i] = geocode_(cleanAddr_(addresses[i])); });
  return out;
}

/** "…동 1076-8 대덕프라자10층303호" → "…동 1076-8" 처럼 건물명·호수를 떼어 검색 성공률을 높임 */
function cleanAddr_(a) {
  a = String(a || '').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  var m = a.match(/^(.+?(?:동|리|가|로|길))\s+((?:산\s*)?\d+(?:-\d+)?)/);
  return m ? m[1] + ' ' + m[2] : a;
}

function haversine_(lat1, lng1, lat2, lng2) {
  var R = 6371, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ===================== 9. 공통 도우미 =====================
/** 응답 문자셋 자동 판별 (UTF-8 → EUC-KR) */
function decode_(resp) {
  var ct = String((resp.getHeaders() || {})['Content-Type'] || '');
  var cs = (ct.match(/charset=([\w-]+)/i) || [])[1];
  if (cs) {
    try { return resp.getContentText(/euc-kr|ks_c_5601|cp949|ms949/i.test(cs) ? 'MS949' : cs); } catch (e) {}
  }
  var t = resp.getContentText('UTF-8');
  if (/�/.test(t) || /charset=["']?(euc-kr|ks_c_5601)/i.test(t)) {
    try { return resp.getContentText('MS949'); } catch (e2) { return resp.getContentText('EUC-KR'); }
  }
  return t;
}

/** HTML 표 → [[{cells:[...], raw:'<tr..>'}]] (rowspan/colspan은 무시) */
function parseTables_(html) {
  var tables = [];
  var tre = /<table[\s\S]*?<\/table>/gi, t;
  while ((t = tre.exec(html)) !== null) {
    var rows = [], rre = /<tr[\s\S]*?<\/tr>/gi, r;
    while ((r = rre.exec(t[0])) !== null) {
      var cells = [], cre = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, c;
      while ((c = cre.exec(r[0])) !== null) cells.push(htmlToText_(c[1]));
      if (cells.length) rows.push({ cells: cells, raw: r[0] });
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function htmlToText_(s) {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(n); })
    .replace(/\s+/g, ' ').trim();
}

function pick_(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    for (var k in obj) if (k.replace(/\s/g, '') === keys[i]) return obj[k];
  }
  return '';
}
function toNum_(s) { return Number(String(s).replace(/[^\d.]/g, '')) || 0; }
function round1_(x) { return Math.round(x * 10) / 10; }

/** 스크립트 속성 9KB 제한을 피하기 위해 나눠서 저장 */
function saveJson_(key, obj) {
  var sp = PropertiesService.getScriptProperties();
  var s = JSON.stringify(obj), size = 8000, n = Math.ceil(s.length / size), props = {};
  var oldN = Number(sp.getProperty(key + '_N') || 0);
  for (var i = 0; i < n; i++) props[key + '_' + i] = s.substr(i * size, size);
  props[key + '_N'] = String(n);
  sp.setProperties(props);
  for (var j = n; j < oldN; j++) sp.deleteProperty(key + '_' + j);
}
function loadJson_(key) {
  var sp = PropertiesService.getScriptProperties();
  var n = Number(sp.getProperty(key + '_N') || 0);
  if (!n) return null;
  var s = '';
  for (var i = 0; i < n; i++) s += sp.getProperty(key + '_' + i) || '';
  try { return JSON.parse(s); } catch (e) { return null; }
}
