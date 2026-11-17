/**
 * 간접공사비(제비율) 적용기준 표 — 한국표준품셈정보원(kseis.co.kr) 자료실
 * ------------------------------------------------------------------
 * · checkRateUpdate() : 자료실 목록에서 최신 '간접공사비(제비율) 적용기준' 글을 찾아
 *                       '건축공사_간접공사비_적용기준(yymmdd).xlsx'를 내려받아 표로 변환·저장
 * · installTriggers() (Code.gs): 매일 아침 자동 확인 트리거 설치 (편집기에서 1회 실행)
 * · uploadRateXlsx()  : 사이트 접속이 막혔을 때 웹앱에서 엑셀을 직접 올려 갱신
 * · 저장값이 없으면 RateData.gs 의 RATE_BASELINE(2026.04.13 기준)을 보여줍니다.
 */
var KSEIS = {
  list: 'https://www.kseis.co.kr/bbs/data/dataList.do',
  detail: 'https://www.kseis.co.kr/bbs/data/dataDetail.do?bbs_seq=',
  titleRe: /간접공사비.*제비율|제비율.*간접공사비/,
  fileRe: /건축[^<"]*간접공사비[^<"]*\.xlsx/
};

function getRateTable() {
  var t = loadJson_('RATE_TABLE');
  if (t) return t;
  var b = (typeof RATE_BASELINE !== 'undefined') ? RATE_BASELINE : null;
  if (b) { b.meta.status = 'baseline'; }
  return b;
}

/** 트리거/버튼 공용. force=true면 같은 글이어도 다시 받음 */
function checkRateUpdate(force) {
  if (force && typeof force === 'object') force = false; // 트리거 이벤트 객체
  var log = [];
  var cur = getRateTable();
  var curSeq = cur && cur.meta && cur.meta.bbsSeq;
  try {
    var listHtml = UrlFetchApp.fetch(KSEIS.list, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0' } });
    log.push('자료실 목록 HTTP ' + listHtml.getResponseCode());
    var html = decode_(listHtml);
    var post = null, re = /dataDetail\.do\?bbs_seq=(\d+)[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
      var title = htmlToText_(m[2]);
      if (KSEIS.titleRe.test(title)) { post = { seq: m[1], title: title }; break; }
    }
    if (!post) throw new Error('자료실 첫 페이지에서 제비율 적용기준 글을 찾지 못했습니다.');
    log.push('최신 글: ' + post.title + ' (bbs_seq=' + post.seq + ')');
    if (!force && curSeq === post.seq) {
      var same = cur; same.meta.checkedAt = now_(); same.meta.checkLog = log.concat(['이미 최신입니다.']);
      if (same.meta.status !== 'baseline') saveJson_('RATE_TABLE', same);
      return same;
    }
    var det = decode_(UrlFetchApp.fetch(KSEIS.detail + post.seq, { muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' } }));
    var dateM = det.match(/(\d{4})[.\-](\d{2})[.\-](\d{2})\s*\d{2}:\d{2}/);
    var links = [], lre = /dataFileDown\.do\?bbs_seq=(\d+)&(?:amp;)?file_no=(\d+)[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = lre.exec(det)) !== null) links.push({ url: 'https://www.kseis.co.kr/bbs/data/dataFileDown.do?bbs_seq=' + m[1] + '&file_no=' + m[2], name: htmlToText_(m[3]) });
    var file = links.filter(function (l) { return KSEIS.fileRe.test(l.name); })[0]
            || links.filter(function (l) { return /건축/.test(l.name); })[0];
    if (!file) throw new Error('글에서 건축공사 엑셀 첨부를 찾지 못했습니다. 첨부: ' + links.map(function (l) { return l.name; }).join(', '));
    log.push('첨부: ' + file.name);
    var blob = UrlFetchApp.fetch(file.url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0',
      'Referer': KSEIS.detail + post.seq } }).getBlob();
    var table = xlsxBlobToTable_(blob, file.name);
    table.meta.source = '한국표준품셈정보원 자료실';
    table.meta.postTitle = post.title;
    table.meta.postUrl = KSEIS.detail + post.seq;
    table.meta.bbsSeq = post.seq;
    table.meta.fileUrl = file.url;
    table.meta.postDate = dateM ? dateM[1] + '.' + dateM[2] + '.' + dateM[3] : '';
    table.meta.status = 'auto';
    table.meta.checkLog = log;
    saveJson_('RATE_TABLE', table);
    return table;
  } catch (e) {
    var keep = cur || {};
    keep.meta = keep.meta || {};
    keep.meta.lastError = '자동 갱신 실패(' + now_() + '): ' + e.message
      + ' → 화면의 “엑셀 직접 올리기”로 갱신할 수 있습니다.';
    keep.meta.checkLog = log;
    if (keep.meta.status !== 'baseline' && keep.cells) saveJson_('RATE_TABLE', keep);
    return keep;
  }
}

/** 웹앱에서 엑셀 업로드 (base64) */
function uploadRateXlsx(base64, fileName, pin) {
  var need = PropertiesService.getScriptProperties().getProperty('UPLOAD_PIN');
  if (need && String(pin || '') !== need) throw new Error('업로드 비밀번호(UPLOAD_PIN)가 맞지 않습니다.');
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'application/zip', fileName || 'upload.xlsx');
  var table = xlsxBlobToTable_(blob, fileName);
  table.meta.source = '직접 업로드';
  table.meta.status = 'upload';
  saveJson_('RATE_TABLE', table);
  return table;
}

