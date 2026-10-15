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
  if (pre){ q.value = pre; run(); }
})();
