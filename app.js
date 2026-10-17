var AD_CLIENT = "ca-pub-4554703495384988";
var AD_SLOTS = { top: "", bottom: "" };

function adSlot(pos){
  if (!AD_CLIENT || !AD_SLOTS[pos]) return "";
  return '<div class="ad-slot"><ins class="adsbygoogle" style="display:block" data-ad-client="'
    + AD_CLIENT + '" data-ad-slot="' + AD_SLOTS[pos] + '" data-ad-format="auto" data-full-width-responsive="true"></ins>'
    + '<script>(adsbygoogle = window.adsbygoogle || []).push({});<' + '/script></div>';
}

(function(){
  "use strict";

  var app = document.getElementById("app");
  var SLUG = (location.pathname.match(/^\/archive\/(\d{8}-\d{4})/) || [])[1] || null;
  var permalink = null;

  function esc(x){ return String(x == null ? "" : x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function statebox(title, body){
    app.innerHTML = '<div class="statebox"><h2>' + title + '</h2>' + body + '</div>';
  }

  var DIRCLS = { "🔻":"t-down", "🔺":"t-up", "➖":"t-neutral", "⚡":"t-volatile" };
  var ROWCLS = { down:"row-down", up:"row-up", neutral:"row-neutral", vol:"row-volatile" };

  function autoCls(html){
    var s = String(html);
    if (s.indexOf("★") === 0) return "stars";
    for (var k in DIRCLS){ if (s.indexOf(k) === 0) return DIRCLS[k]; }
    return "";
  }

  function table(spec, cls){
    if (!spec || !spec.rows || !spec.rows.length) return "";
    var head = spec.head || [];
    var colcls = spec.colcls || [];
    var out = '<div class="twrap"><table' + (cls ? ' class="' + cls + '"' : '') + '><thead><tr>';
    for (var i = 0; i < head.length; i++) out += "<th>" + head[i] + "</th>";
    out += "</tr></thead><tbody>";

    for (var r = 0; r < spec.rows.length; r++){
      var row = spec.rows[r];
      var cells = row.c || [];
      out += "<tr" + (ROWCLS[row.d] ? ' class="' + ROWCLS[row.d] + '"' : "") + ">";
      for (var c = 0; c < cells.length; c++){
        var cell = cells[c], html, extra = "";
        if (Object.prototype.toString.call(cell) === "[object Array]"){
          html = cell[0]; extra = cell[1] || "";
        } else {
          html = cell == null ? "" : cell;
        }
        var cls = [];
        if (colcls[c]) cls.push(colcls[c]);
        if (extra) cls.push(extra);
        else { var a = autoCls(html); if (a) cls.push(a); }
        out += "<td" + (cls.length ? ' class="' + cls.join(" ") + '"' : "")
             + ' data-label="' + (head[c] || "") + '">' + html + "</td>";
      }
      out += "</tr>";
    }
    return out + "</tbody></table></div>";
  }

  function section(num, title, inner){
    return '<section class="block"><div class="sechead"><span class="secnum">' + num
         + '</span><h2>' + title + "</h2></div>" + inner + "</section>";
  }

  var LEGEND =
    '<div class="legend"><p class="legend-title">읽는 법</p>'
    + '<div class="legend-row">'
    + '<span class="legend-item"><span class="star">★★★★★</span> <b>=</b> 지수 방향을 바꿈</span>'
    + '<span class="legend-item"><span class="star">★★★☆☆</span> <b>=</b> 업종별 영향</span>'
    + '<span class="legend-item"><span class="star">★☆☆☆☆</span> <b>=</b> 참고용</span></div>'
    + '<div class="legend-row">'
    + '<span class="legend-item"><span class="dir">🔻</span> <b style="color:var(--down)">하락압력</b></span>'
    + '<span class="legend-item"><span class="dir">🔺</span> <b style="color:var(--up)">상승압력</b></span>'
    + '<span class="legend-item"><span class="dir">➖</span> <b style="color:var(--neutral-dir)">중립</b></span>'
    + '<span class="legend-item"><span class="dir">⚡</span> <b style="color:var(--volatile)">양방향(변동성 확대)</b></span>'
    + "</div></div>";

  function ageHours(stamp){
    var m = /(\d{4})\/(\d{2})\/(\d{2})\D+(\d{2}):(\d{2})/.exec(stamp || "");
    if (!m) return 0;
    return (Date.now() - Date.UTC(+m[1], m[2] - 1, +m[3], m[4] - 9, +m[5])) / 36e5;
  }

  function snapshot(m){
    if (!m || !m.rows) return "";
    var out = "";
    for (var i = 0; i < m.rows.length; i++){
      var c = m.rows[i].c || [];
      if (!c[1] || c[1] === "확인 불가") continue;
      out += '<div class="snap ' + (ROWCLS[m.rows[i].d] || "") + '" data-k="' + esc(c[0]) + '"><span class="snap-k">' + c[0]
           + '</span><span class="snap-v">' + c[1] + '</span><span class="snap-d">' + (c[2] || "") + "</span></div>";
    }
    return out ? '<div class="snapshot">' + out + "</div>" : "";
  }

  var STOCKDIR = { up: ["🔺", "상승압력"], down: ["🔻", "하락압력"], neutral: ["➖", "중립"], vol: ["⚡", "양방향"] };
  var DIRKEY = { "🔺": "up", "🔻": "down", "➖": "neutral", "⚡": "vol" };

  // 종목별 뉴스 영향 방향. Gemini가 준 stockDir이 우선이고, 없으면 그 종목이 나온 첫 뉴스의 방향.
  function stockDir(name, d){
    if (d.stockDir && STOCKDIR[d.stockDir[name]]) return d.stockDir[name];
    var rows = (d.news && d.news.rows) || [];
    for (var i = 0; i < rows.length; i++){
      var c = rows[i].c || [];
      if (String(c[0]).indexOf(name) !== -1 || String(c[4]).indexOf(name) !== -1) return DIRKEY[String(c[2]).slice(0, 2)] || null;
    }
    return null;
  }

  function stocks(d){
    var list = d.stocks;
    if (!list || !list.length) return "";
    var out = '<p class="stocks"><span>관련 종목</span>';
    for (var i = 0; i < list.length; i++){
      var k = stockDir(list[i], d), m = STOCKDIR[k];
      out += '<a class="tag' + (m ? " tag-" + k : "") + '" href="/archive/?q=' + encodeURIComponent(list[i]) + '"'
           + (m ? ' title="이번 회차 뉴스 기준 ' + m[1] + '"' : "") + ">" + (m ? m[0] + " " : "") + esc(list[i]) + "</a>";
    }
    return out + '<span class="stocks-note">방향은 이번 회차 뉴스의 영향이며 매매 의견이 아닙니다</span></p>';
  }

  function render(d){
    var age = SLUG ? 0 : ageHours(d.stamp);
    var meta = SLUG
      ? '<div class="updatemeta"><span class="um-item"><b>지난 브리핑</b><span class="val sched">'
        + (d.short || d.stamp || "") + '</span></span><a class="um-link" href="/">최신 브리핑 보기 →</a></div>'
      : '<div class="updatemeta">'
        + '<span class="um-item"><b>마지막 갱신</b><span class="val done"><span class="livedot"></span>'
        + (d.short || d.stamp || "") + "</span></span>"
        + '<span class="um-item"><b>다음 갱신</b><span class="val" id="nextUpdate">계산 중…</span></span>'
        + '<span class="um-item"><b>갱신 주기</b><span class="val sched">매일 08·14·16:30·23시 KST</span></span>'
        + "</div>"
        + (age > 10 ? '<p class="stale">갱신이 늦어지고 있습니다. 아래 내용은 약 ' + Math.floor(age) + "시간 전 기준입니다.</p>" : "");

    // 검색 제목(Code.gs headline_)에서 사이트 이름을 뗀 것. 예전 형식 페이지는 sub로 대신함.
    var tparts = document.title.split(" | ");
    var headline = tparts.length > 1 ? tparts[0] : (d.sub || "섬개미 증시 브리핑");
    var h = '<div class="wrap"><header class="masthead">'
      + '<span class="kicker">Market Briefing · KOSPI / KOSDAQ</span>'
      + '<h1 class="title">' + headline + "</h1>"
      + '<div class="timestamp">' + (d.stamp || "") + "</div>"
      + meta
      + (SLUG ? "" : '<div class="livetape"><p class="livetape-k">지금 시세 <span>미국 지수·원자재는 최대 15분 지연, 코스피·코스닥은 아래 브리핑 숫자 참고 · <a href="https://kr.tradingview.com/" rel="noopener nofollow" target="_blank">TradingView 제공</a></span></p><div id="liveTape"></div></div>'
        + '<p class="snap-note">브리핑 시점 기준</p>')
      + snapshot(d.market)
      + stocks(d)
      + (SLUG ? "" : '<div id="favBox"></div>')
      + (SLUG ? "" : '<div id="regime"></div>')
      + (d.lead ? '<p class="lead">' + d.lead + "</p>" : "")
      + "</header>" + LEGEND;

    if (d.commentary && d.commentary.length){
      var s0 = '<div class="commentary">';
      for (var c = 0; c < d.commentary.length; c++) s0 += "<p>" + d.commentary[c] + "</p>";
      s0 += "</div>";
      h += section("00", "오늘의 해설", s0);
    }

    var s1 = table(d.market, "mkt");
    if (d.stats && d.stats.length){
      s1 += '<div class="statstrip">';
      for (var i = 0; i < d.stats.length; i++){
        s1 += '<p class="statline"><b>' + d.stats[i][0] + "</b> " + d.stats[i][1] + "</p>";
      }
      s1 += "</div>";
    }
    if (d.correction && !/특이사항\s*없/.test(d.correction)) s1 += '<div class="correction"><b>특이사항</b> ' + d.correction + "</div>";
    h += section("01", "시장 현황", s1);

    h += adSlot("top");

    var s2 = table(d.news);
    if (d.verdict && d.verdict.length){
      s2 += '<div class="verdict"><div class="verdict-label">⬇ 종합 판단</div>';
      for (var v = 0; v < d.verdict.length; v++) s2 += "<p>" + d.verdict[v] + "</p>";
      s2 += "</div>";
    }
    h += section("02", "뉴스별 중요도 · 방향", s2);

    var s3 = table(d.cal) + (d.calNote ? '<p class="note-line">' + d.calNote + "</p>" : "")
      + (SLUG ? "" : '<p class="note-line"><a href="/calendar.html">이번 주 일정 한눈에 보기 · 구글 캘린더에 추가 →</a></p>');
    h += section("03", "향후 7일 일정", s3);

    var s4 = "";
    var rv = d.review;
    if (rv && rv.text){
      s4 += '<div class="review"><p class="review-label">직전 회차 복기' + (rv.prev ? " · " + esc(rv.prev) : "")
         + (rv.pick ? ' <span class="review-pick">' + esc(rv.pick) + "</span>" : "") + "</p><p>" + esc(rv.text) + "</p></div>";
    }
    if (d.scen){
      for (var k = 0; k < d.scen.length; k++){
        var sc = d.scen[k];
        s4 += '<div class="scenario"><div class="scenario-head"><h3>' + sc.t + "</h3>"
           + '<span class="stars">중요도 ' + (sc.stars || "") + "</span></div>"
           + (sc.intro ? '<p class="intro">' + sc.intro + "</p>" : "")
           + table({ head: sc.head, colcls: sc.colcls, rows: sc.rows }, "narrow")
           + (sc.watch ? '<p class="watch"><b>볼 것</b> ' + sc.watch + "</p>" : "")
           + "</div>";
      }
    }
    h += section("04", "시나리오", s4);
    h += '<nav class="issuenav" aria-label="브리핑 이동"><button type="button" class="sharebtn" id="shareBtn">공유하기</button>'
       + '<span class="in-links" id="issueLinks"><a href="/archive/">지난 브리핑 전체</a></span></nav>';

    h += adSlot("bottom");

    h += "<footer>";
    if (d.disclaimer) h += '<p class="disclaimer">' + d.disclaimer + "</p>";
    if (d.sources && d.sources.length){
      h += '<p class="sources-label">출처</p><p class="sources">';
      for (var s = 0; s < d.sources.length; s++){
        if (s) h += '<span class="sep">·</span>';
        var lb = esc(d.sources[s][0]), u = d.sources[s][1];
        h += u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + lb + "</a>"
               : "<span>" + lb + "</span>";
      }
      h += "</p>";
    }
    h += "</footer></div>";

    app.innerHTML = h;
    if (!SLUG){ liveTape(); regime(); }
    startClock();
    glossary();
  }

  // TradingView 공식 티커 위젯. KRX 지수는 위젯에서 막혀 있어(잘못된 심볼) 미국·환율·원자재만 넣음.
  // innerHTML로 넣은 script는 실행되지 않으므로 직접 만들어 붙임.
  function liveTape(){
    var el = document.getElementById("liveTape");
    if (!el) return;
    var s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    s.async = true;
    s.text = JSON.stringify({
      symbols: [
        { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
        { proName: "FOREXCOM:NSXUSD", title: "나스닥 100" },
        { proName: "FOREXCOM:DJI", title: "다우" },
        { proName: "FX_IDC:USDKRW", title: "달러/원" },
        { proName: "TVC:UKOIL", title: "브렌트유" },
        { proName: "TVC:USOIL", title: "WTI" },
        { proName: "TVC:GOLD", title: "금" }
      ],
      showSymbolLogo: false, isTransparent: true, displayMode: "adaptive", colorTheme: "dark", locale: "kr"
    });
    el.className = "tradingview-widget-container";
    el.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    el.appendChild(s);
  }

  var clockTimer = null;
  function startClock(){
    var SLOTS_MIN = [8*60, 14*60, 16*60+30, 23*60];
    function kstNow(){
      var parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Seoul", hour12: false, hour: "2-digit", minute: "2-digit"
      }).formatToParts(new Date());
      var o = {};
      parts.forEach(function(p){ o[p.type] = p.value; });
      var hh = parseInt(o.hour, 10); if (hh === 24) hh = 0;
      return hh * 60 + parseInt(o.minute, 10);
    }
    function pad(n){ return (n < 10 ? "0" : "") + n; }
    function fmt(min){ var h = Math.floor(min/60), m = min%60; return pad(h) + ":" + pad(m); }
    function tick(){
      var el = document.getElementById("nextUpdate");
      if (!el) return;
      try{
        var cur = kstNow(), next = null, tomorrow = false;
        for (var i = 0; i < SLOTS_MIN.length; i++){
          if (SLOTS_MIN[i] > cur){ next = SLOTS_MIN[i]; break; }
        }
        if (next === null){ next = SLOTS_MIN[0] + 1440; tomorrow = true; }
        var diff = next - cur, hh = Math.floor(diff / 60), mm = diff % 60;
        var rel = hh > 0 ? (hh + "시간 " + mm + "분 후") : (mm + "분 후");
        el.textContent = (tomorrow ? "내일 " : "") + fmt(next % 1440) + " KST · " + rel;
      }catch(e){
        el.textContent = "08·14·16:30·23시 KST";
      }
    }
    if (clockTimer) clearInterval(clockTimer);
    tick();
    clockTimer = setInterval(tick, 30000);
  }

  function link(it, label, list){
    var href = it === list[0] ? "/" : "/archive/" + encodeURIComponent(it.slug) + ".html";
    return '<a href="' + href + '" title="' + esc(it.sub) + '">' + label + " <span>" + esc(it.short) + "</span></a>";
  }

  function fillNav(){
    if (!window.fetch) return;
    fetch("/archive/list.json", { cache: "no-cache" }).then(function(r){ return r.json(); }).then(function(list){
      var el = document.getElementById("issueLinks");
      var i = 0;
      if (SLUG){ while (i < list.length && list[i].slug !== SLUG) i++; }
      if (!el || !list[i]) return;
      permalink = location.origin + "/archive/" + list[i].slug + ".html";
      el.innerHTML = (list[i + 1] ? link(list[i + 1], "← 이전", list) : "")
        + '<a href="/archive/">전체 목록</a>'
        + (i > 0 ? link(list[i - 1], "다음 →", list) : "");
      trend(list, i);
      if (!SLUG) favBox(list);
    }).catch(function(){});
  }

  function num(v){ var n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(n) ? n : null; }

  // 카드마다 최근 10회차 추이선과 직전 회차 대비. 값은 list.json의 m(회차별 현재값).
  function trend(list, i){
    var cards = app.querySelectorAll(".snap[data-k]");
    for (var c = 0; c < cards.length; c++){
      var k = cards[c].getAttribute("data-k"), ys = [];
      for (var j = Math.min(list.length - 1, i + 9); j >= i; j--){
        var y = num(list[j].m && list[j].m[k]);
        if (y !== null && y !== ys[ys.length - 1]) ys.push(y); // 장 마감 뒤 회차는 같은 값이라 한 점으로
      }
      if (ys.length < 2) continue;
      var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), span = hi - lo || 1, pts = [];
      for (var p = 0; p < ys.length; p++) pts.push((p * 100 / (ys.length - 1)).toFixed(1) + "," + (22 - (ys[p] - lo) * 20 / span).toFixed(1));
      cards[c].insertAdjacentHTML("beforeend",
        '<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts.join(" ") + '"/></svg>');
    }
    flow(list, i, cards);
  }

  // 큰 흐름: 지금 값이 최근 20회차(약 1주) 평균보다 1% 넘게 높으면 상승, 낮으면 하락. 금리는 0.05%p.
  function flow(list, i, cards){
    var shown = 0;
    for (var c = 0; c < cards.length; c++){
      var k = cards[c].getAttribute("data-k"), sum = 0, n = 0;
      var cur = num(list[i].m && list[i].m[k]);
      for (var j = i; j < list.length && j < i + 20; j++){
        var y = num(list[j].m && list[j].m[k]);
        if (y !== null){ sum += y; n++; }
      }
      if (cur === null || n < 8) continue;
      var avg = sum / n, rate = k.indexOf("10년물") !== -1;
      var gap = rate ? cur - avg : (cur - avg) / avg * 100, cut = rate ? 0.05 : 1;
      var f = gap > cut ? ["up", "▲ 상승 흐름"] : gap < -cut ? ["down", "▼ 하락 흐름"] : ["flat", "― 횡보"];
      var d = cards[c].querySelector(".snap-d");
      if (d) d.insertAdjacentHTML("afterend", '<span class="flow flow-' + f[0] + '">' + f[1] + "</span>");
      shown++;
    }
    var grid = app.querySelector(".snapshot");
    if (shown && grid) grid.insertAdjacentHTML("afterend", '<p class="flow-note">흐름은 최근 20회차(약 1주) 평균 대비이며, 앞으로의 방향이 아닙니다.</p>');
  }

  // 큰 흐름(상승장·하락장): Code.gs regimeFiles_가 지수 일봉으로 판정해 올린 regime.json. 파일이 없으면 아무것도 안 그림.
  function regime(){
    if (!window.fetch) return;
    fetch("/regime.json", { cache: "no-cache" }).then(function(r){ return r.ok ? r.json() : null; }).then(function(j){
      var el = document.getElementById("regime");
      if (!el || !j || !j.idx || !j.idx.length) return;
      var out = "";
      for (var a = 0; a < j.idx.length; a++){
        var g = j.idx[a], bull = g.state === "bull", b = g.bands || [];
        if (!g.state || !b.length) continue;
        var on = 0;
        for (var s = 0; s < g.signs.length; s++) if (g.signs[s].on) on++;
        var t0 = Date.parse(b[0][0]), t1 = Date.parse(g.asof), span = t1 - t0 || 1, bar = "", yrs = "";
        for (var k = 0; k < b.length; k++){
          var w = ((k + 1 < b.length ? Date.parse(b[k + 1][0]) : t1) - Date.parse(b[k][0])) / span * 100;
          bar += '<span class="rg-' + b[k][1] + '" style="width:' + w.toFixed(2) + '%" title="' + b[k][0] + "부터 " + (b[k][1] === "bull" ? "상승장" : "하락장") + '"></span>';
        }
        for (var y = new Date(t0).getFullYear() + 1; Date.parse(y + "-01-01") < t1; y++)
          yrs += '<span style="left:' + ((Date.parse(y + "-01-01") - t0) / span * 100).toFixed(2) + '%">' + y + "</span>";
        var signs = "";
        for (var s2 = 0; s2 < g.signs.length; s2++)
          signs += '<li class="' + (g.signs[s2].on ? "on" : "") + '">' + esc(g.signs[s2].t) + "</li>";
        out += '<div class="rg-card"><p class="rg-head"><b>' + esc(g.name) + '</b><span class="rg-state rg-' + g.state + '">' + (bull ? "상승장" : "하락장") + "</span>"
          + '<span class="rg-since">' + esc(g.since) + (bull ? " 저점부터" : " 고점부터") + "</span></p>"
          + '<p class="rg-turn' + (g.turn ? " rg-turn-" + g.turn : "") + '">'
          + (g.turn ? (g.turn === "up" ? "상승 전환 조짐" : "하락 전환 조짐") : "전환 조짐 약함") + " · " + (bull ? "하락" : "상승") + " 쪽 신호 " + on + "/" + g.signs.length + "</p>"
          + '<ul class="rg-signs">' + signs + "</ul>"
          + '<div class="rg-bar" aria-hidden="true">' + bar + '</div><div class="rg-years" aria-hidden="true">' + yrs + "</div></div>";
      }
      if (!out) return;
      el.innerHTML = '<div class="regime"><p class="rg-title">큰 흐름 · 상승장과 하락장</p><div class="rg-grid">' + out + "</div>"
        + '<p class="rg-note">고점에서 20% 넘게 내리면 하락장, 저점에서 20% 넘게 오르면 상승장으로 나눕니다(지수 종가, ' + esc(j.idx[0].asof) + " 기준). "
        + "전환 조짐은 200일선·50일선 위치와 고점·저점에서 10% 넘게 움직였는지 3가지 중 2가지 이상이 반대쪽을 가리킬 때입니다. 지난 흐름을 정리한 것이며 앞으로의 방향을 예측하거나 매매를 권하는 것이 아닙니다.</p></div>";
    }).catch(function(){});
  }

  function favs(){ try { return JSON.parse(localStorage.getItem("favStocks")) || []; } catch (e) { return []; } }

  // 관심 종목(지난 브리핑 목록에서 고정)이 나온 최근 브리핑 3개씩.
  function favBox(list){
    var el = document.getElementById("favBox"), f = favs(), out = "";
    if (!el || !f.length) return;
    for (var a = 0; a < f.length; a++){
      var hits = [];
      for (var j = 0; j < list.length && hits.length < 3; j++){
        if ((list[j].stocks || []).indexOf(f[a]) !== -1 || String(list[j].sub).indexOf(f[a]) !== -1) hits.push('<a href="' + (j ? "/archive/" + encodeURIComponent(list[j].slug) + ".html" : "/") + '">'
          + esc(String(list[j].short).replace(" KST", "")) + " <span>" + esc(String(list[j].sub).slice(0, 28)) + "</span></a>");
      }
      out += '<div class="fav-row"><a class="tag" href="/archive/?q=' + encodeURIComponent(f[a]) + '">★ ' + esc(f[a]) + "</a>"
           + (hits.length ? hits.join("") : '<span class="fav-none">최근 언급 없음</span>') + "</div>";
    }
    el.innerHTML = '<div class="favbox"><p class="favbox-title">관심 종목</p>' + out + "</div>";
  }

  // 본문 용어에 풀이를 단다. 풀이는 /glossary.html의 dl.glossary 하나에만 적는다.
  function glossary(){
    if (!window.fetch || !window.DOMParser) return;
    fetch("/glossary.html").then(function(r){ return r.text(); }).then(function(html){
      var doc = new DOMParser().parseFromString(html, "text/html");
      var dts = doc.querySelectorAll("dl.glossary dt[id]"), terms = [];
      for (var t = 0; t < dts.length; t++){
        var dd = dts[t].nextElementSibling;
        if (dd) terms.push({ w: dts[t].textContent.trim(), id: dts[t].id, d: dd.textContent.trim() });
      }
      terms.sort(function(a, b){ return b.w.length - a.w.length; });
      var roots = app.querySelectorAll(".lead, .commentary, .correction, .verdict, .statstrip, .scenario .intro, .scenario .watch");
      for (var x = 0; x < terms.length; x++){
        for (var r = 0; r < roots.length; r++){ if (mark(roots[r], terms[x])) break; }
      }
    }).catch(function(){});
  }

  function mark(root, term){
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = w.nextNode())){
      if (n.parentNode.closest(".term, .term-pop")) continue;
      var at = n.nodeValue.indexOf(term.w);
      if (at === -1) continue;
      var rest = n.splitText(at);
      rest.splitText(term.w.length);
      var b = document.createElement("button");
      b.type = "button"; b.className = "term"; b.textContent = term.w;
      b.setAttribute("aria-expanded", "false");
      b.setAttribute("data-d", term.d); b.setAttribute("data-id", term.id);
      rest.parentNode.replaceChild(b, rest);
      return true;
    }
    return false;
  }

  app.addEventListener("click", function(e){
    var t = e.target.closest && e.target.closest(".term");
    if (t){
      var open = t.nextSibling && t.nextSibling.className === "term-pop";
      if (open) t.parentNode.removeChild(t.nextSibling);
      else t.insertAdjacentHTML("afterend", '<span class="term-pop">' + esc(t.getAttribute("data-d"))
        + ' <a href="/glossary/' + esc(t.getAttribute("data-id")) + '.html">자세히</a></span>');
      t.setAttribute("aria-expanded", open ? "false" : "true");
      return;
    }
    var b = e.target.closest && e.target.closest("#shareBtn");
    if (!b) return;
    var url = permalink || location.href.split("#")[0];
    if (navigator.share){
      navigator.share({ title: document.title, url: url }).catch(function(){});
    } else if (navigator.clipboard){
      navigator.clipboard.writeText(url).then(function(){
        b.textContent = "링크 복사됨";
        setTimeout(function(){ b.textContent = "공유하기"; }, 2000);
      });
    }
  });

  window.renderBriefing = function(data){
    try {
      render(data);
      fillNav();
    } catch (e) {
      statebox("브리핑을 표시하지 못했습니다", "<p><code>" + e.message + "</code></p>");
    }
  };
})();
