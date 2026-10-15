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

  function table(spec, narrow){
    if (!spec || !spec.rows || !spec.rows.length) return "";
    var head = spec.head || [];
    var colcls = spec.colcls || [];
    var out = '<div class="twrap"><table' + (narrow ? ' class="narrow"' : '') + '><thead><tr>';
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
    for (var i = 0; i < m.rows.length && i < 4; i++){
      var c = m.rows[i].c || [];
      if (!c[1]) continue;
      out += '<div class="snap ' + (ROWCLS[m.rows[i].d] || "") + '"><span class="snap-k">' + c[0]
           + '</span><span class="snap-v">' + c[1] + '</span><span class="snap-d">' + (c[2] || "") + "</span></div>";
    }
    return out ? '<div class="snapshot">' + out + "</div>" : "";
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

    var h = '<div class="wrap"><header class="masthead">'
      + '<span class="kicker">Market Briefing · KOSPI / KOSDAQ</span>'
      + '<h1 class="title">섬개미 증시 브리핑</h1>'
      + '<div class="timestamp">' + (d.stamp || "") + (d.sub ? " · " + d.sub : "") + "</div>"
      + meta
      + snapshot(d.market)
      + (d.lead ? '<p class="lead">' + d.lead + "</p>" : "")
      + "</header>" + LEGEND;

    if (d.commentary && d.commentary.length){
      var s0 = '<div class="commentary">';
      for (var c = 0; c < d.commentary.length; c++) s0 += "<p>" + d.commentary[c] + "</p>";
      s0 += "</div>";
      h += section("00", "오늘의 해설", s0);
    }

    var s1 = table(d.market);
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

    var s3 = table(d.cal) + (d.calNote ? '<p class="note-line">' + d.calNote + "</p>" : "");
    h += section("03", "향후 7일 일정", s3);

    var s4 = "";
    if (d.scen){
      for (var k = 0; k < d.scen.length; k++){
        var sc = d.scen[k];
        s4 += '<div class="scenario"><div class="scenario-head"><h3>' + sc.t + "</h3>"
           + '<span class="stars">중요도 ' + (sc.stars || "") + "</span></div>"
           + (sc.intro ? '<p class="intro">' + sc.intro + "</p>" : "")
           + table({ head: sc.head, colcls: sc.colcls, rows: sc.rows }, true)
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
    startClock();
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
    }).catch(function(){});
  }

  app.addEventListener("click", function(e){
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
