/*
  AppsStripModule — κοινή λωρίδα προβολής εφαρμογών.
  Ίδιο αρχείο αντιγράφεται απαράλλαχτο σε όλες τις εφαρμογές.
  Μόνο η κλήση AppsStripModule.init({...}) στο τέλος κάθε εφαρμογής αλλάζει.

  Τι κάνει:
  - Διαβάζει μια κοινή λίστα εφαρμογών από ένα απομακρυσμένο αρχείο JSON
    (ίδιο αρχείο για όλες τις εφαρμογές, αλλάζεις τη λίστα χωρίς να ξαναβγάλεις καμία εφαρμογή).
  - Αν η φόρτωση αποτύχει (π.χ. χωρίς σύνδεση) και δεν υπάρχει τίποτα αποθηκευμένο
    από προηγούμενη φορά, δεν εμφανίζεται απολύτως τίποτα — η εφαρμογή συνεχίζει κανονικά.
  - Ποτέ δεν προβάλλει την ίδια την εφαρμογή μέσα στην οποία τρέχει.
  - Η λωρίδα μπαίνει σε κανονική ροή περιεχομένου (όχι σταθερή/επικαλυπτική θέση),
    οπότε δεν μπορεί ποτέ να σκεπάσει κουμπί.
  - Κλείσιμο (✕) = την κλείνει μόνο για αυτή τη φορά. «Δεν με ενδιαφέρει» = την κρύβει
    μόνιμα για τη συγκεκριμένη προβαλλόμενη εφαρμογή (μπορεί να αναιρεθεί από τη σελίδα
    «Οι εφαρμογές μας»).
  - Εμφανίζεται αραιά (συχνότητα με βάση ώρες που έχουν περάσει), πιο αραιά σε Pro χρήστες.
*/
window.AppsStripModule = (function(){
  "use strict";

  const DEFAULT_LIST_URL = "https://aglentzakis-dot.github.io/apps-shared/apps-list.json";
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000;       // 6 ώρες: πόσο "φρέσκη" θεωρείται η λίστα
  const FREE_INTERVAL_MS = 24 * 60 * 60 * 1000;   // δωρεάν χρήστες: το πολύ 1 φορά/ημέρα
  const PRO_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000; // Pro χρήστες: το πολύ 1 φορά/4 ημέρες

  let cfg = null;          // ρυθμίσεις από το init()
  let appsData = null;     // η φορτωμένη λίστα εφαρμογών (πίνακας) — null = δεν φορτώθηκε ακόμη/απέτυχε
  let loadPromise = null;
  let chosenApp = undefined; // η εφαρμογή που επιλέχθηκε για εμφάνιση σε αυτή τη φόρτωση σελίδας

  function escapeHtml(s){
    return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function lsKey(suffix){
    return "asm_" + (cfg && cfg.appId ? cfg.appId : "app") + "_" + suffix;
  }
  function readLS(key, fallback){
    try{ const v = localStorage.getItem(key); return v===null ? fallback : JSON.parse(v); }
    catch(e){ return fallback; }
  }
  function writeLS(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){ /* χωρίς αποθηκευτικό χώρο - δεν πειράζει */ }
  }

  async function loadList(){
    if(loadPromise) return loadPromise;
    loadPromise = (async ()=>{
      const cacheKey = lsKey("cache");
      const cacheTimeKey = lsKey("cache_time");
      const cached = readLS(cacheKey, null);
      const cachedAt = readLS(cacheTimeKey, 0);
      const stillFresh = cached && (Date.now() - cachedAt < CACHE_TTL_MS);
      if(stillFresh){ appsData = cached; return appsData; }
      try{
        const resp = await fetch(cfg.listUrl, {cache:"no-store"});
        if(!resp.ok) throw new Error("http " + resp.status);
        const json = await resp.json();
        const apps = Array.isArray(json && json.apps) ? json.apps : [];
        appsData = apps;
        writeLS(cacheKey, apps);
        writeLS(cacheTimeKey, Date.now());
      }catch(e){
        // αποτυχία φόρτωσης (π.χ. χωρίς σύνδεση) - αθόρυβα, χωρίς σφάλμα στην εφαρμογή.
        // Αν υπάρχει παλιά αποθηκευμένη λίστα, τη χρησιμοποιούμε κι ας μην είναι "φρέσκη".
        appsData = cached || [];
      }
      return appsData;
    })();
    return loadPromise;
  }

  function findApp(id){
    return (appsData || []).find(a => a && a.id === id);
  }

  function isDismissed(appEntryId){
    const list = readLS(lsKey("dismissed"), []);
    return list.indexOf(appEntryId) !== -1;
  }
  function dismissPermanently(appEntryId){
    const list = readLS(lsKey("dismissed"), []);
    if(list.indexOf(appEntryId) === -1){ list.push(appEntryId); writeLS(lsKey("dismissed"), list); }
  }
  function undismiss(appEntryId){
    const list = readLS(lsKey("dismissed"), []).filter(x => x !== appEntryId);
    writeLS(lsKey("dismissed"), list);
  }

  function matchesTargeting(entry){
    if(!entry.showIn || entry.showIn === "all") return true;
    if(Array.isArray(entry.showIn)) return entry.showIn.indexOf(cfg.appId) !== -1;
    return true;
  }

  function eligibleApps(){
    if(!appsData) return [];
    return appsData.filter(e => e && e.id && e.id !== cfg.appId && matchesTargeting(e) && !isDismissed(e.id));
  }

  function isProUser(){
    return typeof cfg.isPro === "function" ? !!cfg.isPro() : !!cfg.isPro;
  }
  function intervalMs(){
    return isProUser() ? PRO_INTERVAL_MS : FREE_INTERVAL_MS;
  }
  function dueToShow(){
    const last = readLS(lsKey("last_shown"), 0);
    return (Date.now() - last) >= intervalMs();
  }
  function markShownNow(){
    writeLS(lsKey("last_shown"), Date.now());
  }

  /* -------- Η διακριτική λωρίδα, για να τη βάλει η εφαρμογή μέσα στο δικό της περιεχόμενο -------- */

  function renderStrip(){
    if(!appsData) return ""; // δεν έχει φορτώσει ακόμη ή απέτυχε χωρίς παλιά αποθηκευμένη λίστα
    if(sessionStorage.getItem(lsKey("hidden_this_session")) === "1") return "";

    const eligible = eligibleApps();
    if(!eligible.length) return "";

    if(chosenApp === undefined){
      if(!dueToShow()){ chosenApp = null; return ""; }
      chosenApp = eligible[Math.floor(Math.random() * eligible.length)];
      markShownNow();
    }
    if(!chosenApp) return "";

    const a = chosenApp;
    return `
    <div class="asm-strip" data-asm-app="${escapeHtml(a.id)}">
      <a href="${escapeHtml(a.url || "#")}" target="_blank" rel="noopener" class="asm-strip-link">
        <span class="asm-strip-icon">${a.icon ? escapeHtml(a.icon) : "📱"}</span>
        <span class="asm-strip-text">
          <span class="asm-strip-name">${escapeHtml(a.name || "")}</span>
          <span class="asm-strip-tagline">${escapeHtml(a.tagline || "")}</span>
        </span>
      </a>
      <button type="button" class="asm-strip-x" data-asm-act="hide-session" title="Κλείσιμο">✕</button>
      <button type="button" class="asm-strip-notint" data-asm-act="not-interested" data-asm-id="${escapeHtml(a.id)}">Δεν με ενδιαφέρει</button>
    </div>`;
  }

  /* -------- Η σελίδα «Οι εφαρμογές μας» — πλήρης λίστα -------- */

  function cardActionsHtml(app, dismissed){
    return `<a href="${escapeHtml(app.url || "#")}" target="_blank" rel="noopener" class="asm-card-open">Άνοιγμα</a>
      ${dismissed
        ? `<button type="button" class="asm-card-undismiss" data-asm-act="interested-again" data-asm-id="${escapeHtml(app.id)}">Ενδιαφέρομαι ξανά</button>`
        : `<button type="button" class="asm-card-dismiss" data-asm-act="not-interested" data-asm-id="${escapeHtml(app.id)}">Δεν με ενδιαφέρει</button>`}`;
  }

  function renderOurAppsPage(){
    if(!appsData){
      return `<div class="asm-empty">Δεν ήταν δυνατή η φόρτωση της λίστας εφαρμογών αυτή τη στιγμή. Δοκίμασε ξανά αργότερα, ή όταν έχεις σύνδεση στο διαδίκτυο.</div>`;
    }
    const others = appsData.filter(e => e && e.id && e.id !== cfg.appId);
    if(!others.length){
      return `<div class="asm-empty">Δεν υπάρχουν άλλες εφαρμογές να εμφανιστούν αυτή τη στιγμή.</div>`;
    }
    const cards = others.map(a => {
      const dismissed = isDismissed(a.id);
      return `
      <div class="asm-card" data-asm-card="${escapeHtml(a.id)}">
        <div class="asm-card-top">
          <span class="asm-card-icon">${a.icon ? escapeHtml(a.icon) : "📱"}</span>
          <div>
            <div class="asm-card-name">${escapeHtml(a.name || "")}</div>
            <div class="asm-card-tagline">${escapeHtml(a.tagline || "")}</div>
          </div>
        </div>
        <div class="asm-card-actions">${cardActionsHtml(a, dismissed)}</div>
      </div>`;
    }).join("");
    return `<div class="asm-page">${cards}</div>`;
  }

  /* -------- Στυλ (μπαίνουν μία φορά, ανεξάρτητα από το θέμα της κάθε εφαρμογής) -------- */

  function injectStyles(){
    if(document.getElementById("asm-styles")) return;
    const style = document.createElement("style");
    style.id = "asm-styles";
    style.textContent = `
      .asm-strip{display:flex;align-items:center;gap:8px;background:#f3f5f3;border:1px solid #dfe5df;
        border-radius:12px;padding:8px 10px;margin:10px 0;font-size:13px;box-sizing:border-box;}
      .asm-strip-link{display:flex;align-items:center;gap:8px;flex:1;min-width:0;text-decoration:none;color:inherit;}
      .asm-strip-icon{font-size:20px;flex-shrink:0;line-height:1;}
      .asm-strip-text{display:flex;flex-direction:column;min-width:0;overflow:hidden;}
      .asm-strip-name{font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .asm-strip-tagline{font-size:11.5px;color:#6b776b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .asm-strip-x{background:none;border:none;color:#8a948a;font-size:14px;line-height:1;cursor:pointer;padding:2px 4px;flex-shrink:0;}
      .asm-strip-notint{background:none;border:none;color:#8a948a;font-size:10.5px;text-decoration:underline;cursor:pointer;padding:0;flex-shrink:0;white-space:nowrap;}
      .asm-page{display:flex;flex-direction:column;gap:10px;}
      .asm-card{border:1px solid #dfe5df;border-radius:12px;padding:12px;box-sizing:border-box;}
      .asm-card-top{display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;}
      .asm-card-icon{font-size:26px;line-height:1;}
      .asm-card-name{font-weight:700;font-size:14.5px;}
      .asm-card-tagline{font-size:12.5px;color:#6b776b;margin-top:2px;}
      .asm-card-actions{display:flex;gap:14px;align-items:center;}
      .asm-card-open{font-weight:700;font-size:13px;color:#2f6b3f;text-decoration:none;}
      .asm-card-dismiss,.asm-card-undismiss{background:none;border:none;color:#8a948a;font-size:12px;
        text-decoration:underline;cursor:pointer;padding:0;}
      .asm-empty{color:#8a948a;font-size:13px;padding:10px 0;}
    `;
    document.head.appendChild(style);
  }

  /* -------- Κλικ σε στοιχεία της λωρίδας/σελίδας: χειρισμός χωρίς πλήρη ανανέωση της εφαρμογής -------- */

  let delegationBound = false;
  function bindDelegation(){
    if(delegationBound) return;
    delegationBound = true;
    document.addEventListener("click", function(e){
      const el = e.target.closest && e.target.closest("[data-asm-act]");
      if(!el) return;
      const act = el.getAttribute("data-asm-act");

      if(act === "hide-session"){
        try{ sessionStorage.setItem(lsKey("hidden_this_session"), "1"); }catch(err){}
        const strip = el.closest(".asm-strip");
        if(strip) strip.remove();
        return;
      }

      if(act === "not-interested"){
        const id = el.getAttribute("data-asm-id");
        if(!id) return;
        dismissPermanently(id);
        if(chosenApp && chosenApp.id === id) chosenApp = null;
        const strip = el.closest(".asm-strip");
        if(strip){ strip.remove(); return; }
        const actions = el.closest(".asm-card-actions");
        const app = findApp(id);
        if(actions && app) actions.innerHTML = cardActionsHtml(app, true);
        return;
      }

      if(act === "interested-again"){
        const id = el.getAttribute("data-asm-id");
        if(!id) return;
        undismiss(id);
        const actions = el.closest(".asm-card-actions");
        const app = findApp(id);
        if(actions && app) actions.innerHTML = cardActionsHtml(app, false);
        return;
      }
    });
  }

  /* -------- Δημόσιο API -------- */

  function init(options){
    cfg = Object.assign({
      appId: "app",          // μοναδικό αναγνωριστικό ΑΥΤΗΣ της εφαρμογής (ίδιο με το "id" της στη λίστα)
      appTitle: "",
      listUrl: DEFAULT_LIST_URL,
      isPro: false,           // boolean ή συνάρτηση που επιστρέφει boolean
      onDataReady: null       // προαιρετικό: καλείται μόλις φορτωθεί η λίστα, για να ξανασχεδιάσει η εφαρμογή
    }, options || {});
    injectStyles();
    bindDelegation();
    loadList().then(function(){
      if(typeof cfg.onDataReady === "function") cfg.onDataReady();
    });
  }

  return {
    init: init,
    renderStrip: renderStrip,
    renderOurAppsPage: renderOurAppsPage
  };
})();
