/*
 * Ricevitore Chromecast nostro ("Custom Web Receiver"): la pagina che la TV
 * apre quando si trasmette una presentazione, se CAST_APP_ID è configurato
 * (vedi src/app/ui/slideshow/cast.ts e docs/architettura.md).
 *
 * Non legge sessione né database: riceve dal browser che trasmette, sul
 * canale CAST_NAMESPACE, l'URL firmato di una foto alla volta con la
 * transizione scelta, e la mostra con le stesse animazioni della pagina.
 * L'SDK del ricevitore va caricato da gstatic.com (Google chiede di non
 * ospitarlo in proprio).
 */

const NAMESPACE = "urn:x-cast:com.acasolino.foto";

const HTML = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Archivio foto</title>
<script src="https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  body { font-family: system-ui, sans-serif; color: rgb(255 255 255 / 0.7); }
  #idle { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 28px; letter-spacing: 0.02em; }
  #idle b { color: #ff1500; font-weight: 600; }
  #stage { position: absolute; inset: 0; }
  #stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  #stage img:not(.ready):not(.leaving) { opacity: 0; }
  #stage[data-transition="dissolvenza"] img.ready,
  #stage[data-transition="zoom"] img.ready { animation: fade 1s ease both; }
  #stage[data-transition="zoom"] img.ready {
    animation: fade 1s ease both, zoom calc(var(--slide-duration, 5s) + 1s) linear both;
  }
  #stage[data-transition="zoom"] img.ready.still { animation: fade 1s ease both; }
  #stage[data-transition="zoom"] img.leaving { transform: scale(1.08); }
  #stage[data-transition="scorrimento"] img.ready { animation: in-next 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
  #stage[data-transition="scorrimento"] img.leaving { animation: out-next 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
  #stage[data-transition="scorrimento"][data-dir="prev"] img.ready { animation-name: in-prev; }
  #stage[data-transition="scorrimento"][data-dir="prev"] img.leaving { animation-name: out-prev; }
  #stage[data-transition="nessuna"] img.leaving { opacity: 0; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes zoom { from { transform: scale(1); } to { transform: scale(1.08); } }
  @keyframes in-next { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @keyframes out-next { from { transform: translateX(0); } to { transform: translateX(-100%); } }
  @keyframes in-prev { from { transform: translateX(-100%); } to { transform: translateX(0); } }
  @keyframes out-prev { from { transform: translateX(0); } to { transform: translateX(100%); } }
</style>
</head>
<body>
<div id="idle"><span><b>Antonio Casolino</b> | Photo Archive</span></div>
<div id="stage"></div>
<script>
(function () {
  var NS = ${JSON.stringify(NAMESPACE)};
  var TRANSITIONS = ["dissolvenza", "scorrimento", "zoom", "nessuna"];
  var stage = document.getElementById("stage");
  var idle = document.getElementById("idle");
  var current = null;
  var lastUrl = null;

  function show(d) {
    if (!d || d.type !== "show" || typeof d.url !== "string" || !/^https?:\\/\\//.test(d.url)) return;
    if (d.url === lastUrl) return;
    lastUrl = d.url;
    var img = new Image();
    img.alt = "";
    img.onload = img.onerror = function () {
      if (lastUrl !== d.url) return; // nel frattempo è arrivata un'altra foto
      idle.style.display = "none";
      stage.dataset.transition = TRANSITIONS.indexOf(d.transition) >= 0 ? d.transition : "dissolvenza";
      stage.dataset.dir = d.dir === "prev" ? "prev" : "next";
      var secs = Number(d.seconds) > 0 ? Number(d.seconds) : 0;
      stage.style.setProperty("--slide-duration", (secs || 5) + "s");
      if (!secs) img.classList.add("still");
      var old = current;
      Array.prototype.forEach.call(stage.querySelectorAll("img.leaving"), function (e) { e.remove(); });
      stage.appendChild(img);
      img.classList.add("ready");
      if (old) {
        old.classList.remove("ready", "still");
        old.classList.add("leaving");
        setTimeout(function () { if (old !== current) old.remove(); }, 1500);
      }
      current = img;
    };
    img.src = d.url;
  }

  var context = cast.framework.CastReceiverContext.getInstance();
  context.addCustomMessageListener(NS, function (e) { show(e.data); });
  var options = new cast.framework.CastReceiverOptions();
  options.disableIdleTimeout = true; // le foto arrivano dal canale, non dal lettore multimediale
  options.skipPlayersLoad = true;
  context.start(options);
})();
</script>
</body>
</html>
`;

export function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
