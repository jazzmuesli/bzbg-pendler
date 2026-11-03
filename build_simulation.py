#!/usr/bin/env python3
"""Build simulation.html — the honest line-500 Umlauf Anschluss-Simulation.

Reads:
  - data/umlauf_data.json        (per-run couplings to RE1, by day type)
  - data/ring_model.json         (ring stops + walk/ride times for the map)
  - data/busti_route.json        (realistic GPS polyline of line 500 from busti.me)
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

/* Richtungskürzel: SN = Schwerin, HH = Hamburg, BZBG = Boizenburg */
function dirBadge(f,t){
  var key = (f==="Schwerin"?"SN":(f==="Hamburg"?"HH":f));
  var cls = key==="SN"?"dir-sn":"dir-hh";
  return '<span class="dir-badge '+cls+'">'+key+'&rarr;BZBG</span>';
}
function depDirBadge(t){
  var key = (t==="Schwerin"?"SN":(t==="Hamburg"?"HH":t));
  var cls = key==="SN"?"dir-sn":"dir-hh";
  return '<span class="dir-badge dir-hh">BZBG&rarr;'+key+'</span>';
}

document.addEventListener("DOMContentLoaded", function(){
  ui.express = {};  // per day type set of express run indices
  ["wd","sa","so"].forEach(function(dt){ ui.express[dt] = {}; });
  initControls();
  initMap();
  initTooltips();
  renderAll();
});

/* ====================================================================== */
/* Tooltip positioning (position:fixed so they are never clipped by .scroll) */
/* ====================================================================== */
function positionTip(tip){
  var box = tip.querySelector(".tipbox");
  if(!box) return;
  var rect = tip.getBoundingClientRect();
  var boxW = box.offsetWidth || 260;
  var boxH = box.offsetHeight || 120;
  var x = rect.left + rect.width/2 - boxW/2;
  if(x < 10) x = 10;
  if(x + boxW > window.innerWidth - 10) x = window.innerWidth - 10 - boxW;
  var y = rect.top - boxH - 14;
  if(y < 10){ y = rect.bottom + 14; box.classList.add("below"); }
  else { box.classList.remove("below"); }
  box.style.left = x + "px";
  box.style.top = y + "px";
}

function showTip(e){
  var tip = e.currentTarget;
  var box = tip.querySelector(".tipbox");
  if(!box) return;
  positionTip(tip);
  box.classList.add("show");
}
function hideTip(e){
  var tip = e.currentTarget;
  var box = tip.querySelector(".tipbox");
  if(!box) return;
  box.classList.remove("show");
}

function initTooltips(){
  document.querySelectorAll(".tip").forEach(function(tip){
    tip.addEventListener("mouseenter", showTip);
    tip.addEventListener("focus", showTip);
    tip.addEventListener("mouseleave", hideTip);
    tip.addEventListener("blur", hideTip);
  });
  window.addEventListener("resize", function(){
    document.querySelectorAll(".tip .tipbox.show").forEach(function(box){
      box.classList.remove("show");
    });
  });
}

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

// Rufbus-Abfahrten (müssen online vorbestellt werden, nicht im Standardtakt)
var RUFBUS_DEPS = [1215, 1262, 1275]; // 20:15, 21:02, 21:15

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
  var ringNormalEl = $("ringNormal"), ringExprEl = $("ringExpress");
  if (ringNormalEl) ringNormalEl.textContent = "31";
  if (ringExprEl) ringExprEl.textContent = String(Math.max(10, 31 - ui.expressSaving));
  $("exprNote").textContent = "Express-auslassbare Halte: " +
    UMLAUF_DATA.express_skipped_stops.join(", ") + ".";
}

function renderKpis(res){
  var k = res.kpis;
  var tipArrival = '<span class="tip">ⓘ<span class="tipbox">Berechnung: Für jeden Zug wird geprüft, ob der Bus noch abfährt, nachdem der Zug am Bahnhof Boizenburg angekommen ist und die Fahrgäste eingestiegen sind. Puffer = Busabfahrt − Zugplanankunft − Einstieg 2 Min. Ein Anschluss zählt als erreicht, wenn der Puffer ≥ eingestellter Mindestpuffer ist. Die Prozentzahl ist gewichtet mit den Fahrgastzahlen n (wie viele Leute tatsächlich in diesem Zug sitzen). Betroffene Pendler: RE1-Fahrgäste, die aussteigen und mit dem Bus weiterfahren – aus Hamburg kommend (HH→BZBG) oder aus Schwerin kommend (SN→BZBG).</span></span>';
  var tipRobust = '<span class="tip">ⓘ<span class="tipbox">Grün ✓ = verspätungsrobust: Der Puffer reicht auch, wenn der Zug mit seiner p90-Verspätung kommt. Rot ✗ = nicht robust: Bei planmäßiger Ankunft reicht der Puffer gerade, bei der üblichen p90-Verspätung verpasst man den Bus. Verspätungsrobust bedeutet: Puffer ≥ p90-Verspätung.</span></span>';
  var tipReturn = '<span class="tip">ⓘ<span class="tipbox">Reserve = Zugabfahrt − Busrückkehr am Bahnhof − Fußweg zum Zug 1 Min. ≥ 0 Min. heißt: Der Bus ist rechtzeitig zurück, damit Fahrgäste den abfahrenden RE1 noch erreichen. Unter 0 Min. rot: Der Bus käme zu spät, der Zug wäre weg. Betroffene Pendler: Bus-Fahrgäste, die am Bahnhof ankommen und den RE1 erreichen wollen – mit dem Bus nach Hamburg (BZBG→HH) oder nach Schwerin (BZBG→SN).</span></span>';
  $("kpis").innerHTML =
    kpi("Anschluss ankommend " + tipArrival, pct(k.arrReachRate), cls(k.arrReachRate),
        "Bus erreicht (Puffer ≥ " + ui.arriveBufferMin + " Min.)")
  + kpi("davon verspätungs­robust " + tipRobust, pct(k.arrRobustRate), cls(k.arrRobustRate),
        "auch bei p90-Verspätung erreicht")
  + kpi("Rückanschluss abfahrend " + tipReturn, pct(k.depReachRate), cls(k.depReachRate),
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
    var svcBadge = r.service === "schule" ? ' <span style="color:var(--muted);font-size:10px">(Schultag)</span>'
                 : r.service === "ferien" ? ' <span style="color:var(--muted);font-size:10px">(Ferien)</span>' : '';
    // Ankommender RE1 Richtung
    var arrDirHtml = a ? dirBadge(a.from, a.to) : '<span class="blank">—</span>';
    var arrDirTxt = a ? (a.from==="Schwerin"?"SN→BZBG":(a.from==="Hamburg"?"HH→BZBG":(a.from+"→BZBG"))) : "—";
    // Abfahrender RE1 Richtung: zurück zum Herkunftsort des ankommenden Zuges
    var depDirHtml = d ? depDirBadge(d.train ? "x" : "x") : '<span class="blank">—</span>';
    var depDirTxt = d ? (a ? (a.from==="Schwerin"?"BZBG→SN":(a.from==="Hamburg"?"BZBG→HH":"BZBG→?")) : "BZBG→?") : "—";
    return '<tr class="' + (exprChecked?"expr":"") + '">'
      + '<td>' + (a ? hh(a.train) : '<span class="blank">—</span>') + '</td>'
      + '<td>' + arrDirHtml + '</td>'
      + '<td class="prop">' + hh(r.dep) + (r.express ? ' <span style="color:var(--expr)">(Exp)</span>' : '') + svcBadge + '</td>'
      + '<td class="' + arrBufCls + '">' + (a ? a.buffer + " Min." : '<span class="blank">—</span>') + '</td>'
      + '<td>' + (a && a.p90 != null ? a.p90 : '<span class="blank">—</span>') + '</td>'
      + '<td>' + robust + '</td>'
      + '<td>' + hh(r.ret) + '</td>'
      + '<td>' + (d ? hh(d.train) + ' <span style="font-size:10px;color:var(--muted)">'+depDirTxt+'</span>' : '<span class="blank">—</span>') + '</td>'
      + '<td class="' + resCls + '">' + (d ? d.reserve + " Min." : '<span class="blank">—</span>') + '</td>'
      + '<td><input type="checkbox" class="exprbox" ' + exprChecked + ' onchange="toggleExpress(' + i + ')"></td>'
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
  // Haltestellen aus dem Ringmodell
  var anyExpress = expressSet().length > 0;
  RING_MODEL.stops.forEach(function(s){
    if(s.lat == null) return;
    var skip = anyExpress && s.express_skippable && !s.is_bahnhof;
    var color = s.is_bahnhof ? "#12303d" : (skip ? "#7a3e9d" : "#1a7f4b");
    var m = L.circleMarker([s.lat, s.lon], {radius: s.is_bahnhof?7:6, color:color, fillColor:color, fillOpacity:0.85, weight:2}).addTo(map);
    m.bindPopup("<b>"+s.name+"</b><br>"+(s.is_bahnhof?"Bahnhof":(skip?"Express: ausgelassen":"Halt"))+
      (s.walk_from_prev_min!=null?"<br>Fußweg: "+s.walk_from_prev_min+" Min.":""));
    markers.push(m);
  });
  // Realistische Streckenführung der Linie 500 (GPS-Spur von busti.me).
  routeLine = L.polyline(BUSTI_ROUTE, {color:"#12303d", weight:4, opacity:0.9}).addTo(map);
  try { map.fitBounds(routeLine.getBounds().pad(0.18)); } catch(e){}
}

window.addEventListener("error", function(e){
  var n = $("runNote"); if(n) n.textContent = "Fehler: " + e.message;
});
'''


def build():
    umlauf = read(os.path.join(HERE, "data", "umlauf_data.json"))
    ring = read(os.path.join(HERE, "data", "ring_model.json"))
    busti = read(os.path.join(HERE, "data", "busti_route.json"))
    umlauf_js = strip_node(read(os.path.join(HERE, "src", "engine", "umlauf.js")))
    template = read(os.path.join(HERE, "src", "engine_template.html"))

    combined = []
    combined.append("/* ===== Auto-generated by build_simulation.py — DO NOT EDIT ===== */")
    combined.append(umlauf_js)
    combined.append(APP_JS)
    combined_js = "\n".join(combined)

    html = template.replace("__UMLAUF_DATA_JSON_PLACEHOLDER__", umlauf)
    html = html.replace("__RING_MODEL_JSON_PLACEHOLDER__", ring)
    html = html.replace("__BUSTI_ROUTE_JSON_PLACEHOLDER__", busti)
    html = html.replace("__COMBINED_JS_PLACEHOLDER__", combined_js)

    out = os.path.join(HERE, "simulation.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("Built " + out)
    print("Size: %d bytes" % len(html))


if __name__ == "__main__":
    build()
