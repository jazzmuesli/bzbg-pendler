#!/usr/bin/env python3
"""Build simulation.html — the honest line-500 Umlauf Anschluss-Simulation.

Reads:
  - data/umlauf_data.json        (per-run couplings to RE1, by day type)
  - data/ring_model.json         (ring stops + walk/ride times for the map)
  - src/engine/umlauf.js         (pure eval logic, shared with Node tests)
  - src/engine_template.html     (HTML + placeholders)

Writes:
  - simulation.html (self-contained; no runtime fetch)

src/engine/umlauf.js is authored as CommonJS for the Node tests; the require/
module.exports wrappers are stripped so the same source runs in the browser.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def strip_node(js):
    js = re.sub(
        r'^\s*(?:const|let|var)\s*\{[^}]*\}\s*=\s*require\([^)]*\);\s*$\n?',
        "", js, flags=re.MULTILINE,
    )
    js = re.sub(
        r'\nif \(typeof module !== "undefined" && module\.exports\) \{.*?\n\}\n',
        "\n", js, flags=re.DOTALL,
    )
    return js


APP_JS = r'''
/* ====================================================================== */
/* Application layer: state, rendering, map. Uses evalDay() from umlauf.js */
/* ====================================================================== */
var ui = { dayType: "wd", shift: 0, arriveBufferMin: 3, departReserveMin: 2, expressSaving: 22, schoolMode: "schule", express: {} };
var map = null, markers = [], routeLine = null;

function $(id){ return document.getElementById(id); }
function hh(m){ if(m==null) return "--:--"; var x=((m%1440)+1440)%1440; return String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0"); }
function pct(x){ return (Math.round(x*10)/10).toFixed(1)+"%"; }

document.addEventListener("DOMContentLoaded", function(){
  ui.express = {};  // per day type set of express run indices
  ["wd","sa","so"].forEach(function(dt){ ui.express[dt] = {}; });
  initControls();
  initMap();
  renderAll();
});

function initControls(){
  var dayBtns = document.querySelectorAll(".daysel button");
  dayBtns.forEach(function(b){
    b.addEventListener("click", function(){
      dayBtns.forEach(function(x){ x.classList.remove("active"); });
      b.classList.add("active");
      ui.dayType = b.dataset.dt;
      renderAll();
    });
  });
  [["shift"],["arriveBufferMin"],["departReserveMin"],["expressSaving"]].forEach(function(p){
    var id=p[0];
    $(id).addEventListener("input", function(e){
      ui[id]=Number(e.target.value); $(id+"Val").textContent=ui[id]; renderAll();
    });
  });
  $("allExpr").addEventListener("click", function(){
    var runs = UMLAUF_DATA.days[ui.dayType].runs;
    runs.forEach(function(_,i){ ui.express[ui.dayType][i]=true; });
    renderAll();
  });
  $("noExpr").addEventListener("click", function(){
    ui.express[ui.dayType] = {}; renderAll();
  });
  $("modeSchule").addEventListener("change", function(){ if(this.checked){ ui.schoolMode="schule"; renderAll(); } });
  $("modeFerien").addEventListener("change", function(){ if(this.checked){ ui.schoolMode="ferien"; renderAll(); } });
}

function expressSet(){
  var o = ui.express[ui.dayType] || {};
  return Object.keys(o).filter(function(k){ return o[k]; }).map(Number);
}

function currentEval(){
  return evalDay(UMLAUF_DATA.days[ui.dayType], {
    board: UMLAUF_DATA.board,
    walk: UMLAUF_DATA.walk,
    expressSaving: ui.expressSaving,
    shift: ui.shift,
    expressSet: expressSet(),
    arriveBufferMin: ui.arriveBufferMin,
    departReserveMin: ui.departReserveMin,
    schoolMode: ui.schoolMode,
  });
}

function toggleExpress(i){
  var o = ui.express[ui.dayType];
  o[i] = !o[i];
  renderAll();
}

function renderAll(){
  var res = currentEval();
  renderKpis(res);
  renderRuns(res);
  updateMap();
  var k = res.kpis;
  $("runNote").textContent = res.runs.length + " Umläufe · " + k.expressCount +
    " davon Express · Verschiebung " + (ui.shift>=0?"+":"") + ui.shift + " Min.";
  $("routeNote").textContent = "Express spart " + ui.expressSaving +
    " Min. Ringdauer (lässt " + UMLAUF_DATA.express_skipped_stops.length + " Fußweg-Halte aus).";
  // update the express-saving hint: typical ring 31 min -> express floored at 10
  var ringNormalEl = $("ringNormal"), ringExprEl = $("ringExpress");
  if (ringNormalEl) ringNormalEl.textContent = "31";
  if (ringExprEl) ringExprEl.textContent = String(Math.max(10, 31 - ui.expressSaving));
  $("exprNote").textContent = "Express-auslassbare Halte: " +
    UMLAUF_DATA.express_skipped_stops.join(", ") + ".";
}

function renderKpis(res){
  var k = res.kpis;
  $("kpis").innerHTML =
    kpi("Anschluss ankommend", pct(k.arrReachRate), cls(k.arrReachRate),
        "Bus erreicht (Puffer ≥ " + ui.arriveBufferMin + " Min.)")
  + kpi("davon verspätungs­robust", pct(k.arrRobustRate), cls(k.arrRobustRate),
        "auch bei p90-Verspätung erreicht")
  + kpi("Rückanschluss abfahrend", pct(k.depReachRate), cls(k.depReachRate),
        "Bus rechtzeitig zurück (Reserve ≥ " + ui.departReserveMin + " Min.)")
  + kpi("Ø Ankunftspuffer", k.meanArrBuffer.toFixed(1) + " Min.", "",
        "Wartezeit pünktlicher Fahrgäste");
}
function kpi(k,v,c,s){ return '<div class="kpi"><div class="k">'+k+'</div><div class="v '+c+'">'+v+'</div><div class="s">'+s+'</div></div>'; }
function cls(r){ return r>=90?"good":(r>=70?"warn":"bad"); }

function renderRuns(res){
  var rows = res.runs.map(function(r){
    var i = r.index;
    var exprChecked = (ui.express[ui.dayType]||{})[i] ? "checked" : "";
    var a = r.arrival, d = r.departure;
    var arrBufCls = a ? (a.buffer < 0 ? "bad" : (a.buffer >= ui.arriveBufferMin ? "good" : "warn")) : "";
    var robust = a ? (a.robust ? '<span class="good">✓</span>' : '<span class="bad">✗</span>') : "–";
    var resCls = d ? (d.reserve < 0 ? "bad" : (d.reserve >= ui.departReserveMin ? "good" : "warn")) : "";
    var dirTxt = a ? ("aus " + a.from + " → " + a.to) : "–";
    var svcBadge = r.service === "schule" ? ' <span style="color:var(--muted);font-size:10px">(Schultag)</span>'
                 : r.service === "ferien" ? ' <span style="color:var(--muted);font-size:10px">(Ferien)</span>' : '';
    return '<tr class="' + (exprChecked?"expr":"") + '">'
      + '<td><input type="checkbox" class="exprbox" ' + exprChecked + ' onchange="toggleExpress(' + i + ')"></td>'
      + '<td class="ham">' + (a ? hh(a.train) : "–") + '</td>'
      + '<td>' + dirTxt + '</td>'
      + '<td class="prop">' + hh(r.dep) + (r.express ? ' <span style="color:var(--expr)">(Exp)</span>' : '') + svcBadge + '</td>'
      + '<td class="' + arrBufCls + '">' + (a ? a.buffer + " Min." : "–") + '</td>'
      + '<td>' + (a && a.p90 != null ? a.p90 : "–") + '</td>'
      + '<td>' + robust + '</td>'
      + '<td>' + hh(r.ret) + '</td>'
      + '<td class="sch">' + (d ? hh(d.train) : "–") + '</td>'
      + '<td class="' + resCls + '">' + (d ? d.reserve + " Min." : "–") + '</td>'
      + '</tr>';
  }).join("");
  $("runsBody").innerHTML = rows || '<tr><td colspan="10" style="color:var(--muted)">Keine Umläufe</td></tr>';
}

/* ------------------------------------------------------------------ map */
function initMap(){
  var el = $("map");
  if(!el) return;
  if(typeof L === "undefined"){ el.innerHTML = '<div style="padding:16px;color:var(--muted)">Karte nicht verfügbar.</div>'; return; }
  map = L.map("map", {zoomControl:true}).setView([53.3776, 10.7465], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:"© OpenStreetMap contributors", maxZoom:18
  }).addTo(map);
}

function updateMap(){
  if(!map) return;
  markers.forEach(function(m){ map.removeLayer(m); }); markers = [];
  if(routeLine){ map.removeLayer(routeLine); routeLine = null; }
  // Show the ring; if ANY run is express, grey the express-skippable stops.
  var anyExpress = expressSet().length > 0;
  var coords = [];
  RING_MODEL.stops.forEach(function(s){
    if(s.lat == null) return;
    var skip = anyExpress && s.express_skippable && !s.is_bahnhof;
    var color = s.is_bahnhof ? "#12303d" : (skip ? "#7a3e9d" : "#1a7f4b");
    var m = L.circleMarker([s.lat, s.lon], {radius: s.is_bahnhof?7:6, color:color, fillColor:color, fillOpacity:0.85, weight:2}).addTo(map);
    m.bindPopup("<b>"+s.name+"</b><br>"+(s.is_bahnhof?"Bahnhof":(skip?"Express: ausgelassen":"Halt"))+
      (s.walk_from_prev_min!=null?"<br>Fußweg: "+s.walk_from_prev_min+" Min.":""));
    markers.push(m);
    if(!skip || s.is_bahnhof) coords.push([s.lat, s.lon]);
  });
  routeLine = L.polyline(coords, {color:"#7a3e9d", weight:4, opacity:0.85}).addTo(map);
  try { map.fitBounds(routeLine.getBounds().pad(0.15)); } catch(e){}
}

window.addEventListener("error", function(e){
  var n = $("runNote"); if(n) n.textContent = "Fehler: " + e.message;
});
'''


def build():
    umlauf = read(os.path.join(HERE, "data", "umlauf_data.json"))
    ring = read(os.path.join(HERE, "data", "ring_model.json"))
    umlauf_js = strip_node(read(os.path.join(HERE, "src", "engine", "umlauf.js")))
    template = read(os.path.join(HERE, "src", "engine_template.html"))

    combined = []
    combined.append("/* ===== Auto-generated by build_simulation.py — DO NOT EDIT ===== */")
    combined.append(umlauf_js)
    combined.append(APP_JS)
    combined_js = "\n".join(combined)

    html = template.replace("__UMLAUF_DATA_JSON_PLACEHOLDER__", umlauf)
    html = html.replace("__RING_MODEL_JSON_PLACEHOLDER__", ring)
    html = html.replace("__COMBINED_JS_PLACEHOLDER__", combined_js)

    out = os.path.join(HERE, "simulation.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("Built " + out)
    print("Size: %d bytes" % len(html))


if __name__ == "__main__":
    build()
