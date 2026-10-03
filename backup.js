/* =========================================================================
   BackupModule — κοινό σύστημα αντιγράφων ασφαλείας, ίδιο σε όλες τις
   εφαρμογές (aglentzakis-dot.github.io). Ένα αρχείο, να αντιγράφεται
   αυτούσιο σε κάθε νέα εφαρμογή — μόνο η κλήση BackupModule.init(...)
   αλλάζει ανά εφαρμογή.

   Προορισμοί: Φάκελος συσκευής (κοινός φάκελος συγχρονισμένος με Google
   Drive, File System Access API), Κοινοποίηση (Web Share API), Αυτόματο
   ανέβασμα στο Google Drive του χρήστη (Google Identity Services, scope
   drive.file — βλέπει ΜΟΝΟ τα δικά του αρχεία), Ηλεκτρονικό ταχυδρομείο
   (Web3Forms).

   Χρήση από την εφαρμογή:
     BackupModule.init({
       appName: "Timologia",                 // όνομα υποφακέλου/αρχείων
       appTitle: "Τιμολόγια Προμηθευτών",     // όνομα για εμφάνιση
       getData: () => ({ ... }),              // επιστρέφει ό,τι θες να σώζεται
       applyData: (obj) => { ... },           // εφαρμόζει δεδομένα επαναφοράς
     });
     BackupModule.checkAutoBackupDue();       // κάλεσέ το στην εκκίνηση
     // Μέσα στις Ρυθμίσεις:  BackupModule.renderButton()  →  HTML κουμπιού
     // που ανοίγει τη δική του οθόνη (sheet) πάνω από οτιδήποτε άλλο.
   ========================================================================= */

