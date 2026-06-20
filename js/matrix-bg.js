// =====================================================================
// PROTOCOLE OMERTA - Fond "pluie de code" (Matrix)
// Canvas plein ecran derriere le contenu (z-index 0). Leger: ~18 fps,
// desactive si l'utilisateur prefere moins d'animations.
// =====================================================================
(function () {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var canvas = document.createElement("canvas");
    canvas.id = "matrix-bg";
    (document.body || document.documentElement).appendChild(canvas);
    var ctx = canvas.getContext("2d");

    var chars = "アカサタナハマヤラ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&*+=<>/".split("");
    var w, h, fontSize, cols, drops;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      fontSize = w < 600 ? 12 : 15;
      cols = Math.max(1, Math.floor(w / fontSize));
      drops = [];
      for (var i = 0; i < cols; i++) drops[i] = Math.random() * -50;
    }
    resize();
    window.addEventListener("resize", resize);

    var last = 0, interval = 55; // ~18 fps
    function draw(t) {
      requestAnimationFrame(draw);
      if (t - last < interval) return;
      last = t;

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0, 4, 1, 0.12)";   // trainee qui s'efface
      ctx.fillRect(0, 0, w, h);
      ctx.font = fontSize + "px monospace";

      for (var i = 0; i < cols; i++) {
        var ch = chars[(Math.random() * chars.length) | 0];
        var x = i * fontSize;
        var y = drops[i] * fontSize;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = Math.random() > 0.975 ? "#d6ffe2" : "#00ff70"; // tete plus claire
        ctx.fillText(ch, x, y);
        if (y > h && Math.random() > 0.975) drops[i] = Math.random() * -20;
        drops[i]++;
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(draw);
  } catch (e) { /* fond decoratif: jamais bloquant */ }
})();
