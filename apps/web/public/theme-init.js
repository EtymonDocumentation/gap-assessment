// Applies the saved colour theme before the page paints. A separate file (not an inline script) so the page also works
// under a strict Content-Security-Policy (script-src 'self').
try {
  var t = localStorage.getItem("gap-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
