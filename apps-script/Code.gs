/****************************************************************************************
 * 섬개미 증시 브리핑 — 배포 파이프라인 (Google Apps Script)
 *
 * 흐름: Gemini Spark(Drive 리서치) → Claude(분석 JSON을 Drive AntBrief_Analysis 폴더에 저장)
 *       → 이 스크립트(10분마다: 두 파일 병합 → HTML 생성 → GitHub Antbrief 저장소에 1커밋)
 *       → Vercel 자동 배포
 *
 * 설치: GITHUB_TOKEN 한 줄만 채우고 저장 → 상단 함수 선택에서 setup 실행 → 권한 허용.
 *       setup이 끝나면 GITHUB_TOKEN 값은 지워도 됩니다(스크립트 속성에 저장됨).
 *
 * 2026-10-15 변경: 작업 메모성 correction 제거, 검색용 구조화 데이터(NewsArticle), RSS 피드(feed.xml)
 ****************************************************************************************/
var GITHUB_OWNER = '';   // 비워 두면 토큰에서 자동으로 찾습니다
var GITHUB_TOKEN = '';   // fine-grained 토큰: Antbrief 저장소만, Contents = Read and write
var CONTACT_EMAIL = '';  // 소개 페이지에 표시할 문의 메일. 비우면 표시하지 않음

var REPO_NAME = 'Antbrief';
var ANALYSIS_FOLDER_ID = '1YlTixofCTEXSbGVKdC7XM3YsrHZn9agd'; // Drive: AntBrief_Analysis
var SPARK_FOLDER_ID = '1J3gByI66ILXz5fPQ2JpC-WbRY74DRXy1';    // Drive: MarketBrief (하위 archive 폴더는 건드리지 않음)
var SITE = 'https://antbrief.vercel.app';   // 18행
var TZ = 'Asia/Seoul';
var LIVE_FILES = ['app.js', 'style.css', 'ads.txt', 'google6cc9dec3c29a2feb.html', 'favicon.png', 'favicon.ico', 'og.png'];
var ARCHIVE_MAX = 500;
var FEED_MAX = 20;

var MARKET_HEAD = ['지표', '현재', '등락', '기준 시점'];
var NEWS_HEAD = ['뉴스', '중요도', '방향', '영향섹터', '한 줄 해설'];
var CAL_HEAD = ['일시 (KST)', '이벤트', '중요도', '예상 영향'];
var SCEN_HEAD = ['시나리오', '방향', '한 줄 해석'];
var DISCLAIMER = '본 브리핑은 정보 제공 목적이며 투자 권유가 아닙니다. 투자 판단과 책임은 본인에게 있습니다.';

/* ===================================== 설치 ===================================== */

function setup() {
  var p = PropertiesService.getScriptProperties();
  if (GITHUB_TOKEN) p.setProperty('GITHUB_TOKEN', GITHUB_TOKEN);
  if (GITHUB_OWNER) p.setProperty('GITHUB_OWNER', GITHUB_OWNER);
  if (!p.getProperty('GITHUB_TOKEN')) throw new Error('맨 위의 GITHUB_TOKEN을 채운 뒤 다시 실행하세요.');
  p.deleteProperty('GITHUB_REPO');
  Logger.log('사용할 저장소: ' + repoPath_());
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'publish') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('publish').timeBased().everyMinutes(10).create();
  bootstrap();
  Logger.log('설치 완료. 10분마다 publish가 실행됩니다.');
}

/** 저장소 최초 채우기: 라이브 사이트의 정적 파일 + 새 페이지들을 한 커밋으로 올린다. */
function bootstrap() {
  if (gh_('get', '/contents/app.js').code === 200) {
    Logger.log('이미 초기화된 저장소입니다. bootstrap을 건너뜁니다.');
    return;
  }
  var files = [];
  // 1) 현재 라이브 브리핑 데이터로 새 index.html을 만든다 (빈 저장소면 첫 파일이 되므로 맨 앞).
  var live = UrlFetchApp.fetch(SITE + '/index.html', { muteHttpExceptions: true }).getContentText('UTF-8');
  var m = live.match(/<script type="application\/json" id="briefing-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('라이브 index.html에서 브리핑 데이터를 찾지 못했습니다.');
  files.push({ path: 'index.html', text: buildPage_(clean_(JSON.parse(m[1])), SITE + '/') });
  // 2) 바뀌지 않는 정적 파일은 라이브 사이트에서 그대로 복사.
  LIVE_FILES.forEach(function (name) {
    var r = UrlFetchApp.fetch(SITE + '/' + name, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('라이브 파일 가져오기 실패: ' + name + ' (' + r.getResponseCode() + ')');
    files.push({ path: name, b64: Utilities.base64Encode(r.getBlob().getBytes()) });
  });
  // 3) 애드센스 심사용 페이지.
  files.push({ path: 'about.html', text: aboutPage_() });
  files.push({ path: 'privacy.html', text: privacyPage_() });
  files.push({ path: 'archive/index.html', text: archiveIndex_([]) });
  files.push({ path: 'archive/list.json', text: '[]' });
  files.push({ path: 'robots.txt', text: 'User-agent: *\nAllow: /\nSitemap: ' + SITE + '/sitemap.xml\n' });
  files.push({ path: 'sitemap.xml', text: sitemap_([]) });
  files.push({ path: 'feed.xml', text: feedXml_([]) });
  commitFiles_(files, 'bootstrap: 정적 파일, 소개·개인정보·아카이브 페이지');
  Logger.log('bootstrap 완료: ' + files.length + '개 파일');
}

/* ===================================== 정기 실행 ===================================== */

var BRIEF_PREFIX = /^Briefing_/;
var SLOTS = ['08:00', '14:00', '16:30', '23:00']; // 사이트 갱신 시각(KST). Gemini는 매시간 쓰고, 이 시각마다 가장 최근 파일 1개만 올린다.
// 유사투자자문 회피용 최소 검사. 걸리면 배포 중단 후 메일. 오탐이면 이 목록을 줄이면 됨.
var BANNED = /(매수|매도|비중\s*(확대|축소))\s*(추천|권유|하세요|하라|하십시오|유효|전략|기회)|(분할|추가)\s*매수(?!세)|저가\s*매수\s*(기회|전략|추천|권유|하세요|하라)|목표\s*주가\s*\d|사세요|파세요|담으세요|지금이\s*(매수|매도)\s*(기회|타이밍)/;

/** 지금이 속한 갱신 시각 키(예: 2026-10-19 14:00). 08:00 전이면 전날 23:00. */
function slotKey_(now) {
  var hm = Utilities.formatDate(now, TZ, 'HH:mm'), cur = null;
  SLOTS.forEach(function (t) { if (hm >= t) cur = t; });
  if (cur) return Utilities.formatDate(now, TZ, 'yyyy-MM-dd') + ' ' + cur;
  return Utilities.formatDate(new Date(now.getTime() - 24 * 3600 * 1000), TZ, 'yyyy-MM-dd') + ' ' + SLOTS[SLOTS.length - 1];
}

/** 10분마다: 갱신 시각이 지났고 이번 회차를 아직 못 올렸으면, Gemini Briefing_ 파일 또는 Claude Analysis_ 파일 중 가장 최신 1개를 배포한다.
 *  실패하면 다음 갱신 시각 전까지 새로 들어오는 파일로 계속 다시 시도한다. */
function publish() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties(), slot = slotKey_(new Date());
    if (props.getProperty('LAST_SLOT') === slot) return;
    var job = nextJob_();
    if (!job) return;
    var f = job.file;
    try {
      var a, s;
      if (job.kind === 'gemini') {
        s = parseJson_(readText_(f));
        a = s.brief;
        if (!a) throw new Error('Briefing 파일에 brief 객체가 없습니다.');
        a.spark_id = f.getId();
      } else {
        a = parseJson_(readText_(f));
        s = a.spark_id ? parseJson_(readText_(DriveApp.getFileById(a.spark_id))) : {};
      }
      checkCompliance_(a);
      var stale = job.kind === 'gemini' && staleReason_(s.market);
      if (stale) { // 지난 장 데이터로 쓴 글이면 올리지 않고, 다음 실행에서 더 새 파일을 기다린다
        f.setName('[지난시황] ' + f.getName());
        if (props.getProperty('STALE_SLOT') !== slot) { // 회차마다 한 번만 알림
          props.setProperty('STALE_SLOT', slot);
          MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[섬개미] 지난 시황 브리핑 보류',
            '파일: ' + f.getName() + '\n이유: ' + stale + '\n\n사이트는 직전 브리핑을 유지하고, 다음 갱신 시각 전까지 Gemini가 새로 쓰는 파일로 다시 시도합니다.');
        }
        return;
      }
      var data = merge_(a, s);
      liveMarket_(data.market);
      var slug = slugOf_(data.stamp);
      var list = readRepoJson_('archive/list.json') || [];
      list = list.filter(function (e) { return e.slug !== slug; });
      list.unshift({ slug: slug, short: data.short, sub: data.sub, stocks: data.stocks, m: marketMap_(data.market) });
      list = list.slice(0, ARCHIVE_MAX);
      commitFiles_([
        { path: 'index.html', text: buildPage_(data, SITE + '/') },
        { path: 'archive/' + slug + '.html', text: buildPage_(data, SITE + '/archive/' + slug + '.html') },
        { path: 'archive/index.html', text: archiveIndex_(list) },
        { path: 'archive/list.json', text: JSON.stringify(list) },
        { path: 'calendar.html', text: calendarPage_(data) },
        { path: 'sitemap.xml', text: sitemap_(list) },
        { path: 'feed.xml', text: feedXml_(list) }
      ].concat(termFiles_(list), regimeFiles_()), 'briefing ' + data.short + (job.kind === 'gemini' ? ' (gemini)' : ''));
      props.setProperty('LAST_SLOT', slot);
      if (job.kind === 'gemini') { f.setName('[배포완료] ' + f.getName()); a.spark_id = null; }
      cleanup_(a.spark_id); // gemini 경로면 spark_id가 null이라 방금 배포한 파일은 24시간 뒤 정리에서 지워짐
    } catch (e) {
      f.setName('[오류] ' + f.getName());
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[섬개미] 브리핑 배포 실패',
        '파일: ' + f.getName() + '\n오류: ' + (e && e.stack ? e.stack : e) +
        '\n\n사이트는 직전 브리핑을 유지합니다. 파일 이름에서 [오류] 를 지우면 다음 실행(10분 내)에 다시 시도합니다.');
      throw e;
    }
  } finally {
    lock.releaseLock();
  }
}