(function(global){
  "use strict";

  const DB_NAME = "shared-backups", STORE = "handles", ROOT_KEY = "root";
  const RECENTS_MAX = 10;

  let appName = "App", appTitle = "Εφαρμογή", getData = ()=>({}), applyData = ()=>{};
  let rootHandle = null, open = false;

  function LSK(k){ return "bk_" + appName + "_" + k; }

  function loadCfg(){
    let c = null;
    try{ c = JSON.parse(localStorage.getItem(LSK("cfg"))); }catch(e){}
    return Object.assign({
      destFolder: false, destShare: false, destDrive: false, destEmail: false,
      frequency: "manual", // manual | daily | weekly
      emailTo: "", web3formsKey: "", driveClientId: "",
      lastBackup: null // {when: iso, where: "φάκελο"/"κοινοποίηση"/"Google Drive"/"email"}
    }, c || {});
  }
  function saveCfg(c){ localStorage.setItem(LSK("cfg"), JSON.stringify(c)); }

  /* ---------------- Κοινός φάκελος (ίδια σύμβαση σε όλες τις εφαρμογές) --------------- */

  function idbOpen(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = ()=>{ req.result.createObjectStore(STORE); };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    });
  }
  async function idbGet(key){
    const db = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE,"readonly");
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = ()=>resolve(r.result||null);
      r.onerror = ()=>reject(r.error);
    });
  }
  async function idbSet(key, val){
    const db = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE,"readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
  }

  async function getAppDir(create){
    if(!rootHandle){
      const h = await idbGet(ROOT_KEY);
      if(h){
        const perm = await h.queryPermission({mode:"readwrite"});
        if(perm === "granted") rootHandle = h;
      }
    }
    if(!rootHandle) return null;
    try{ return await rootHandle.getDirectoryHandle(appName, {create: !!create}); }
    catch(e){ return null; }
  }

  async function connectFolder(){
    if(!global.showDirectoryPicker){
      alert("Αυτός ο browser δεν υποστηρίζει κοινό φάκελο.");
      return false;
    }
    try{
      let h = await idbGet(ROOT_KEY);
      if(h){
        const perm = await h.requestPermission({mode:"readwrite"});
        if(perm === "granted") rootHandle = h;
      }
      if(!rootHandle){
        rootHandle = await global.showDirectoryPicker({id:"backups", mode:"readwrite", startIn:"downloads"});
        await idbSet(ROOT_KEY, rootHandle);
      }
      await rootHandle.getDirectoryHandle(appName, {create:true});
      return true;
    }catch(e){ console.error(e); return false; }
  }

  /* ---------------- Το περιεχόμενο του αντιγράφου ---------------- */

  function filenameFor(date){
    const d = date || new Date();
    const iso = d.toISOString().slice(0,10);
    return appName + "_backup_" + iso + ".json";
  }

  async function buildBackupText(password){
    const payload = {
      app: appName, title: appTitle, version: 1,
      createdAt: new Date().toISOString(),
      data: getData()
    };
    const json = JSON.stringify(payload, null, 2);
    if(!password) return {text: json, encrypted:false};
    const enc = await encryptText(json, password);
    return {text: JSON.stringify({encrypted:true, app:appName, payload:enc}), encrypted:true};
  }

  /* ---------------- Προαιρετική κρυπτογράφηση (Web Crypto, AES-GCM) ---------------- */
  /* Ο κωδικός ΔΕΝ αποθηκεύεται πουθενά· ζητείται κάθε φορά που τον χρειαζόμαστε. */

  async function deriveKey(password, salt){
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {name:"PBKDF2", salt, iterations:150000, hash:"SHA-256"},
      baseKey, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]
    );
  }
  function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function unb64(s){ return Uint8Array.from(atob(s), c=>c.charCodeAt(0)); }

  async function encryptText(text, password){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, enc.encode(text));
    return {salt: b64(salt), iv: b64(iv), data: b64(cipher)};
  }
  async function decryptText(enc, password){
    const salt = unb64(enc.salt), iv = unb64(enc.iv), data = unb64(enc.data);
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, data);
    return new TextDecoder().decode(plain);
  }

  /* ---------------- Προορισμοί ---------------- */

  async function backupToFolder(text){
    const dir = await getAppDir(true);
    if(!dir) throw new Error("Δεν είναι συνδεδεμένος κοινός φάκελος.");
    const backups = await dir.getDirectoryHandle("backups", {create:true});
    const fh = await backups.getFileHandle(filenameFor(), {create:true});
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  async function backupToDownload(text){
    const blob = new Blob([text], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filenameFor();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }

  async function backupToShare(text){
    const file = new File([text], filenameFor(), {type:"application/json"});
    if(global.navigator.canShare && global.navigator.canShare({files:[file]})){
      await global.navigator.share({files:[file], title: appTitle + " — αντίγραφο ασφαλείας"});
    } else {
      throw new Error("Η κοινοποίηση αρχείων δεν υποστηρίζεται εδώ.");
    }
  }

  async function backupToEmail(text, cfg){
    if(!cfg.web3formsKey) throw new Error("Λείπει το κλειδί Web3Forms (Ρυθμίσεις αντιγράφων).");
    if(!cfg.emailTo) throw new Error("Δεν έχει οριστεί διεύθυνση παραλήπτη.");
    const sizeKB = new Blob([text]).size / 1024;
    if(sizeKB > 300){
      throw new Error("Το αντίγραφο είναι πολύ μεγάλο για email (" + Math.round(sizeKB) + " KB). Χρησιμοποίησε φάκελο ή κοινοποίηση αντί για email.");
    }
    const resp = await fetch("https://api.web3forms.com/submit", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        access_key: cfg.web3formsKey,
        subject: appTitle + " — αντίγραφο ασφαλείας " + new Date().toLocaleDateString("el-GR"),
        email: cfg.emailTo,
        message: "Συνημμένο το αντίγραφο ασφαλείας σε μορφή κειμένου:\n\n" + text
      })
    });
    const data = await resp.json().catch(()=>({}));
    if(!resp.ok || data.success === false) throw new Error("Απέτυχε η αποστολή email.");
  }

  async function backupToDrive(text, cfg){
    if(!cfg.driveClientId) throw new Error("Λείπει το Google Client ID (Ρυθμίσεις αντιγράφων).");
    const token = await getDriveToken(cfg.driveClientId);
    const boundary = "bk" + Date.now();
    const meta = {name: filenameFor(), mimeType:"application/json"};
    const body =
      "--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+JSON.stringify(meta)+"\r\n"+
      "--"+boundary+"\r\nContent-Type: application/json\r\n\r\n"+text+"\r\n"+
      "--"+boundary+"--";
    const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method:"POST",
      headers:{"Authorization":"Bearer "+token, "Content-Type":"multipart/related; boundary="+boundary},
      body
    });
    if(!resp.ok) throw new Error("Απέτυχε το ανέβασμα στο Google Drive.");
  }

  let driveTokenClient = null, driveTokenCache = null;
  function loadGis(){
    return new Promise((resolve,reject)=>{
      if(global.google && global.google.accounts && global.google.accounts.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = resolve; s.onerror = ()=>reject(new Error("Δεν φορτώθηκε η σύνδεση Google."));
      document.head.appendChild(s);
    });
  }
  async function getDriveToken(clientId){
    if(driveTokenCache && driveTokenCache.exp > Date.now()) return driveTokenCache.token;
    await loadGis();
    return new Promise((resolve,reject)=>{
      driveTokenClient = global.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: (resp)=>{
          if(resp.error) return reject(new Error("Απορρίφθηκε η σύνδεση με το Google Drive."));
          driveTokenCache = {token: resp.access_token, exp: Date.now() + (resp.expires_in-60)*1000};
          resolve(resp.access_token);
        }
      });
      driveTokenClient.requestAccessToken({prompt: driveTokenCache ? "" : "consent"});
    });
  }

  /* ---------------- Λίστα πρόσφατων (για επαναφορά) ---------------- */

  async function recentFromFolder(){
    const dir = await getAppDir(false);
    if(!dir) return [];
    let backups;
    try{ backups = await dir.getDirectoryHandle("backups", {create:false}); }catch(e){ return []; }
    const out = [];
    for await (const [name, handle] of backups.entries()){
      if(handle.kind!=="file" || !name.endsWith(".json")) continue;
      const file = await handle.getFile();
      out.push({name, lastModified: file.lastModified, handle});
    }
    out.sort((a,b)=>b.lastModified - a.lastModified);
    return out.slice(0, RECENTS_MAX);
  }

  async function readRestoreText(handleOrFile){
    if(handleOrFile instanceof File) return handleOrFile.text();
    const file = await handleOrFile.getFile();
    return file.text();
  }

  async function restoreFromText(text, password){
    let obj;
    try{ obj = JSON.parse(text); }catch(e){ throw new Error("Το αρχείο δεν είναι έγκυρο αντίγραφο."); }
    if(obj.encrypted){
      if(!password) throw new Error("NEED_PASSWORD");
      const plain = await decryptText(obj.payload, password);
      obj = JSON.parse(plain);
    }
    if(!obj.data) throw new Error("Το αρχείο δεν περιέχει δεδομένα αντιγράφου.");
    applyData(obj.data);
    return obj;
  }

  /* ---------------- Εκτέλεση αντιγράφου σε όλους τους επιλεγμένους προορισμούς ---------------- */

  async function runBackup(password){
    const cfg = loadCfg();
    const {text} = await buildBackupText(password);
    const results = [];
    const tried = [];
    if(cfg.destFolder){ tried.push("folder"); try{ await backupToFolder(text); results.push("φάκελο"); }catch(e){ results.push("ΑΠΕΤΥΧΕ (φάκελος): "+e.message); } }
    if(cfg.destShare){ tried.push("share"); try{ await backupToShare(text); results.push("κοινοποίηση"); }catch(e){ results.push("ΑΠΕΤΥΧΕ (κοινοποίηση): "+e.message); } }
    if(cfg.destDrive){ tried.push("drive"); try{ await backupToDrive(text, cfg); results.push("Google Drive"); }catch(e){ results.push("ΑΠΕΤΥΧΕ (Drive): "+e.message); } }
    if(cfg.destEmail){ tried.push("email"); try{ await backupToEmail(text, cfg); results.push("email"); }catch(e){ results.push("ΑΠΕΤΥΧΕ (email): "+e.message); } }
    if(!tried.length){ await backupToDownload(text); results.push("λήψη αρχείου"); }
    cfg.lastBackup = {when: new Date().toISOString(), where: results.join(", ")};
    saveCfg(cfg);
    return results;
  }

  function dueByFrequency(cfg){
    if(cfg.frequency === "manual" || !cfg.lastBackup) return cfg.frequency !== "manual" && !cfg.lastBackup;
    const last = new Date(cfg.lastBackup.when);
    const days = (Date.now() - last.getTime()) / 86400000;
    if(cfg.frequency === "daily") return days >= 1;
    if(cfg.frequency === "weekly") return days >= 7;
    return false;
  }

  async function checkAutoBackupDue(){
    const cfg = loadCfg();
    if(cfg.frequency === "manual") return;
    if(!dueByFrequency(cfg)) return;
    if(!(cfg.destFolder || cfg.destDrive)) return; // αυτόματα μόνο σε σιωπηλούς προορισμούς
    try{ await runBackup(null); }catch(e){ console.error(e); }
  }

  /* ---------------- UI ---------------- */

  function renderButton(){
    return `<button class="btn secondary" data-bk-act="open">💾 Αντίγραφα ασφαλείας</button>`;
  }

  function fmtWhen(iso){
    if(!iso) return "ποτέ ακόμη";
    const d = new Date(iso);
    return d.toLocaleDateString("el-GR") + " " + d.toLocaleTimeString("el-GR",{hour:"2-digit",minute:"2-digit"});
  }

  let uiState = {screen:"main", info:null, busy:false, msg:"", restoreList:[], pendingRestoreText:null, pendingRestoreSource:null};

  function overlayEl(){ return document.getElementById("bk-overlay"); }

  function closeUI(){
    const el = overlayEl();
    if(el) el.remove();
    open = false;
  }

  function renderUI(){
    let el = overlayEl();
    if(!el){
      el = document.createElement("div");
      el.id = "bk-overlay";
      el.style.cssText = "position:fixed;inset:0;background:rgba(20,22,20,.5);z-index:999;display:flex;align-items:flex-end;justify-content:center;";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="background:#fff;border-radius:18px 18px 0 0;max-width:720px;width:100%;
      max-height:90vh;overflow-y:auto;padding:18px 18px 26px;font-family:inherit;color:#1f2420;">
      ${uiState.screen==="main" ? mainScreen() : restoreScreen()}
    </div>`;
    el.onclick = (e)=>{ if(e.target===el) closeUI(); };
    el.querySelectorAll("[data-bk-act]").forEach(b=>{
      b.addEventListener("click", (e)=>onUiAction(b.getAttribute("data-bk-act"), b));
    });
  }

  function infoBox(id, text){
    return uiState.info===id ? `<div style="background:#eef3ef;border-radius:8px;padding:8px 10px;font-size:12.5px;margin:4px 0 10px;white-space:pre-line;">${text}</div>` : "";
  }

  function mainScreen(){
    const cfg = loadCfg();
    const s = (k)=>cfg[k] ? "checked" : "";
    return `
    <h2 style="margin:0 0 4px;">Αντίγραφα ασφαλείας</h2>
    <div style="font-size:12px;color:#6b756d;margin-bottom:10px;">Τελευταίο αντίγραφο: ${fmtWhen(cfg.lastBackup && cfg.lastBackup.when)}${cfg.lastBackup ? " — "+escapeAttr(cfg.lastBackup.where) : ""}</div>
    ${uiState.msg ? `<div style="background:#eef3ef;border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:10px;">${escapeAttr(uiState.msg)}</div>` : ""}

    <div style="border:1px solid #dfe2de;border-radius:12px;padding:10px 12px;margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="bk-destFolder" ${s("destFolder")}> Φάκελος στη συσκευή
        <button type="button" data-bk-act="info-folder" style="margin-left:auto;border:none;background:none;color:#2f6f4f;">ⓘ</button>
      </label>
      ${infoBox("folder","Χρησιμοποιεί τον κοινό φάκελο που έχεις ήδη συνδέσει (ή θα σου ζητηθεί να διαλέξεις έναν) — συνήθως έναν φάκελο μέσα στο Google Drive σου που συγχρονίζεται μόνος του. Το αντίγραφο αποθηκεύεται εκεί, σε υποφάκελο με το όνομα της εφαρμογής.\nΠώς το ενεργοποιείς: τσέκαρε το κουτάκι, πάτησε «Αποθήκευση τώρα» — αν δεν έχεις συνδέσει φάκελο, θα σου ζητηθεί μία φορά.\nΠού θα το βρεις μετά: μέσα στον φάκελο που διάλεξες, υποφάκελος της εφαρμογής, υποφάκελος «backups».")}
    </div>

    <div style="border:1px solid #dfe2de;border-radius:12px;padding:10px 12px;margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="bk-destShare" ${s("destShare")}> Κοινοποίηση
        <button type="button" data-bk-act="info-share" style="margin-left:auto;border:none;background:none;color:#2f6f4f;">ⓘ</button>
      </label>
      ${infoBox("share","Ανοίγει το κανονικό μενού κοινοποίησης του κινητού σου — από εκεί διαλέγεις ο ίδιος πού θα πάει το αρχείο: Google Drive, OneDrive, Dropbox, Μηνύματα, ό,τι προτιμάς.\nΠώς το ενεργοποιείς: τσέκαρε το κουτάκι, πάτησε «Αποθήκευση τώρα», και στο μενού που θα ανοίξει διάλεξε πού θα το στείλεις.\nΠού θα το βρεις μετά: εκεί που το έστειλες μέσα από το μενού.")}
    </div>

    <div style="border:1px solid #dfe2de;border-radius:12px;padding:10px 12px;margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="bk-destDrive" ${s("destDrive")}> Αυτόματο ανέβασμα στο Google Drive
        <button type="button" data-bk-act="info-drive" style="margin-left:auto;border:none;background:none;color:#2f6f4f;">ⓘ</button>
      </label>
      ${infoBox("drive","Συνδέεσαι μία φορά με τον λογαριασμό σου Google και η εφαρμογή ανεβάζει μόνη της τα αντίγραφα — βλέπει ΜΟΝΟ τα δικά της αρχεία, τίποτα άλλο από το Drive σου.\nΧρειάζεται ρύθμιση από τον προγραμματιστή μία φορά (Google Client ID). Αν δεν έχει μπει ακόμα, θα σου το πει όταν δοκιμάσεις.\nΠού θα το βρεις μετά: στο Google Drive σου, σε φάκελο της εφαρμογής (τον δημιουργεί μόνη της).")}
      <label style="font-size:12px;color:#6b756d;display:block;margin-top:6px;">Google Client ID (μόνο αν σου το έχει δώσει ο προγραμματιστής)</label>
      <input id="bk-driveClientId" value="${escapeAttr(cfg.driveClientId)}" placeholder="xxxxxxxxxx.apps.googleusercontent.com" style="width:100%;padding:8px;border:1px solid #dfe2de;border-radius:8px;">
    </div>

    <div style="border:1px solid #dfe2de;border-radius:12px;padding:10px 12px;margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="bk-destEmail" ${s("destEmail")}> Ηλεκτρονικό ταχυδρομείο
        <button type="button" data-bk-act="info-email" style="margin-left:auto;border:none;background:none;color:#2f6f4f;">ⓘ</button>
      </label>
      ${infoBox("email","Στέλνει το αντίγραφο στη διεύθυνση email που θα γράψεις. Αν το αντίγραφο είναι πολύ μεγάλο (πάνω από ~300ΚB), θα σου το πει καθαρά και να χρησιμοποιήσεις φάκελο ή κοινοποίηση αντί για email.\nΧρειάζεται ρύθμιση αποστολής (κλειδί Web3Forms) μία φορά από τον προγραμματιστή.")}
      <label style="font-size:12px;color:#6b756d;display:block;margin-top:6px;">Διεύθυνση παραλήπτη</label>
      <input id="bk-emailTo" value="${escapeAttr(cfg.emailTo)}" placeholder="you@example.com" style="width:100%;padding:8px;border:1px solid #dfe2de;border-radius:8px;margin-bottom:6px;">
      <label style="font-size:12px;color:#6b756d;display:block;">Κλειδί αποστολής (Web3Forms — μόνο αν σου το έχει δώσει ο προγραμματιστής)</label>
      <input id="bk-web3key" value="${escapeAttr(cfg.web3formsKey)}" style="width:100%;padding:8px;border:1px solid #dfe2de;border-radius:8px;">
    </div>

    <label style="display:block;font-size:13px;color:#6b756d;margin:10px 0 4px;">Συχνότητα</label>
    <select id="bk-frequency" style="width:100%;padding:10px;border:1px solid #dfe2de;border-radius:8px;">
      <option value="manual" ${cfg.frequency==="manual"?"selected":""}>Χειροκίνητα</option>
      <option value="daily" ${cfg.frequency==="daily"?"selected":""}>Κάθε μέρα (όταν ανοίγει η εφαρμογή)</option>
      <option value="weekly" ${cfg.frequency==="weekly"?"selected":""}>Κάθε εβδομάδα (όταν ανοίγει η εφαρμογή)</option>
    </select>

    <label style="display:block;font-size:13px;color:#6b756d;margin:10px 0 4px;">Κωδικός κρυπτογράφησης (προαιρετικό)</label>
    <input id="bk-password" type="password" placeholder="άσε κενό για χωρίς κρυπτογράφηση" style="width:100%;padding:10px;border:1px solid #dfe2de;border-radius:8px;">
    <div style="font-size:11.5px;color:#a6480f;margin-top:4px;">⚠️ Αν βάλεις κωδικό, ΔΕΝ αποθηκεύεται πουθενά — αν τον ξεχάσεις, το αντίγραφο δεν ανοίγει ποτέ ξανά. Ισχύει μόνο για το αντίγραφο που θα φτιάξεις τώρα, θα τον ξαναζητήσει την επόμενη φορά.</div>

    <div style="height:14px"></div>
    <button data-bk-act="save-cfg" style="width:100%;padding:12px;border-radius:10px;border:1px solid #2f6f4f;background:#2f6f4f;color:#fff;font-weight:600;">Αποθήκευση ρυθμίσεων</button>
    <div style="height:8px"></div>
    <button data-bk-act="backup-now" style="width:100%;padding:12px;border-radius:10px;border:1px solid #2f6f4f;background:#fff;color:#2f6f4f;font-weight:600;">${uiState.busy?"Γίνεται αποθήκευση…":"💾 Αποθήκευση τώρα"}</button>
    <div style="height:8px"></div>
    <button data-bk-act="go-restore" style="width:100%;padding:12px;border-radius:10px;border:1px solid #dfe2de;background:#fff;color:#1f2420;">↺ Επαναφορά από αντίγραφο</button>

    <div style="margin-top:16px;border-top:1px solid #dfe2de;padding-top:12px;font-size:12.5px;color:#6b756d;">
      <b>Ποιο να διαλέξω;</b> Ο φάκελος και η κοινοποίηση δεν χρειάζονται καμία ρύθμιση και δουλεύουν αμέσως — καλό να έχεις τουλάχιστον έναν από τους δύο. Το Google Drive αυτόματο είναι το πιο «άνετο» γιατί δεν σε ρωτάει τίποτα κάθε φορά. Το email είναι καλό σαν δεύτερο, εφεδρικό αντίγραφο σε άλλη τοποθεσία.
    </div>
    <div style="margin-top:10px;font-size:12.5px;color:#6b756d;">
      <b>Συχνές ερωτήσεις</b><br>
      <b>Τι γίνεται αν χάσω το κινητό;</b> Αν έχεις ενεργό έναν προορισμό εκτός κινητού (Drive, email, ή φάκελος σε Drive), τα δεδομένα σου είναι ασφαλή εκεί — κάνε επαναφορά σε νέα συσκευή.<br>
      <b>Βλέπει κάποιος άλλος τα δεδομένα μου;</b> Όχι· πάνε μόνο εκεί που εσύ διάλεξες (τον δικό σου φάκελο/λογαριασμό/email).<br>
      <b>Τι γίνεται αν ξεχάσω τον κωδικό κρυπτογράφησης;</b> Δυστυχώς δεν υπάρχει τρόπος ανάκτησης — το αντίγραφο γίνεται μη αναστρέψιμα μη αναγνώσιμο.<br>
      <b>Γιατί δεν ήρθε το email;</b> Έλεγξε τα ανεπιθύμητα, ή ότι το αντίγραφο δεν ξεπερνά το όριο μεγέθους.
    </div>
    <div style="height:10px"></div>
    <button data-bk-act="close" style="width:100%;padding:10px;border-radius:10px;border:1px solid #dfe2de;background:#fff;color:#1f2420;">Κλείσιμο</button>`;
  }

  function restoreScreen(){
    const items = uiState.restoreList;
    return `
    <h2 style="margin:0 0 10px;">Επαναφορά</h2>
    <p style="font-size:13px;color:#6b756d;">⚠️ Η επαναφορά αντικαθιστά τα τρέχοντα δεδομένα της εφαρμογής. Διάλεξε πηγή:</p>
    <div style="position:relative;margin-bottom:10px;">
      <button style="width:100%;padding:12px;border-radius:10px;border:1px solid #dfe2de;background:#fff;">📂 Επιλογή αρχείου από τη συσκευή</button>
      <input type="file" accept=".json" id="bk-restore-file" style="position:absolute;inset:0;opacity:0;cursor:pointer;">
    </div>
    ${items.length ? `<div style="font-size:13px;color:#6b756d;margin:10px 0 6px;">Ή από τον κοινό φάκελο:</div>
    ${items.map((it,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #eee;">
      <div>${escapeAttr(it.name)} ${i===0?'<span style="background:#eef3ef;color:#2f6f4f;border-radius:999px;padding:2px 8px;font-size:11px;margin-left:6px;">νεότερο</span>':""}</div>
      <button data-bk-act="restore-pick" data-i="${i}" style="padding:7px 12px;border-radius:8px;border:1px solid #2f6f4f;background:#fff;color:#2f6f4f;">Επαναφορά</button>
    </div>`).join("")}` : `<div style="font-size:13px;color:#6b756d;">Δεν βρέθηκαν αντίγραφα στον κοινό φάκελο.</div>`}

    ${uiState.pendingRestoreText ? `
    <div style="margin-top:14px;padding:10px;border:1px solid #dfe2de;border-radius:10px;">
      <label style="font-size:12px;color:#6b756d;display:block;">Αν το αντίγραφο έχει κωδικό κρυπτογράφησης, γράψ' τον:</label>
      <input id="bk-restore-pass" type="password" style="width:100%;padding:8px;border:1px solid #dfe2de;border-radius:8px;margin:6px 0;">
      <button data-bk-act="restore-confirm" style="width:100%;padding:10px;border-radius:8px;border:1px solid #2f6f4f;background:#2f6f4f;color:#fff;">Επιβεβαίωση επαναφοράς</button>
    </div>` : ""}

    ${uiState.msg ? `<div style="margin-top:10px;background:#eef3ef;border-radius:8px;padding:8px 10px;font-size:13px;">${escapeAttr(uiState.msg)}</div>` : ""}

    <div style="margin-top:14px;border-top:1px solid #dfe2de;padding-top:10px;font-size:12.5px;color:#6b756d;">
      <b>Οδηγός για νέο κινητό ή μετά από καθαρισμό δεδομένων:</b> άνοιξε την εφαρμογή στη νέα συσκευή, μπες εδώ στα «Αντίγραφα ασφαλείας → Επαναφορά» και διάλεξε το πιο πρόσφατο αντίγραφο — από αρχείο αν το έστειλες με email/κοινοποίηση, ή από τον κοινό φάκελο αν έχεις πρόσβαση σε αυτόν από τη νέα συσκευή.
    </div>
    <div style="height:10px"></div>
    <button data-bk-act="back-main" style="width:100%;padding:10px;border-radius:10px;border:1px solid #dfe2de;background:#fff;">← Πίσω</button>`;
  }

  function escapeAttr(s){
    return (s==null?"":String(s)).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  async function onUiAction(act, el){
    if(act === "close"){ closeUI(); return; }
    if(act.startsWith("info-")){
      const id = act.slice(5);
      uiState.info = uiState.info===id ? null : id;
      renderUI(); return;
    }
    if(act === "save-cfg"){
      const cfg = loadCfg();
      cfg.destFolder = document.getElementById("bk-destFolder").checked;
      cfg.destShare = document.getElementById("bk-destShare").checked;
      cfg.destDrive = document.getElementById("bk-destDrive").checked;
      cfg.destEmail = document.getElementById("bk-destEmail").checked;
      cfg.driveClientId = document.getElementById("bk-driveClientId").value.trim();
      cfg.emailTo = document.getElementById("bk-emailTo").value.trim();
      cfg.web3formsKey = document.getElementById("bk-web3key").value.trim();
      cfg.frequency = document.getElementById("bk-frequency").value;
      saveCfg(cfg);
      if(cfg.destFolder) await connectFolder();
      uiState.msg = "Οι ρυθμίσεις αποθηκεύτηκαν.";
      renderUI(); return;
    }
    if(act === "backup-now"){
      uiState.busy = true; uiState.msg=""; renderUI();
      const password = document.getElementById("bk-password").value;
      try{
        const results = await runBackup(password || null);
        uiState.msg = "Έγινε: " + results.join(", ");
      }catch(e){ uiState.msg = "Σφάλμα: " + e.message; }
      uiState.busy = false; renderUI(); return;
    }
    if(act === "go-restore"){
      uiState.screen = "restore"; uiState.msg=""; uiState.pendingRestoreText=null;
      uiState.restoreList = await recentFromFolder();
      renderUI();
      bindRestoreFileInput();
      return;
    }
    if(act === "back-main"){ uiState.screen="main"; uiState.msg=""; renderUI(); return; }
    if(act === "restore-pick"){
      const i = Number(el.getAttribute("data-i"));
      const item = uiState.restoreList[i];
      try{
        uiState.pendingRestoreText = await readRestoreText(item.handle);
        uiState.pendingRestoreSource = item.name;
      }catch(e){ uiState.msg = "Δεν ήταν δυνατή η ανάγνωση."; }
      renderUI(); return;
    }
    if(act === "restore-confirm"){
      const pass = document.getElementById("bk-restore-pass").value;
      try{
        await restoreFromText(uiState.pendingRestoreText, pass || null);
        uiState.msg = "Η επαναφορά έγινε.";
        uiState.pendingRestoreText = null;
        setTimeout(()=>{ closeUI(); location.reload(); }, 900);
      }catch(e){
        uiState.msg = e.message === "NEED_PASSWORD" ? "Αυτό το αντίγραφο έχει κωδικό — γράψ' τον." : ("Σφάλμα: " + e.message);
      }
      renderUI(); return;
    }
  }

  function bindRestoreFileInput(){
    const input = document.getElementById("bk-restore-file");
    if(!input) return;
    input.addEventListener("change", async (e)=>{
      const file = e.target.files[0];
      if(!file) return;
      try{
        uiState.pendingRestoreText = await readRestoreText(file);
        uiState.pendingRestoreSource = file.name;
      }catch(err){ uiState.msg = "Δεν ήταν δυνατή η ανάγνωση του αρχείου."; }
      renderUI();
      bindRestoreFileInput();
    });
  }

  function openUI(){
    uiState = {screen:"main", info:null, busy:false, msg:"", restoreList:[], pendingRestoreText:null, pendingRestoreSource:null};
    open = true;
    renderUI();
  }

  global.BackupModule = {
    init(opts){
      appName = opts.appName || appName;
      appTitle = opts.appTitle || appTitle;
      getData = opts.getData || getData;
      applyData = opts.applyData || applyData;
    },
    renderButton,
    checkAutoBackupDue,
    open: openUI
  };

  // Ένα γενικό άκουσμα κλικ, ώστε το κουμπί renderButton() να δουλεύει
  // μόλις μπει στη σελίδα της εφαρμογής, χωρίς επιπλέον σύνδεση event.
  document.addEventListener("click", (e)=>{
    const b = e.target.closest && e.target.closest('[data-bk-act="open"]');
    if(b) openUI();
  });

})(window);