function xlsxBlobToTable_(blob, fileName) {
  var files = {};
  Utilities.unzip(blob.setContentType('application/zip')).forEach(function (b) {
    if (/\.(xml|rels)$/.test(b.getName())) files[b.getName()] = b.getDataAsString('UTF-8');
  });
  if (!files['xl/workbook.xml']) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
  var t = xlsxToTable_(files);
  t.meta.fileName = fileName || '';
  t.meta.fetchedAt = now_();
  return t;
}

// ---------- 순수 파서 (Node에서도 테스트 가능) ----------
function xlsxToTable_(files) {
  var unesc = function (s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&amp;/g, '&');
  };
  var attr = function (tag, name) { var m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? m[1] : null; };
  // 첫 번째 시트 경로
  var wb = files['xl/workbook.xml'];
  var sheetTag = (wb.match(/<sheet\b[^>]*>/) || [''])[0];
  var sheetName = unesc(attr(sheetTag, 'name') || '');
  var rid = attr(sheetTag, 'r:id');
  var rels = files['xl/_rels/workbook.xml.rels'] || '';
  var relTag = (rels.match(new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*>')) || [''])[0];
  var target = (attr(relTag, 'Target') || 'worksheets/sheet1.xml').replace(/^\/?(xl\/)?/, '');
  var sheet = files['xl/' + target];
  // 공유 문자열
  var sst = [];
  ((files['xl/sharedStrings.xml'] || '').match(/<si>[\s\S]*?<\/si>/g) || []).forEach(function (si) {
    var t = ''; (si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).forEach(function (x) { t += x.replace(/<t\b[^>]*>|<\/t>/g, ''); });
    sst.push(unesc(t).replace(/\r/g, ''));
  });
  // 스타일
  var st = files['xl/styles.xml'] || '';
  var numFmts = {};
  (st.match(/<numFmt\b[^>]*\/>/g) || []).forEach(function (n) { numFmts[attr(n, 'numFmtId')] = unesc(attr(n, 'formatCode')); });
  var builtin = { '0': 'General', '1': '0', '2': '0.00', '3': '#,##0', '4': '#,##0.00', '9': '0%', '10': '0.00%' };
  var sec = function (name) { var m = st.match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>')); return m ? m[1] : ''; };
  var fonts = (sec('fonts').match(/<font\b[\s\S]*?<\/font>|<font\b[^>]*\/>/g) || []).map(function (f) {
    var c = (f.match(/<color\b[^>]*\/>/) || [''])[0];
    return { b: /<b\/>|<b val="1"\/>/.test(f), c: rgb_(attr(c, 'rgb')), sz: +(attr((f.match(/<sz\b[^>]*\/>/) || [''])[0], 'val') || 11),
             u: /<u\b/.test(f) };
  });
  var fills = (sec('fills').match(/<fill\b[\s\S]*?<\/fill>|<fill\b[^>]*\/>/g) || []).map(function (f) {
    if (!/patternType="solid"/.test(f)) return null;
    var c = (f.match(/<fgColor\b[^>]*\/>/) || [''])[0];
    return rgb_(attr(c, 'rgb')) || (attr(c, 'theme') !== null ? themeFill_(attr(c, 'theme'), attr(c, 'tint')) : null);
  });
  var borders = (sec('borders').match(/<border\b[\s\S]*?<\/border>|<border\b[^>]*\/>/g) || []).map(function (b) {
    var side = function (n) { var m = b.match(new RegExp('<' + n + '\\b[^>]*style="(\\w+)"')); return m ? (/medium|thick|double/.test(m[1]) ? 2 : (/dash|dot|hair/.test(m[1]) ? 3 : 1)) : 0; };
    return [side('top'), side('right'), side('bottom'), side('left')];
  });
  var xfs = (sec('cellXfs').match(/<xf\b[\s\S]*?(?:<\/xf>|\/>)/g) || []).map(function (x) {
    var al = (x.match(/<alignment\b[^>]*\/>/) || [''])[0];
    var nf = attr(x, 'numFmtId') || '0';
    return { font: fonts[+(attr(x, 'fontId') || 0)] || {}, fill: fills[+(attr(x, 'fillId') || 0)] || null,
             border: borders[+(attr(x, 'borderId') || 0)] || [0, 0, 0, 0],
             h: attr(al, 'horizontal') || '', v: attr(al, 'vertical') || '', fmt: numFmts[nf] || builtin[nf] || 'General' };
  });
  // 열 너비
  var colW = {};
  (sheet.match(/<col\b[^>]*\/>/g) || []).forEach(function (c) {
    for (var i = +attr(c, 'min'); i <= +attr(c, 'max'); i++) colW[i] = +attr(c, 'width');
  });
  var defW = +(attr((sheet.match(/<sheetFormatPr\b[^>]*>/) || [''])[0], 'defaultColWidth') || 8.43);
  // 셀
  var cells = {}, maxR = 0, maxC = 0, minR = 1e9, minC = 1e9;
  var cre = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
  while ((m = cre.exec(sheet)) !== null) {
    var col = colNum_(m[1]), row = +m[2], a = m[3], inner = m[4] || '';
    var s = +(attr(a, 's') || 0), t = attr(a, 't'), v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    var text = '';
    if (t === 's' && v != null) text = sst[+v];
    else if (t === 'inlineStr') text = unesc((inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/) || ['', ''])[1]);
    else if (v != null) text = (t === 'str' || t === 'e') ? unesc(v) : fmtNum_(+v, xfs[s] ? xfs[s].fmt : 'General');
    cells[row + ',' + col] = { t: text, s: s };
    var xf = xfs[s] || {};
    var visible = text !== '' || xf.fill || (xf.border && xf.border.join('') !== '0000');
    if (visible) { maxR = Math.max(maxR, row); maxC = Math.max(maxC, col); minR = Math.min(minR, row); minC = Math.min(minC, col); }
  }
  // 병합
  var merges = [];
  (sheet.match(/<mergeCell ref="[^"]+"\/>/g) || []).forEach(function (x) {
    var r = x.match(/ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/);
    if (r) merges.push([+r[2], colNum_(r[1]), +r[4], colNum_(r[3])]);
  });
  // 인쇄영역(있으면) 우선
  var pa = wb.match(/<definedName name="_xlnm\.Print_Area"[^>]*localSheetId="0"[^>]*>([^<]+)<\/definedName>/);
  if (pa) {
    var pr = pa[1].match(/\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)/);
    if (pr) { minC = colNum_(pr[1]); minR = +pr[2]; maxC = colNum_(pr[3]); maxR = +pr[4]; }
  }
  // 스타일 테이블 압축
  var styleIdx = {}, styles = [];
  var styleOf = function (s) {
    var xf = xfs[s] || { font: {}, border: [0, 0, 0, 0] };
    var key = JSON.stringify([xf.font.b, xf.font.c, xf.font.sz, xf.fill, xf.border, xf.h, xf.v, xf.font.u]);
    if (styleIdx[key] == null) { styleIdx[key] = styles.length; styles.push({ b: !!xf.font.b, c: xf.font.c || '', sz: xf.font.sz || 11, bg: xf.fill || '', bd: xf.border, h: xf.h, v: xf.v, u: !!xf.font.u }); }
    return styleIdx[key];
  };
  var covered = {}, out = [];
  merges.forEach(function (g) {
    for (var r = g[0]; r <= g[2]; r++) for (var c = g[1]; c <= g[3]; c++) if (r !== g[0] || c !== g[1]) covered[r + ',' + c] = 1;
  });
  var mergeAt = {}; merges.forEach(function (g) { mergeAt[g[0] + ',' + g[1]] = g; });
  for (var r = minR; r <= maxR; r++) {
    for (var c = minC; c <= maxC; c++) {
      var k = r + ',' + c;
      if (covered[k]) continue;
      var cell = cells[k], g = mergeAt[k];
      if (!cell && !g) continue;
      var sIdx = styleOf(cell ? cell.s : 0);
      var rs = g ? Math.min(g[2], maxR) - r + 1 : 1, cs = g ? Math.min(g[3], maxC) - c + 1 : 1;
      if (g) { // 병합 영역 테두리: 오른쪽·아래는 끝 셀 스타일 반영
        var br = cells[r + ',' + g[3]], bb = cells[g[2] + ',' + c];
        var bd = (xfs[cell ? cell.s : 0] || {}).border || [0, 0, 0, 0];
        var right = br ? ((xfs[br.s] || {}).border || [0, 0, 0, 0])[1] : bd[1];
        var bottom = bb ? ((xfs[bb.s] || {}).border || [0, 0, 0, 0])[2] : bd[2];
        if (right !== bd[1] || bottom !== bd[2]) {
          var base = styles[sIdx], copy = JSON.parse(JSON.stringify(base)); copy.bd = [bd[0], right || bd[1], bottom || bd[2], bd[3]];
          var key2 = JSON.stringify(copy); if (styleIdx[key2] == null) { styleIdx[key2] = styles.length; styles.push(copy); } sIdx = styleIdx[key2];
        }
      }
      out.push([r - minR, c - minC, rs, cs, cell ? cell.t : '', sIdx]);
    }
  }
  var widths = [];
  for (var cc = minC; cc <= maxC; cc++) widths.push(Math.round((colW[cc] || defW) * 7 + 5));
  var all = out.map(function (x) { return x[4]; }).join('\n');
  var basisM = all.match(/적용시기\s*[:：]\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  var titleCell = out.filter(function (x) { return /적용기준/.test(x[4]); })[0];
  return {
    meta: { sheetName: sheetName, title: titleCell ? titleCell[4].split('\n')[0] : sheetName,
            basis: basisM ? basisM[1] + '.' + ('0' + basisM[2]).slice(-2) + '.' + ('0' + basisM[3]).slice(-2) : '',
            rows: maxR - minR + 1, cols: maxC - minC + 1 },
    widths: widths, styles: styles, cells: out
  };
}

