// Mini timer window. Shows the running block, or a "time to switch" note when it ends.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");
  let st = null;
  function draw() {
    const pill = $("pill");
    if (!st) { $("name").textContent = "Колесо недели"; $("sub").textContent = ""; $("time").textContent = ""; return; }
    const done = st.mode === "done";
    pill.classList.toggle("done", done);
    pill.style.setProperty("--c", st.color || "#7A8794");
    $("b-stop").hidden = done; $("b-dismiss").hidden = !done;
    if (done) {
      $("name").textContent = st.label || "Пора переключиться";
      $("sub").textContent = st.next ? "Дальше: " + st.next : "Блок закончен";
      $("time").textContent = "";
      return;
    }
    const left = Math.max(0, st.endsAt - Date.now()), total = Math.max(1, st.endsAt - st.start), s = Math.ceil(left / 1000);
    $("name").textContent = st.label;
    $("sub").textContent = left > 0 ? "осталось" : "время вышло";
    $("time").textContent = pad(Math.floor(s / 60)) + ":" + pad(s % 60);
    $("bar").style.width = (100 * Math.min(1, 1 - left / total)).toFixed(2) + "%";
  }
  window.mini.onState(s => { st = s; draw(); });
  $("b-open").addEventListener("click", () => window.mini.open());
  $("b-stop").addEventListener("click", () => window.mini.stop());
  $("b-dismiss").addEventListener("click", () => window.mini.dismiss());
  setInterval(draw, 1000);
})();