/** 두 폴더에서 처리할 파일을 고른다. 각 폴더의 오래된 미처리 파일과, 더 오래된 쪽 폴더의 최신 파일은 [건너뜀] 처리. */
function nextJob_() {
  function pick(folderId, re) {
    var it = DriveApp.getFolderById(folderId).getFiles(), out = [];
    while (it.hasNext()) { var x = it.next(); if (re.test(x.getName())) out.push(x); }
    out.sort(function (p, q) { return q.getDateCreated() - p.getDateCreated(); });
    for (var i = 1; i < out.length; i++) out[i].setName('[건너뜀] ' + out[i].getName());
    return out[0] || null;
  }
  var A = pick(ANALYSIS_FOLDER_ID, /^Analysis_/);
  var G = pick(SPARK_FOLDER_ID, BRIEF_PREFIX);
  if (A && G) {
    if (A.getDateCreated() >= G.getDateCreated()) { G.setName('[건너뜀] ' + G.getName()); G = null; }
    else { A.setName('[건너뜀] ' + A.getName()); A = null; }
  }
  if (G) return { kind: 'gemini', file: G };
  if (A) return { kind: 'analysis', file: A };
  return null;
}

/** 사람이 읽는 문장 필드에서 투자 권유 의심 표현을 찾으면 배포를 멈춘다. */
function checkCompliance_(a) {
  var text = JSON.stringify([a.sub, a.lead, a.commentary, a.verdict, a.news, a.cal, a.calNote, a.scen, a.stats, a.correction, a.review, a.stocks]);
  var m = text.match(BANNED);
  if (m) throw new Error('투자 권유 의심 표현 발견: ' + m[0] + ' (해당 회차 배포 중단)');
}

/** 배포에 쓴 Spark/Briefing 원본과 24시간 지난 Spark 파일은 휴지통으로(30일 내 복구 가능), 처리 끝난 분석 파일은 3일 뒤 휴지통으로. 실패해도 배포에는 영향 없음. */
function cleanup_(sparkId) {
  try { if (sparkId) DriveApp.getFileById(sparkId).setTrashed(true); } catch (e) { Logger.log('Spark 삭제 실패: ' + e); }
  try {
    var cut = Date.now() - 3 * 24 * 3600 * 1000, it = DriveApp.getFolderById(ANALYSIS_FOLDER_ID).getFiles();
    while (it.hasNext()) {
      var x = it.next();
      if (/^\[(배포완료|건너뜀)\]/.test(x.getName()) && x.getDateCreated().getTime() < cut) x.setTrashed(true);
    }
  } catch (e) { Logger.log('분석 파일 정리 실패: ' + e); }
  try { // MarketBrief 폴더와 하위 MarketBrief_archive 폴더: 24시간 지난 파일은 휴지통([오류] 붙은 것은 확인용으로 남김)
    var cut2 = Date.now() - 24 * 3600 * 1000, folder = DriveApp.getFolderById(SPARK_FOLDER_ID), it2 = folder.getFiles();
    while (it2.hasNext()) {
      var y = it2.next();
      if (/^(\[(삭제보관|건너뜀|배포완료|지난시황)\] )?(MarketBrief|Briefing)_/.test(y.getName()) && y.getDateCreated().getTime() < cut2) y.setTrashed(true);
    }
    var subs = folder.getFoldersByName('MarketBrief_archive');
    while (subs.hasNext()) {
      var it3 = subs.next().getFiles();
      while (it3.hasNext()) { var z = it3.next(); if (z.getDateCreated().getTime() < cut2) z.setTrashed(true); }
    }
  } catch (e) { Logger.log('Spark 폴더 정리 실패: ' + e); }
}
/* ===================================== 데이터 ===================================== */

function readText_(file) {
  if (file.getMimeType() === MimeType.GOOGLE_DOCS) return DocumentApp.openById(file.getId()).getBody().getText();
  return file.getBlob().getDataAsString('UTF-8');
}