function colNum_(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
function rgb_(argb) { if (!argb || argb.length < 6) return null; var h = argb.slice(-6); return h.toUpperCase() === '000000' ? null : '#' + h; }
function themeFill_(theme, tint) {
  var base = { '0': [255, 255, 255], '1': [0, 0, 0], '2': [231, 230, 230], '3': [68, 84, 106], '4': [68, 114, 196],
               '5': [237, 125, 49], '6': [165, 165, 165], '7': [255, 192, 0], '8': [91, 155, 213], '9': [112, 173, 71] }[theme];
  if (!base) return null;
  var t = +(tint || 0);
  var c = base.map(function (v) { return Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t); });
  if (c.join() === '255,255,255') return null;
  return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
}
function fmtNum_(v, fmt) {
  if (isNaN(v)) return '';
  fmt = String(fmt || 'General').split(';')[0];
  if (fmt === 'General' || fmt === '@') { var r = Math.round(v * 1e10) / 1e10; return String(r); }
  var pct = /%/.test(fmt); if (pct) v = v * 100;
  var dm = fmt.match(/\.([0#]+)/), dec = dm ? dm[1].replace(/#/g, '').length : 0;
  var s = v.toFixed(dec);
  if (/#,##/.test(fmt)) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); }
  return s + (pct ? '%' : '');
}
