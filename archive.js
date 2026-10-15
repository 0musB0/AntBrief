(function(){
  "use strict";
  var q = document.getElementById("archiveQ");
  var count = document.getElementById("archiveCount");
  if (!q) return;
  var items = [].slice.call(document.querySelectorAll(".doc li"));
  function run(){
    var words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    items.forEach(function(li){
      var t = li.textContent.toLowerCase();
      var ok = words.every(function(w){ return t.indexOf(w) !== -1; });
      li.hidden = !ok;
      if (ok) shown++;
    });
    count.textContent = words.length ? shown + "건" : "";
  }
  q.addEventListener("input", run);
  var pre = new URLSearchParams(location.search).get("q");
  if (pre){ q.value = pre; run(); favBtn(pre); }

  // 종목 태그로 들어왔을 때 관심 종목 고정/해제. 첫 화면 관심 종목 칸에 쓰인다.
  function favBtn(name){
    var b = document.createElement("button");
    b.type = "button";
    b.className = "favbtn";
    b.style.cssText = "margin-left:8px;min-height:32px;padding:0 12px;border:1px solid #2a2d31;border-radius:999px;background:#1d2024;color:inherit;font:inherit;font-size:13px;cursor:pointer";
    function get(){ try { return JSON.parse(localStorage.getItem("favStocks")) || []; } catch (e) { return []; } }
    function draw(){ b.textContent = get().indexOf(name) !== -1 ? "★ 관심 종목 해제" : "☆ 관심 종목으로 고정"; }
    b.addEventListener("click", function(){
      var f = get(), at = f.indexOf(name);
      if (at === -1) f.push(name); else f.splice(at, 1);
      try { localStorage.setItem("favStocks", JSON.stringify(f.slice(-10))); } catch (e) {}
      draw();
    });
    draw();
    count.parentNode.insertBefore(b, count.nextSibling);
  }
})();