/** 코드블록·문서 변환 흔적(\[ \_ 등, NBSP)을 걷어내고 첫 { ~ 마지막 } 를 JSON으로 읽는다. */
function parseJson_(txt) {
  txt = String(txt).replace(/\\([\[\]_~&*#+.!<>|`-])/g, '$1').replace(/ /g, ' ');
  var i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('JSON을 찾을 수 없습니다.');
  return JSON.parse(txt.slice(i, j + 1));
}

function fill_(n) { var a = []; for (var i = 0; i < n; i++) a.push(''); return a; }

/** "특이사항 없어 표준 절차로 처리" 같은 작업 메모는 독자에게 보이지 않게 빈 값으로. */
function cleanCorrection_(c) {
  c = String(c || '').trim();
  return /특이\s*사항\s*(이\s*)?없|표준\s*절차/.test(c) ? '' : c;
}

/** Claude 분석(a) + Spark 원본(s) → 사이트 스키마. a에 같은 키가 있으면 a가 우선(폴백·정정용). */
function merge_(a, s) {
  ['stamp', 'short', 'sub', 'lead'].forEach(function (k) {
    if (!a[k]) throw new Error('분석 파일에 ' + k + ' 가 없습니다.');
  });
  var market = JSON.parse(JSON.stringify(a.market || s.market || null));
  if (!market || !market.rows || !market.rows.length) throw new Error('market 데이터가 없습니다.');
  market.head = market.head || MARKET_HEAD;
  market.colcls = market.colcls || fill_(market.head.length);
  (a.market_fix || []).forEach(function (fx) { market.rows[fx[0]].c[fx[1]] = fx[2]; });
  market.rows.forEach(function (r) {
    r.c = r.c.map(function (v) { return v == null ? '확인 불가' : v; });
    r.d = r.d || 'neutral';
  });
  var newsRaw = s.news_raw || s.news || [], calRaw = s.cal_raw || s.cal || [];
  var news = (a.news || []).slice(0, 7).map(function (r) {
    var head = typeof r[0] === 'number' ? (newsRaw[r[0]] || {}).t : r[0];
    if (!head) throw new Error('news 인덱스 오류: ' + r[0]);
    return { c: [head].concat(r.slice(1, 5)) };
  });
  var cal = (a.cal || []).map(function (r) {
    if (typeof r[0] === 'number') {
      var c = calRaw[r[0]];
      if (!c) throw new Error('cal 인덱스 오류: ' + r[0]);
      return { c: [c.when, c.event, r[1], r[2]] };
    }
    return { c: r.slice(0, 4) };
  });
  return clean_({
    stamp: a.stamp, short: a.short, sub: a.sub, lead: a.lead,
    commentary: (a.commentary || []).slice(0, 6),
    market: market,
    stats: a.stats || s.stats || [],
    correction: cleanCorrection_(a.correction),
    news: { head: NEWS_HEAD, colcls: fill_(5), rows: news },
    verdict: a.verdict || [],
    cal: { head: CAL_HEAD, colcls: fill_(4), rows: cal },
    calNote: a.calNote || '',
    scen: (a.scen || []).slice(0, 2).map(function (x) {
      return { t: x.t, stars: x.stars, intro: x.intro, head: SCEN_HEAD, colcls: fill_(3),
        rows: (x.rows || []).map(function (r) { return { c: r }; }), watch: x.watch || '' };
    }),
    stocks: cleanStocks_(a.stocks),
    stockDir: cleanStockDir_(a.stock_dir, cleanStocks_(a.stocks)),
    review: cleanReview_(a.review),
    disclaimer: DISCLAIMER,
    sources: cleanSources_(a.sources || s.sources || [])
  });
}

/** 출처 정리: 형식 오류·중복 제거, 홈페이지뿐인 URL은 링크 없이 라벨만 남긴다(url ''). 네트워크 확인은 하지 않는다(UrlFetch는 타임아웃 지정이 안 돼 응답 없는 언론사 하나로 6분 제한에 걸림). */
function cleanSources_(list) {
  var seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(function (s) {
    if (!Array.isArray(s) || typeof s[0] !== 'string' || typeof s[1] !== 'string') return;
    var label = s[0].trim(), url = s[1].trim();
    if (!label || !/^https?:\/\/[^\s\/?#]+/i.test(url) || seen[url]) return;
    seen[url] = 1;
    out.push([label, /^https?:\/\/[^\/?#]+\/?$/i.test(url) ? '' : url]);
  });
  return out;
}

/** 과거 렌더링 오류 원인이던 따옴표류·줄바꿈 제거. */
/** 관련 종목: 이름만, 중복 제거, 최대 6개. 없으면 빈 배열(태그만 안 나옴). */
function cleanStocks_(list) {
  var seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(function (x) {
    x = String(x == null ? '' : x).replace(/[<>&"]/g, '').trim();
    if (x && x.length <= 20 && !seen[x] && out.length < 6) { seen[x] = 1; out.push(x); }
  });
  return out;
}

/** 종목별 뉴스 영향 방향 {종목: up|down|neutral|vol}. stocks에 있는 종목만 남긴다. 없으면 사이트가 뉴스 방향으로 대신 짐작. */
function cleanStockDir_(m, names) {
  var out = {};
  names.forEach(function (n) {
    var v = m && m[n];
    if (v === 'up' || v === 'down' || v === 'neutral' || v === 'vol') out[n] = v;
  });
  return out;
}

/** 직전 회차 시나리오 복기 {prev, pick, text}. text가 없으면 null(화면에 안 나옴). */
function cleanReview_(r) {
  if (!r || !r.text) return null;
  return { prev: String(r.prev || '').slice(0, 30), pick: String(r.pick || '').slice(0, 20), text: String(r.text).slice(0, 300) };
}

/** 지표 카드 숫자는 Gemini 대신 Yahoo 시세로 덮어쓴다(Gemini가 새 값을 못 찾으면 옛 값을 남기거나 지어내서). 받아오기 실패한 지표는 Gemini 값을 그대로 둔다. */
var LIVE_SYMBOLS = { '코스피': ['^KS11', 'p'], '코스닥': ['^KQ11', 'p'], '원/달러': ['KRW=X', '원'], 'S&P 500': ['^GSPC', 'p'], '나스닥': ['^IXIC', 'p'],
  '다우': ['^DJI', 'p'], '브렌트유': ['BZ=F', '$'], 'WTI': ['CL=F', '$'], '금': ['GC=F', '$'], '미 10년물': ['^TNX', '%p'] };

/** 편집기 확인용: 실행 로그에 지표 10개 값이 찍히면 정상. */
function testLive() {
  var m = { rows: Object.keys(LIVE_SYMBOLS).map(function (k) { return { c: [k, '확인 불가', '확인 불가', ''] }; }) };
  liveMarket_(m);
  Logger.log(m.rows.map(function (r) { return r.c.join(' | ') + ' | 선 ' + (r.s ? r.s.length + '점' : '없음'); }).join('\n'));
}

function liveMarket_(market) {
  var now = Date.now() / 1000;
  market.rows.forEach(function (r) {
    var x = LIVE_SYMBOLS[r.c[0]];
    if (!x) return;
    try {
      var q = quote_(x[0]);
      var diff = q.price - q.prev, pct = diff / q.prev * 100, sign = diff > 0 ? '+' : diff < 0 ? '-' : '', ad = Math.abs(diff);
      var p = q.meta.currentTradingPeriod && q.meta.currentTradingPeriod.regular;
      var open = p && now >= p.start && now < p.end && now - q.meta.regularMarketTime < 3600;
      var when = open ? Utilities.formatDate(new Date(q.meta.regularMarketTime * 1000), TZ, 'MM/dd HH:mm') + ' 장중'
        : Utilities.formatDate(new Date(q.meta.regularMarketTime * 1000), q.meta.exchangeTimezoneName || TZ, 'MM/dd') + ' 마감';
      var chg = x[1] === '%p' ? sign + ad.toFixed(2) + '%p'
        : (x[1] === '$' ? sign + '$' + num_(ad) : sign + num_(ad) + x[1]) + ' (' + sign + Math.abs(pct).toFixed(2) + '%)';
      r.c = [r.c[0], x[1] === '%p' ? q.price.toFixed(2) + '%' : num_(q.price), chg, x[0] === 'GC=F' ? when + ' 선물' : when];
      r.d = diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral';
      r.s = q.closes.map(function (v) { return Math.round(v * 100) / 100; }); // 카드 선: 실제 일별 종가 + 현재가
    } catch (e) {
      Logger.log('시세 건너뜀 ' + r.c[0] + ': ' + e);
    }
  });
}

/** Gemini가 쓴 코스피 행이 실제 최근 거래일과 다르면 이유 문자열, 같으면 ''.
 *  기준 시점 날짜(MM/DD)가 Yahoo 최근 거래일과 다르거나, 값이 1% 넘게 다르면 지난 시황으로 본다.
 *  코스피만 본다: 미국 지수는 23:00 회차 직전에 개장해서 날짜가 바뀌는 게 정상이라 오탐이 난다. */
function staleReason_(market) {
  var row = ((market && market.rows) || []).filter(function (r) { return r.c && r.c[0] === '코스피'; })[0];
  if (!row) return '코스피 행 없음';
  var q;
  try { q = quote_('^KS11'); } catch (e) { return ''; } // 시세를 못 받으면 막지 않는다
  var live = Utilities.formatDate(new Date(q.meta.regularMarketTime * 1000), TZ, 'MM/dd');
  var m = String(row.c[3] || '').match(/(\d{1,2})\/(\d{1,2})/);
  if (m) {
    var got = ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2);
    if (got !== live) return '코스피 기준 시점 ' + got + ', 실제 최근 거래일 ' + live;
  }
  // 날짜가 맞아도 값이 1% 넘게 다르면 막는다: 표는 Yahoo로 덮어쓰지만 제목·요약·해설은 Gemini 숫자 그대로라 한 페이지에 숫자가 둘이 된다(10/23 14:00 5384 vs 5474)
  var v = parseFloat(String(row.c[1] || '').replace(/,/g, ''));
  if (!v) return '코스피 값 없음';
  return Math.abs(v - q.price) / q.price > 0.01 ? '코스피 ' + row.c[1] + ', 실제 ' + num_(q.price) + ' (본문 숫자가 표와 달라짐)' : '';
}

/** 편집기 확인용: 지금 Drive의 가장 최근 Briefing_ 파일이 지난 시황 검사에 걸리는지 로그로 본다(파일 이름은 안 바꾼다). */
function testStale() {
  var it = DriveApp.getFolderById(SPARK_FOLDER_ID).getFiles(), best = null;
  while (it.hasNext()) { var x = it.next(); if (/Briefing_/.test(x.getName()) && (!best || x.getDateCreated() > best.getDateCreated())) best = x; }
  if (!best) return Logger.log('Briefing_ 파일 없음');
  Logger.log(best.getName() + ' → ' + (staleReason_(parseJson_(readText_(best)).market) || '통과'));
}

/** 현재가, 직전 거래일 종가, 최근 한 달 일별 종가(마지막은 현재가). 일봉 마지막 날이 현재가 날짜면 그 앞날 종가가 직전 종가. */
function quote_(sym) {
  var r = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=1mo&interval=1d',
    { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (r.getResponseCode() !== 200) throw new Error(sym + ' ' + r.getResponseCode());
  var res = JSON.parse(r.getContentText()).chart.result[0], m = res.meta, tz = m.exchangeTimezoneName || TZ, cl = res.indicators.quote[0].close;
  var day = Utilities.formatDate(new Date(m.regularMarketTime * 1000), tz, 'yyyy-MM-dd'), prev = null, closes = [];
  res.timestamp.forEach(function (t, i) {
    if (cl[i] != null && Utilities.formatDate(new Date(t * 1000), tz, 'yyyy-MM-dd') < day) { prev = cl[i]; closes.push(cl[i]); }
  });
  if (!m.regularMarketPrice || !prev) throw new Error(sym + ' 값 없음');
  return { price: m.regularMarketPrice, prev: prev, meta: m, closes: closes.concat(m.regularMarketPrice) };
}

function num_(v) { return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** 지표 이름 → 현재값. 사이트 카드의 추세 배지(최근 20회차 평균 대비)에 쓴다. */
function marketMap_(market) {
  var o = {};
  ((market && market.rows) || []).forEach(function (r) {
    if (r.c && r.c[1] && r.c[1] !== '확인 불가') o[r.c[0]] = r.c[1];
  });
  return o;
}

/** 일정 한 줄 → 구글 캘린더 추가 링크. 시각이 없으면 하루 종일 일정. 연도는 브리핑 기준(12월→1월 넘어가면 다음 해). */
function gcal_(when, event, stamp) {
  var m = /(\d{1,2})\/(\d{1,2})/.exec(when || '');
  if (!m) return '';
  var y = +String(stamp).slice(0, 4), mo = +m[1], dd = +m[2];
  if (mo < +String(stamp).slice(5, 7) - 6) y++;
  var t = /(\d{1,2}):(\d{2})/.exec(String(when).slice(m.index + m[0].length));
  var start = new Date(Date.UTC(y, mo - 1, dd, t ? +t[1] : 0, t ? +t[2] : 0));
  var end = new Date(start.getTime() + (t ? 36e5 : 864e5));
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  var f = function (d) {
    var s = d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
    return t ? s + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00' : s;
  };
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(event) +
    '&dates=' + f(start) + '/' + f(end) + '&ctz=Asia/Seoul&details=' + encodeURIComponent('섬개미 증시 브리핑 ' + SITE + '/calendar.html');
}

/** 일정 시각 "10/15(목) 21:30" → 비교용 숫자 YYYYMMDDHHMM (KST). 시각이 없으면 그날 끝(23:59)으로 본다. 날짜가 없으면 0. */
function calKey_(when, stamp) {
  var m = /(\d{1,2})\/(\d{1,2})/.exec(when || '');
  if (!m) return 0;
  var y = +String(stamp).slice(0, 4), mo = +m[1];
  if (mo < +String(stamp).slice(5, 7) - 6) y++;
  var t = /(\d{1,2}):(\d{2})/.exec(String(when).slice(m.index + m[0].length));
  return ((y * 100 + mo) * 100 + +m[2]) * 10000 + (t ? +t[1] * 100 + +t[2] : 2359);
}

/** 이번 주 증시 일정 페이지. 최신 브리핑의 cal로 매 회차 다시 만든다. */
function calendarPage_(d) {
  var sm = /(\d{4})\/(\d{2})\/(\d{2})\D+(\d{2}):(\d{2})/.exec(d.stamp || ''), now = sm ? +(sm[1] + sm[2] + sm[3] + sm[4] + sm[5]) : 0;
  var rows = ((d.cal && d.cal.rows) || []).filter(function (r) { var k = calKey_(r.c[0], d.stamp); return !k || k >= now; }).map(function (r) {
    var c = r.c, u = gcal_(c[0], c[1], d.stamp);
    return '<li class="cal-item"><p class="cal-when"><b>' + esc_(c[0]) + '</b> <span class="cal-star">' + esc_(c[2]) + '</span>' +
      (u ? ' <a class="cal-add" href="' + esc_(u) + '" target="_blank" rel="noopener">캘린더에 추가</a>' : '') + '</p>' +
      '<p class="cal-ev">' + esc_(c[1]) + '</p>' + (c[3] ? '<p class="cal-imp">' + esc_(c[3]) + '</p>' : '') + '</li>';
  }).join('');
  return simplePage_('이번 주 증시 일정', '/calendar.html',
    '<h1>이번 주 증시 일정</h1><p>' + esc_(d.short) + ' 브리핑 기준 향후 7일 국내외 주요 일정입니다. 캘린더에 추가를 누르면 내 구글 캘린더에 일정이 들어갑니다.</p>' +
    (rows ? '<ul class="cal-list">' + rows + '</ul>'
          : '<p>등록된 일정이 없습니다.</p>') +
    (d.calNote ? '<p class="pre-m">' + esc_(d.calNote) + '</p>' : '') +
    '<p>일정의 의미와 시장 해석은 <a href="/">최신 브리핑</a>에서 볼 수 있습니다.</p>');
}

function clean_(v) {
  if (typeof v === 'string') return v.replace(/['‘’“”]/g, '').replace(/[\r\n]+/g, ' ');
  if (Array.isArray(v)) return v.map(clean_);
  if (v && typeof v === 'object') { var o = {}; for (var k in v) o[k] = clean_(v[k]); return o; }
  return v;
}

function slugOf_(stamp) {
  var m = String(stamp).match(/(\d{4})\/(\d{2})\/(\d{2})[^0-9]*(\d{2}):(\d{2})/);
  if (!m) throw new Error('stamp 형식 오류: ' + stamp);
  var t = +m[4] * 60 + +m[5]; // ponytail: 회차 경계는 브리핑 시간대와 맞춤
  var slot = t < 12 * 60 ? '0800' : t < 16 * 60 ? '1400' : t < 20 * 60 ? '1630' : '2300';
  return m[1] + m[2] + m[3] + '-' + slot;
}

/** 회차별 검색어: 사람들이 그 시간대에 실제로 찾는 말을 제목 앞에 둔다. */
var SLOT_KW = { '0800': '뉴욕증시 마감·오늘 장 전망', '1400': '코스피 장중 시황', '1630': '코스피 마감 시황', '2300': '뉴욕증시 개장 시황' };

/** 페이지 제목·h1: "10/15 코스피 마감 시황 · {sub}" */
function headline_(d) {
  var slug = slugOf_(d.stamp);
  return slug.slice(4, 6) + '/' + slug.slice(6, 8) + ' ' + SLOT_KW[slug.slice(9)] + (d.sub ? ' · ' + d.sub : '');
}

/* ===================================== HTML ===================================== */

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** lead·verdict는 HTML 허용이지만 b/strong/em/br 외 태그는 제거. */
function safeHtml_(s) { return String(s == null ? '' : s).replace(/<(?!\/?(b|strong|em|br)\b)[^>]*>/gi, ''); }

function tbl_(spec) {
  if (!spec || !spec.rows || !spec.rows.length) return '';
  var h = '<div class="pre-t"><table><thead><tr>';
  (spec.head || []).forEach(function (x) { h += '<th>' + esc_(x) + '</th>'; });
  h += '</tr></thead><tbody>';
  spec.rows.forEach(function (r) {
    h += '<tr>';
    r.c.forEach(function (x) { h += '<td>' + esc_(x) + '</td>'; });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}

/** JS 없이도 읽히는 본문(크롤러·애드센스 심사용). app.js가 로드되면 이 자리를 풍부한 화면으로 교체한다. */
function prerender_(d) {
  var h = '<article class="pre"><header><h1>' + esc_(headline_(d)) + '</h1>';
  h += '<p class="pre-m">' + esc_(d.stamp) + ' 기준</p></header>';
  h += '<section><p>' + safeHtml_(d.lead) + '</p></section>';
  if (d.commentary && d.commentary.length) {
    h += '<section><h2>00 오늘의 해설</h2>';
    d.commentary.forEach(function (p) { h += '<p>' + safeHtml_(p) + '</p>'; });
    h += '</section>';
  }
  h += '<section><h2>01 주요 지표</h2>' + tbl_(d.market);
  if (d.stats && d.stats.length) {
    h += '<ul>';
    d.stats.forEach(function (s) { h += '<li><b>' + esc_(s[0]) + '</b> ' + esc_(s[1]) + '</li>'; });
    h += '</ul>';
  }
  if (d.correction) h += '<p class="pre-m">' + esc_(d.correction) + '</p>';
  h += '</section><section><h2>02 뉴스별 중요도·방향</h2>' + tbl_(d.news) + '</section>';
  h += '<section><h2>03 종합 판단</h2>';
  (d.verdict || []).forEach(function (p) { h += '<p>' + safeHtml_(p) + '</p>'; });
  h += '</section><section><h2>04 주요 일정</h2>' + tbl_(d.cal);
  if (d.calNote) h += '<p class="pre-m">' + esc_(d.calNote) + '</p>';
  h += '</section><section><h2>05 시나리오</h2>';
  (d.scen || []).forEach(function (s) {
    h += '<h3>' + esc_(s.t) + ' ' + esc_(s.stars) + '</h3><p>' + esc_(s.intro) + '</p>' + tbl_(s);
    if (s.watch) h += '<p class="pre-m">볼 것: ' + esc_(s.watch) + '</p>';
  });
  h += '</section><section><h2>출처</h2><ul>';
  (d.sources || []).forEach(function (s) {
    h += s[1] ? '<li><a href="' + esc_(s[1]) + '" rel="nofollow noopener" target="_blank">' + esc_(s[0]) + '</a></li>' : '<li>' + esc_(s[0]) + '</li>';
  });
  h += '</ul></section><p class="pre-m">' + esc_(d.disclaimer) + '</p></article>';
  return h;
}

var NAV_CSS = '.top-nav{max-width:860px;margin:0 auto;padding:0 16px;display:flex;flex-wrap:wrap;align-items:center;border-bottom:1px solid #2a2d31;font-size:14px}' +
  '.top-nav a{display:inline-flex;align-items:center;min-height:40px;padding:0 10px;color:#9aa0a6;text-decoration:none}.top-nav a:hover{color:#eceee9}' +
  '.top-nav .brand{color:#eceee9;font-weight:700;font-size:15px;padding-left:0;margin-right:auto}';

var NAV = '<nav class="top-nav" aria-label="주요 메뉴"><a class="brand" href="/">섬개미 증시 브리핑</a><a href="/">최신 브리핑</a><a href="/archive/">지난 브리핑</a><a href="/calendar.html">일정</a><a href="/glossary.html">용어</a><a href="/about.html">소개</a><a href="/contact.html">문의</a></nav>';

var HEAD_COMMON =
  '<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<meta name="naver-site-verification" content="6f1a5691b1db9606b974454d51daddd897c24c0b">' +
  '<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#15171a"><link rel="apple-touch-icon" href="/icon-512.png">' +
  '<link rel="icon" type="image/png" href="/favicon.png"><link rel="shortcut icon" href="/favicon.ico">' +
  '<link rel="alternate" type="application/rss+xml" title="섬개미 증시 브리핑" href="/feed.xml">' +
  '<meta property="og:type" content="website"><meta property="og:site_name" content="섬개미 증시 브리핑"><meta property="og:image" content="https://antbrief.vercel.app/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://antbrief.vercel.app/og.png">\n' +
  '<style>:root{color-scheme:dark}html,body{background:#15171a;color:#eceee9;margin:0;overflow-x:hidden;width:100%;font:15px/1.65 -apple-system,BlinkMacSystemFont,sans-serif}' +
  '.pre,.doc{max-width:860px;margin:0 auto;padding:16px}.pre h1,.doc h1{font-size:22px;margin:8px 0}.pre h2,.doc h2{font-size:17px;margin:28px 0 8px}.pre h3{font-size:15px;margin:18px 0 6px}' +
  '.pre-m{color:#9aa0a6;font-size:13px}.pre-sub{font-weight:600}.pre-t{overflow-x:auto}.pre table{width:100%;border-collapse:collapse;font-size:13px}' +
  '.pre th,.pre td{border-bottom:1px solid #2a2d31;padding:6px;text-align:left;vertical-align:top}.pre a,.doc a{color:#8ab4f8}' +
  '.tags{display:inline-flex;flex-wrap:wrap;gap:4px;margin:0 0 0 4px}p.tags{display:flex;align-items:center;gap:6px;margin:12px 0}.tag{display:inline-block;padding:1px 8px;border:1px solid #2a2d31;border-radius:999px;color:#a6aba3;font-size:12px;text-decoration:none}.tag:hover{color:#eceee9}' +
  '.cal-list{list-style:none;padding:0;margin:16px 0}.cal-item{padding:12px 0;border-bottom:1px solid #2a2d31}.cal-item p{margin:2px 0}.cal-star{color:#d9b44a;font-size:13px}' +
  '.cal-add{display:inline-block;margin-left:6px;padding:2px 10px;border:1px solid #2a2d31;border-radius:999px;font-size:12px;text-decoration:none}.cal-imp{color:#9aa0a6;font-size:13px}' +
  '.glossary dt{font-weight:700;margin-top:18px;scroll-margin-top:12px}.glossary dd{margin:4px 0 0;color:#c4c8c2}.glossary dt:target{color:#8ab4f8}' +
  '.site-foot{max-width:860px;margin:24px auto 40px;padding:16px;font-size:13px;color:#9aa0a6;text-align:center;border-top:1px solid #2a2d31}.site-foot a{color:#9aa0a6;margin:0 6px}' + NAV_CSS + '</style>\n';

var HEAD_ADS =
  '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4554703495384988"\n     crossorigin="anonymous"></script>\n';

var FOOT = '<nav class="site-foot"><a href="/">최신 브리핑</a><a href="/archive/">지난 브리핑</a><a href="/calendar.html">이번 주 일정</a><a href="/glossary.html">용어 풀이</a><a href="/about.html">소개</a><a href="/contact.html">문의</a><a href="/privacy.html">개인정보처리방침</a></nav>';

/** stamp "2026/10/15(목) 08:39 KST" → "2026-10-15T08:39:00+09:00" */
function isoOf_(stamp) {
  var m = String(stamp || '').match(/(\d{4})\/(\d{2})\/(\d{2})[^0-9]*(\d{2}):(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00+09:00' : undefined;
}

/** 검색엔진용 구조화 데이터: 각 회차를 뉴스 기사로 표시(제목·발행 시각). */
function jsonLd_(d, canonical) {
  var iso = isoOf_(d.stamp);
  var org = { '@type': 'Organization', name: '섬개미 증시 브리핑', url: SITE + '/' };
  var o = {
    '@context': 'https://schema.org', '@type': 'NewsArticle',
    headline: String(d.sub || '섬개미 증시 브리핑').slice(0, 110),
    datePublished: iso, dateModified: iso,
    mainEntityOfPage: canonical, url: canonical,
    image: [SITE + '/og.png'], inLanguage: 'ko',
    author: org, publisher: org
  };
  return '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
}

function buildPage_(d, canonical) {
  var title = headline_(d) + ' | 섬개미 증시 브리핑';
  var json = JSON.stringify(d).replace(/</g, '\\u003c'); // </script>·<!-- 원천 차단 (JSON으로는 동일한 값)
  return '<!doctype html><html lang="ko"><head>' + HEAD_COMMON + HEAD_ADS +
    '<meta name="description" content="' + esc_(d.sub + ' — 코스피·코스닥·환율·유가 등 국내외 증시 지표 정리. 투자 권유가 아닌 정보 제공 목적입니다.') + '">' +
    '<meta property="og:title" content="' + esc_(title) + '"><meta property="og:description" content="' + esc_(d.sub) + '"><meta property="og:url" content="' + canonical + '">' +
    '<link rel="canonical" href="' + canonical + '">' + jsonLd_(d, canonical) + '\n<link rel="stylesheet" href="/style.css">\n<title>' + esc_(title) + '</title></head><body>\n' + NAV + '\n' +
    '<div id="app">' + prerender_(d) + '</div>\n' + FOOT + '\n' +
    '<script type="application/json" id="briefing-data">' + json + '</script>\n<script src="/app.js"></script>\n' +
    '<script>(function(){try{window.renderBriefing(JSON.parse(document.getElementById("briefing-data").textContent))}catch(e){if(window.console)console.error(e)}})();</script>\n' +
    '</body></html>';
}

function simplePage_(title, path, body, desc) {
  return '<!doctype html><html lang="ko"><head>' + HEAD_COMMON +
    '<meta name="description" content="' + esc_(desc || title + ' - 섬개미 증시 브리핑') + '"><link rel="canonical" href="' + SITE + path + '">' +
    '<title>' + esc_(title) + ' | 섬개미 증시 브리핑</title></head><body>\n' + NAV + '\n<main class="doc">' + body + '</main>\n' + FOOT + '\n</body></html>';
}

/** 증시 용어: [id, 용어, 풀이]. 용어 풀이 페이지, 용어별 페이지(/glossary/{id}.html), 브리핑 본문 밑줄(app.js가 glossary.html을 읽음)에 쓰인다. */
var GLOSSARY = [
  ['kospi', '코스피', '유가증권시장에 상장된 모든 종목의 시가총액을 1980년 1월 4일을 100으로 놓고 나타낸 지수입니다. 삼성전자, SK하이닉스 같은 대형주 비중이 커서 이들 주가에 크게 움직입니다.'],
  ['kosdaq', '코스닥', '코스닥시장에 상장된 종목 전체의 지수입니다. 바이오, 2차전지, 소프트웨어 같은 기술·성장 중소형주 비중이 높아 코스피보다 변동이 큰 편입니다.'],
  ['sidecar', '사이드카', '선물 가격이 크게 움직일 때 프로그램 매매 주문을 5분간 멈추는 장치입니다. 코스피200 선물이 5%, 코스닥150 선물이 6% 이상 오르거나 내린 상태가 1분 이어지면 발동하며 하루 한 번만 걸립니다.'],
  ['circuit', '서킷브레이커', '지수가 전일보다 8%, 15%, 20% 이상 떨어진 상태가 1분 이어지면 거래를 멈추는 장치입니다. 1·2단계는 20분간 모든 매매를 중단하고, 3단계는 그날 장을 바로 끝냅니다.'],
  ['netbuy', '순매수', '산 금액에서 판 금액을 뺀 값입니다. 외국인, 기관, 개인 투자자별로 집계하며 플러스면 더 많이 샀고 마이너스(순매도)면 더 많이 팔았다는 뜻입니다.'],
  ['krwusd', '원/달러', '1달러를 사는 데 드는 원화 금액입니다. 오르면 원화 가치가 떨어진 것(원화 약세)이고, 외국인 자금이 빠져나갈 때 함께 오르는 경우가 많습니다.'],
  ['ust10', '10년물', '미국 정부가 발행한 10년 만기 국채의 금리입니다. 세계 장기 금리의 기준 역할을 하며, 오르면 미래 이익을 당겨 평가하는 성장주에 부담이 됩니다.'],
  ['brent', '브렌트유', '영국 북해에서 나는 원유로, 국제 유가의 대표 기준입니다. 중동·유럽 원유 거래 가격이 주로 이 가격을 따라갑니다.'],
  ['wti', 'WTI', '미국 서부 텍사스산 원유로, 미국 원유 가격의 기준입니다. 뉴욕상업거래소(NYMEX) 선물 가격으로 표시합니다.'],
  ['sp500', 'S&P 500', '미국 대형주 500개로 만든 지수로, 미국 증시 전체 흐름을 가장 넓게 보여줍니다.'],
  ['nasdaq', '나스닥', '나스닥거래소에 상장된 종목 전체로 만든 나스닥 종합지수입니다. 애플, 엔비디아, 마이크로소프트 같은 기술주 비중이 커서 국내 반도체주와 함께 움직이는 경우가 많습니다.'],
  ['dow', '다우', '미국 우량주 30개로 만든 다우존스 산업평균지수입니다. 주가가 높은 종목일수록 영향이 큰 방식으로 계산합니다.'],
  ['gold', '금 시세', '국제 금 가격으로, 1트로이온스(약 31.1g)당 달러로 표시합니다. 불안할 때 찾는 안전자산이라 위기 때나 달러 약세 때 오르는 경향이 있습니다.'],
  ['fomc', 'FOMC', '미국 연방준비제도(연준)의 통화정책 결정 회의입니다. 1년에 8번 열려 미국 기준금리를 정하고, 결과와 의장 기자회견이 세계 증시를 크게 흔듭니다.'],
  ['baserate', '기준금리', '중앙은행이 정하는 정책 금리입니다. 한국은 한국은행 금융통화위원회가, 미국은 FOMC가 정하며 시중 대출·예금 금리의 출발점이 됩니다.'],
  ['cpi', 'CPI', '소비자물가지수입니다. 가계가 사는 상품과 서비스 가격의 변화를 재며, 미국 CPI는 연준의 금리 결정에 큰 영향을 줍니다.'],
  ['pce', 'PCE', '미국 개인소비지출 물가지수입니다. 연준이 물가 목표(2%)를 판단할 때 가장 중요하게 보는 지표입니다.'],
  ['pmi', 'PMI', '구매관리자지수입니다. 기업 구매 담당자 설문으로 경기를 미리 보여주며, 50보다 높으면 경기 확장, 낮으면 위축으로 봅니다.'],
  ['lpr', 'LPR', '중국의 대출우대금리입니다. 매달 20일께 발표되며 사실상 중국의 기준금리 역할을 합니다.'],
  ['prelim', '잠정실적', '분기가 끝난 뒤 결산이 확정되기 전에 회사가 먼저 공개하는 매출·영업이익 추정치입니다. 삼성전자, LG전자 등이 발표합니다.'],
  ['short', '공매도', '갖고 있지 않은 주식을 빌려서 먼저 팔고 나중에 사서 갚는 거래입니다. 주가가 떨어지면 이익을 봅니다.'],
  ['expiry', '만기일', '선물·옵션 계약이 끝나는 날입니다. 국내 옵션은 매달 둘째 목요일이 만기이고, 3·6·9·12월에는 선물과 옵션이 함께 끝나 거래가 몰리고 변동성이 커지기 쉽습니다.'],
  ['vix', 'VIX', 'S&P 500 옵션 가격으로 계산한 미국 증시 변동성 지수입니다. 투자자의 불안이 커질수록 올라 공포지수라고도 부릅니다.'],
  ['dxy', '달러인덱스', '유로, 엔, 파운드 등 주요 6개 통화와 비교한 달러 가치입니다. 오르면 달러 강세로, 신흥국 증시와 원화에 부담이 됩니다.'],
  ['program', '프로그램 매매', '미리 정한 조건에 따라 여러 종목을 한꺼번에 사고파는 컴퓨터 매매입니다. 선물과 현물 가격 차이를 이용한 차익거래가 대표적입니다.']
];

/** 증시 용어 풀이 전체 목록. app.js가 이 페이지의 dl.glossary(dt id·dd)를 읽어 본문 용어에 풀이를 단다. */
function glossaryPage_() {
  return simplePage_('증시 용어 풀이', '/glossary.html',
    '<h1>증시 용어 풀이</h1><p>브리핑에 자주 나오는 증시 용어를 짧게 풀었습니다. 브리핑 본문에서 밑줄 친 용어를 누르면 같은 설명이 나옵니다.</p><dl class="glossary">' +
    GLOSSARY.map(function (g) { return '<dt id="' + g[0] + '"><a href="/glossary/' + g[0] + '.html">' + esc_(g[1]) + '</a></dt><dd>' + esc_(g[2]) + '</dd>'; }).join('') +
    '</dl>');
}

/** 용어별 페이지: 풀이 + 그 용어가 제목에 나온 최근 브리핑 + 다른 용어. "서킷브레이커 뜻" 같은 검색용. */
function termPage_(g, list) {
  var norm = function (x) { return String(x || '').replace(/[\s\/]/g, ''); }, w = norm(g[1]);
  // ponytail: 회차 제목(sub)·종목만 본다. 본문까지 보려면 회차마다 본문 키워드를 list.json에 저장해야 함
  var hits = list.filter(function (e) { return norm(e.sub).indexOf(w) >= 0 || (e.stocks || []).some(function (n) { return norm(n) === w; }); }).slice(0, 10);
  return simplePage_(g[1] + ' 뜻', '/glossary/' + g[0] + '.html',
    '<p><a href="/glossary.html">← 증시 용어 풀이</a></p><h1>' + esc_(g[1]) + ' 뜻</h1><p>' + esc_(g[2]) + '</p>' +
    (hits.length ? '<h2>이 용어가 나온 최근 브리핑</h2><ul>' + hits.map(function (e) {
      return '<li><a href="/archive/' + esc_(e.slug) + '.html">' + esc_(e.short) + '</a> ' + esc_(e.sub) + '</li>'; }).join('') + '</ul>' : '') +
    '<p>오늘 시장에서 어떻게 쓰였는지는 <a href="/">최신 브리핑</a>에서 볼 수 있습니다.</p>' +
    '<h2>다른 용어</h2><p class="tags">' + GLOSSARY.filter(function (x) { return x !== g; }).map(function (x) {
      return '<a class="tag" href="/glossary/' + x[0] + '.html">' + esc_(x[1]) + '</a>'; }).join('') + '</p>',
    g[1] + ' 뜻: ' + g[2]);
}

/** 용어별 페이지 전체(회차마다 관련 브리핑 목록이 바뀌므로 함께 다시 만든다). */
function termFiles_(list) {
  return GLOSSARY.map(function (g) { return { path: 'glossary/' + g[0] + '.html', text: termPage_(g, list) }; });
}

function aboutPage_() {
  return simplePage_('소개', '/about.html',
    '<h1>섬개미 증시 브리핑 소개</h1>' +
    '<p>섬개미 증시 브리핑은 코스피·코스닥, 원/달러 환율, 미국 3대 지수, 국제유가, 미국 국채금리 등 개인 투자자가 매일 확인하는 국내외 시장 지표와 주요 뉴스를 한 화면에 정리하는 무료 마켓 브리핑입니다.</p>' +
    '<h2>업데이트 주기</h2><p>하루 4회(KST 08시, 14시, 16시 30분, 23시) 갱신합니다. 각 지표에는 기준 시점을 함께 표기하며, 장중 수치와 마감 확정치를 구분합니다.</p>' +
    '<h2>작성 방식</h2><p>공개된 언론 보도와 시장 지표를 자동화 도구로 수집하고, AI 분석 도구를 활용해 뉴스별 중요도·방향·시나리오를 정리합니다. 모든 브리핑에는 원문 출처를 표기하며, 확인되지 않은 수치는 확인 불가로 표시합니다. 지난 브리핑은 <a href="/archive/">아카이브</a>에서 볼 수 있습니다.</p>' +
    '<h2>구독</h2><p>RSS 리더에서 <a href="/feed.xml">' + SITE + '/feed.xml</a> 주소로 새 브리핑을 받아볼 수 있습니다.</p>' +
    '<h2>유의 사항</h2><p>' + DISCLAIMER + ' 특정 종목의 매수·매도를 권유하지 않습니다. 수치는 출처 기준이며 지연되거나 실제와 다를 수 있습니다.</p>' +
    (CONTACT_EMAIL ? '<h2>문의</h2><p>' + esc_(CONTACT_EMAIL) + '</p>' : ''));
}

function privacyPage_() {
  return simplePage_('개인정보처리방침', '/privacy.html',
    '<h1>개인정보처리방침</h1><p>시행일: 2026년 10월 6일</p>' +
    '<h2>1. 수집하는 개인정보</h2><p>이 사이트는 회원가입, 로그인, 댓글 기능이 없으며 이용자에게 개인정보를 직접 입력받지 않습니다.</p>' +
    '<h2>2. 자동으로 수집되는 정보</h2><p>사이트 호스팅 업체(Vercel)는 서비스 운영과 보안을 위해 접속 IP, 브라우저 정보, 접속 시각 등의 접속 기록을 처리할 수 있습니다.</p>' +
    '<h2>3. 쿠키와 광고</h2><p>이 사이트는 Google 애드센스 광고를 게재합니다. Google을 포함한 제3자 공급업체는 쿠키를 사용하여 이용자의 이 사이트 및 다른 사이트 방문 기록을 바탕으로 광고를 게재합니다. Google은 광고 쿠키를 사용하여 이용자의 방문 기록에 기반한 광고를 게재할 수 있습니다.</p>' +
    '<p>이용자는 <a href="https://adssettings.google.com/" rel="nofollow noopener" target="_blank">Google 광고 설정</a>에서 맞춤 광고를 사용 중지할 수 있으며, <a href="https://www.aboutads.info/" rel="nofollow noopener" target="_blank">www.aboutads.info</a>에서 제3자 공급업체의 맞춤 광고 쿠키를 사용 중지할 수 있습니다. 브라우저 설정에서 쿠키 저장을 거부할 수도 있습니다.</p>' +
    '<h2>4. 개인정보의 제3자 제공</h2><p>이 사이트는 이용자의 개인정보를 제3자에게 판매하거나 제공하지 않습니다.</p>' +
    '<h2>5. 방침 변경</h2><p>이 방침이 바뀌면 이 페이지에 시행일과 함께 공지합니다.</p>' +
    (CONTACT_EMAIL ? '<h2>6. 문의</h2><p>' + esc_(CONTACT_EMAIL) + '</p>' : ''));
}

function tag_(n) { return '<a class="tag" href="/archive/?q=' + encodeURIComponent(n) + '">' + esc_(n) + '</a>'; }

function archiveIndex_(list) {
  var body = '<h1>지난 브리핑</h1><p>회차별 브리핑 기록입니다. 최신 브리핑은 <a href="/">첫 화면</a>에서 볼 수 있습니다.</p>';
  if (!list.length) body += '<p>아직 기록이 없습니다.</p>';
  else {
    var freq = {};
    list.forEach(function (e) { (e.stocks || []).forEach(function (n) { freq[n] = (freq[n] || 0) + 1; }); });
    var top = Object.keys(freq).sort(function (x, y) { return freq[y] - freq[x]; }).slice(0, 20);
    if (top.length) body += '<p class="tags"><b>자주 나온 종목</b> ' + top.map(tag_).join('') + '</p>';
    body += '<p><input type="search" id="archiveQ" placeholder="날짜(10/14)나 키워드로 찾기" aria-label="지난 브리핑 검색" style="width:100%;box-sizing:border-box;min-height:44px;padding:8px 12px;border:1px solid #2a2d31;border-radius:8px;background:#1d2024;color:inherit;font:inherit"> <span id="archiveCount" class="pre-m"></span></p><ul>';
    list.forEach(function (e) {
      body += '<li><a href="/archive/' + esc_(e.slug) + '.html">' + esc_(e.short) + '</a> ' + esc_(e.sub) +
        ((e.stocks || []).length ? ' <span class="tags">' + e.stocks.map(tag_).join('') + '</span>' : '') + '</li>';
    });
    body += '</ul><script src="/archive.js"></script>';
  }
  return simplePage_('지난 브리핑', '/archive/', body);
}

function sitemap_(list) {
  var urls = ['/', '/about.html', '/privacy.html', '/archive/', '/contact.html', '/calendar.html', '/glossary.html'].concat(GLOSSARY.map(function (g) { return '/glossary/' + g[0] + '.html'; })).concat(list.map(function (e) { return '/archive/' + e.slug + '.html'; }));
  var day = function (slug) { return slug.slice(0, 4) + '-' + slug.slice(4, 6) + '-' + slug.slice(6, 8); };
  var mod = { '/': list[0] && day(list[0].slug), '/archive/': list[0] && day(list[0].slug), '/calendar.html': list[0] && day(list[0].slug) };
  list.forEach(function (e) { mod['/archive/' + e.slug + '.html'] = day(e.slug); });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map(function (u) { return '<url><loc>' + SITE + u + '</loc>' + (mod[u] ? '<lastmod>' + mod[u] + '</lastmod>' : '') + '</url>'; }).join('') + '</urlset>\n';
}

/** RSS 2.0 피드: 최근 FEED_MAX개 회차. 발행 시각은 slug의 날짜 + short의 시:분(KST). */
function feedXml_(list) {
  var items = list.slice(0, FEED_MAX).map(function (e) {
    var u = SITE + '/archive/' + e.slug + '.html';
    var d = /^(\d{4})(\d{2})(\d{2})/.exec(e.slug), t = /(\d{2}):(\d{2})/.exec(e.short || '');
    var pub = d ? new Date(Date.UTC(+d[1], d[2] - 1, +d[3], (t ? +t[1] : 9) - 9, t ? +t[2] : 0)).toUTCString() : '';
    return '<item><title>' + esc_(e.short + ' · ' + e.sub) + '</title><link>' + u + '</link><guid isPermaLink="true">' + u + '</guid>' +
      (pub ? '<pubDate>' + pub + '</pubDate>' : '') + '<description>' + esc_(e.sub) + '</description></item>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>섬개미 증시 브리핑</title>' +
    '<link>' + SITE + '/</link><description>코스피·코스닥·환율·유가 등 하루 4회 증시 브리핑. 투자 권유가 아닌 정보 제공 목적입니다.</description>' +
    '<language>ko</language>' + items + '</channel></rss>\n';
}

/* ===================================== 큰 흐름(상승장·하락장) ===================================== */

// 지수 일봉 종가(Yahoo Finance)로 국면을 정해 regime.json에 넣는다. 시세 숫자는 넣지 않고 판정 결과만 넣음.
// 셋째 값은 국면 기준(%). 20년 백테스트(EWY·SPY 일봉)에서 변동이 큰 한국은 15%, 미국은 20%가 상승장·하락장을 가장 잘 갈랐음.
var REGIME_INDEX = [['코스피', '^KS11', 15], ['코스닥', '^KQ11', 15], ['S&P 500', '^GSPC', 20], ['나스닥', '^IXIC', 20]];

/** 편집기 확인용: 실행 로그에 지수별 판정이 찍히면 정상. (이름이 _로 끝나는 함수는 실행 목록에 안 보여서 따로 둠) */
function testRegime() {
  var f = regimeFiles_();
  Logger.log(f.length ? JSON.parse(f[0].text).idx.map(function (g) { return g.name + ': ' + (g.state === 'bull' ? '상승장' : '하락장') + ' (' + g.since + '부터)'; }).join('\n') : '받아오기 실패: 위 로그 확인');
}

/** 브리핑 배포 때 같이 올릴 regime.json. 받아오기에 실패하면 빈 배열(직전 파일 유지). */
function regimeFiles_() {
  try {
    var out = REGIME_INDEX.map(function (x) {
      var r = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(x[1]) + '?range=5y&interval=1d',
        { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.getResponseCode() !== 200) throw new Error(x[1] + ' ' + r.getResponseCode());
      var res = JSON.parse(r.getContentText()).chart.result[0], cl = res.indicators.quote[0].close, dates = [], closes = [];
      res.timestamp.forEach(function (t, i) {
        if (cl[i] == null) return;
        dates.push(Utilities.formatDate(new Date(t * 1000), res.meta.exchangeTimezoneName || TZ, 'yyyy-MM-dd'));
        closes.push(cl[i]);
      });
      var g = regimeOf_(dates, closes, 50, 200, x[2]);
      g.name = x[0];
      return g;
    });
    return [{ path: 'regime.json', text: JSON.stringify({ updated: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), idx: out }) }];
  } catch (e) {
    Logger.log('regime 건너뜀: ' + e);
    return [];
  }
}

/**
 * 국면: 고점 대비 cut% 넘게 내리면 하락장, 그 뒤 저점 대비 cut% 넘게 오르면 상승장(널리 쓰는 기준은 20%).
 * 전환 조짐 3가지: 종가와 slow일선, fast일선과 slow일선(골든·데드크로스), 고점·저점에서 10% 이상 움직임.
 * 하락장에서 앞의 둘 이상이 상승 쪽이면 "상승 전환 조짐", 상승장에서 둘 이상이 하락 쪽이면 "하락 전환 조짐".
 */
function regimeOf_(dates, closes, fast, slow, cut) {
  var dn = 1 - cut / 100, up = 1 + cut / 100;
  // 구간 시작일은 기준을 넘은 날이 아니라 그 앞의 고점(하락장)·저점(상승장) 날짜.
  var state = null, peak = closes[0], trough = closes[0], pd = dates[0], td = dates[0], bands = [];
  for (var i = 0; i < closes.length; i++) {
    var c = closes[i];
    if (c > peak) { peak = c; pd = dates[i]; }
    if (c < trough) { trough = c; td = dates[i]; }
    if (state !== 'bear' && c <= peak * dn) { state = 'bear'; bands.push([pd, state]); trough = c; td = dates[i]; }
    else if (state !== 'bull' && c >= trough * up) { state = 'bull'; bands.push([td, state]); peak = c; pd = dates[i]; }
  }
  function ma(n) { var s = 0; for (var k = closes.length - n; k < closes.length; k++) s += closes[k]; return s / n; }
  var last = closes[closes.length - 1], mf = ma(fast), ms = ma(slow), r1 = function (v) { return Math.round(v * 10) / 10; };
  var fromPeak = (last / peak - 1) * 100, fromTrough = (last / trough - 1) * 100, bull = state === 'bull';
  var signs = [
    { t: '종가가 ' + slow + '일선 ' + (last > ms ? '위' : '아래'), on: bull ? last < ms : last > ms },
    { t: fast + '일선이 ' + slow + '일선 ' + (mf > ms ? '위' : '아래'), on: bull ? mf < ms : mf > ms },
    bull ? { t: '고점 대비 ' + r1(fromPeak) + '%', on: fromPeak <= -10 } : { t: '저점 대비 +' + r1(fromTrough) + '%', on: fromTrough >= 10 }
  ];
  var n = signs.filter(function (s) { return s.on; }).length;
  return {
    asof: dates[dates.length - 1], state: state, since: bands.length ? bands[bands.length - 1][0] : null, signs: signs,
    turn: n >= 2 ? (bull ? 'down' : 'up') : null, bands: bands, cut: cut
  };
}

/* ===================================== GitHub ===================================== */

function gh_(method, path, body) {
  var p = PropertiesService.getScriptProperties();
  var opt = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + p.getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' }
  };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + repoPath_() + path, opt);
  var txt = r.getContentText();
  var json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* 본문이 JSON이 아님 */ }
  return { code: r.getResponseCode(), json: json, text: txt };
}

/** 토큰이 볼 수 있는 저장소 중 이름이 REPO_NAME인 것(대소문자 무시)을 찾아 owner/name을 저장해 둔다. */
function repoPath_() {
  var p = PropertiesService.getScriptProperties();
  var cached = p.getProperty('GITHUB_REPO');
  if (cached) return cached;
  var h = { headers: { Authorization: 'Bearer ' + p.getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' }, muteHttpExceptions: true };
  var r = UrlFetchApp.fetch('https://api.github.com/user/repos?per_page=100', h);
  if (r.getResponseCode() !== 200) throw new Error('토큰이 유효하지 않습니다 (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 200));
  var repos = JSON.parse(r.getContentText());
  var hit = repos.filter(function (x) { return x.name.toLowerCase() === REPO_NAME.toLowerCase(); })[0];
  if (!hit) throw new Error('토큰으로 ' + REPO_NAME + ' 저장소에 접근할 수 없습니다. 토큰이 볼 수 있는 저장소: [' +
    repos.map(function (x) { return x.full_name; }).join(', ') + '] → GitHub 토큰 설정의 Repository access에 이 저장소를 추가하세요.');
  p.setProperty('GITHUB_REPO', hit.full_name);
  return hit.full_name;
}

function ok_(r, what) {
  if (r.code >= 300) throw new Error(what + ' 실패 (' + r.code + '): ' + String(r.text).slice(0, 300));
  return r.json;
}

function b64_(text) { return Utilities.base64Encode(text, Utilities.Charset.UTF_8); }

function readRepoJson_(path) {
  var r = gh_('get', '/contents/' + path);
  if (r.code === 404) return null;
  var c = ok_(r, path + ' 읽기').content;
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(c.replace(/\s/g, ''))).getDataAsString('UTF-8'));
}

/** 여러 파일을 커밋 1개로 올린다(= Vercel 배포 1회). files: [{path, text} | {path, b64}] */
function commitFiles_(files, message) {
  var repo = ok_(gh_('get', ''), '저장소 접근');
  var branch = repo.default_branch || 'main';
  var ref = gh_('get', '/git/ref/heads/' + branch);
  if (ref.code !== 200) { // 빈 저장소: 첫 파일로 브랜치를 만든 뒤 나머지를 한 커밋으로
    var first = files[0];
    ok_(gh_('put', '/contents/' + first.path, { message: message, content: first.b64 || b64_(first.text), branch: branch }), '첫 커밋');
    files = files.slice(1);
    if (!files.length) return;
    ref = gh_('get', '/git/ref/heads/' + branch);
  }
  var head = ok_(ref, '브랜치 조회').object.sha;
  var baseTree = ok_(gh_('get', '/git/commits/' + head), '커밋 조회').tree.sha;
  var tree = files.map(function (f) {
    var blob = ok_(gh_('post', '/git/blobs', { content: f.b64 || b64_(f.text), encoding: 'base64' }), 'blob ' + f.path);
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  });
  var t = ok_(gh_('post', '/git/trees', { base_tree: baseTree, tree: tree }), 'tree 생성');
  var c = ok_(gh_('post', '/git/commits', { message: message, tree: t.sha, parents: [head] }), '커밋 생성');
  ok_(gh_('patch', '/git/refs/heads/' + branch, { sha: c.sha }), '브랜치 갱신');
}

/* ===================================== 일회성 재생성 ===================================== */

function readRepoText_(path) {
  var r = gh_('get', '/contents/' + path);
  if (r.code === 404) return null;
  return Utilities.newBlob(Utilities.base64Decode(ok_(r, path + ' 읽기').content.replace(/\s/g, ''))).getDataAsString('UTF-8');
}

/** 한 번만 실행: 저장소의 모든 브리핑 페이지를 최신 형식(출처 정리·상단 메뉴·구조화 데이터·RSS 링크, 작업 메모 제거)으로 다시 만들어 1커밋으로 올린다. */
function rebuildAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('publish가 실행 중입니다. 잠시 후 다시 실행하세요.');
  try {
    var list = readRepoJson_('archive/list.json') || [], files = [];
    function redo(path, canonical) {
      var txt = readRepoText_(path);
      var m = txt && txt.match(/<script type="application\/json" id="briefing-data">([\s\S]*?)<\/script>/);
      if (!m) { Logger.log('건너뜀(데이터 없음): ' + path); return; }
      var d = JSON.parse(m[1]);
      d.sources = cleanSources_(d.sources);
      d.correction = cleanCorrection_(d.correction);
      files.push({ path: path, text: buildPage_(d, canonical) });
      Logger.log('재생성: ' + path + ' (' + files.length + ')');
    }
    redo('index.html', SITE + '/');
    list.forEach(function (e) {
      redo('archive/' + e.slug + '.html', SITE + '/archive/' + e.slug + '.html');
    });
    files.push({ path: 'about.html', text: aboutPage_() });
    files.push({ path: 'privacy.html', text: privacyPage_() });
    files.push({ path: 'glossary.html', text: glossaryPage_() });
    files = files.concat(termFiles_(list));
    files.push({ path: 'archive/index.html', text: archiveIndex_(list) });
    files.push({ path: 'sitemap.xml', text: sitemap_(list) });
    files.push({ path: 'feed.xml', text: feedXml_(list) });
    var c = readRepoText_('contact.html');
    if (c && c.indexOf('class="top-nav"') < 0) {
      files.push({ path: 'contact.html', text: c
        .replace(/<body[^>]*>/i, function (m) { return m + '\n' + NAV; })
        .replace('</head>', function () { return '<style>' + NAV_CSS + '</style></head>'; }) });
    } else if (c) {
      files.push({ path: 'contact.html', text: c.replace(/<nav class="top-nav"[\s\S]*?<\/nav>/, function () { return NAV; }) });
    }
    commitFiles_(files, 'rebuild: 용어별 페이지');
    Logger.log('rebuildAll 완료: ' + files.length + '개 파일');
  } finally {
    lock.releaseLock();
  }
}
