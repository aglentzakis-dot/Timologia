/* GlenApps — προστασία από ενσωμάτωση σε ξένη σελίδα (25/10/2026).
   Η εφαρμογή ανοίγει μέσα σε πλαίσιο ΜΟΝΟ από δική μας σελίδα (π.χ. την πύλη GlenApps).
   Αν τη φορτώσει ξένη σελίδα, κρύβεται και ανοίγει μόνη της σε κανονικό παράθυρο. */
(function () {
  if (window.top === window.self) return;
  var dikia = false;
  try { dikia = window.top.location.origin === window.location.origin; } catch (e) { dikia = false; }
  if (dikia) return;
  document.documentElement.style.display = "none";
  try { window.top.location.replace(window.location.href); } catch (e) {}
})();
