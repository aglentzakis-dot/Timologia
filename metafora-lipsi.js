/*
  GlenApps — παραλήπτης «Μεταφορά στοιχείων» (κοινό αρχείο, ίδιο σε όλες τις εφαρμογές)
  © 2026 Ανδρέας Μ. Γλεντζάκης (Andreas M. Glentzakis). Με την επιφύλαξη παντός δικαιώματος. All rights reserved.

  Τι κάνει: όταν μια εφαρμογή μετακομίσει από την παλιά κοινή διεύθυνση (aglentzakis-dot.github.io/...) στη δική της
  (π.χ. tameia.glenapps.gr), παίρνει τα στοιχεία της από τη σελίδα «Μεταφορά στοιχείων» της παλιάς διεύθυνσης.

  Πώς τη βάζεις σε μια εφαρμογή (πριν από αυτό το αρχείο):
    <script>window.GLEN_METAFORA={app:"tameia",onoma:"Ταμεία",ls:["tameia-","glen-tameia-"],idb:[],opfs:[]};</script>
    <script src="metafora-lipsi.js"></script>
  ls   : κλειδιά της τοπικής μνήμης (ακριβές όνομα ή αρχή ονόματος) που ανήκουν ΜΟΝΟ σε αυτή την εφαρμογή
  idb  : ονόματα βάσεων IndexedDB της εφαρμογής
  opfs : αρχές ονομάτων αρχείων στην ιδιωτική μνήμη αρχείων (OPFS)
  Αν η εφαρμογή έχει κανόνα ασφαλείας με αποτυπώματα, το GLEN_METAFORA μπαίνει σε δικό της αρχείο (όχι ενσωματωμένο).

  Ασφάλεια:
  • Δέχεται μηνύματα ΜΟΝΟ από https://aglentzakis-dot.github.io και ΜΟΝΟ από το παράθυρο που την άνοιξε.
  • Δέχεται ΜΟΝΟ ό,τι ζήτησε η ίδια (τα ls/idb/opfs παραπάνω) — τίποτα άλλο δεν γράφεται.
  • Δεν γράφει τίποτα χωρίς επιβεβαίωση του χρήστη· ό,τι υπήρχε ήδη φυλάγεται πρώτα («metafora-prin:…»).
  • Ενεργή μόνο με το «#glenapps-metafora» στη διεύθυνση και μόνο έως την ημερομηνία ΛΗΞΗ.
*/
(function(){
  "use strict";
  var GEFYRA="https://aglentzakis-dot.github.io", LIXI="2027-06-30", cfg=window.GLEN_METAFORA;
  if(!cfg||!cfg.app||location.hash!=="#glenapps-metafora")return;
  try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}
  if(new Date().toISOString().slice(0,10)>LIXI)return;
  var LS=(cfg.ls||[]).filter(function(x){return typeof x==="string"&&x.length>1}),
      IDB=(cfg.idb||[]).filter(function(x){return typeof x==="string"&&x}),
      OPFS=(cfg.opfs||[]).filter(function(x){return typeof x==="string"&&x});
  var lsOk=function(k){return typeof k==="string"&&LS.some(function(p){return k===p||k.indexOf(p)===0})};
  var opfsOk=function(p){return typeof p==="string"&&p.indexOf("..")<0&&OPFS.some(function(x){return p.indexOf(x)===0})};
  var onoma=cfg.onoma||cfg.app;

  // ---------- οθόνη (δική της, πάνω από την εφαρμογή· στυλ μόνο με CSSOM ώστε να περνά κάθε κανόνα ασφαλείας) ----------
  var box,msg,btns;
  function css(el,o){for(var k in o)el.style[k]=o[k];return el}
  function el(t,o,txt){var e=document.createElement(t);if(o)css(e,o);if(txt!=null)e.textContent=txt;return e}
  function ui(){if(box)return;
    box=el("div",{position:"fixed",inset:"0",zIndex:"2147483646",background:"rgba(10,20,35,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",fontFamily:"system-ui,sans-serif"});
    var card=el("div",{background:"#fff",color:"#1B2E45",borderRadius:"16px",maxWidth:"440px",width:"100%",padding:"20px",boxShadow:"0 10px 40px rgba(0,0,0,.35)",lineHeight:"1.45"});
    card.appendChild(el("div",{fontSize:"18px",fontWeight:"800",marginBottom:"8px"},"📦 Μεταφορά στοιχείων · "+onoma));
    msg=el("div",{fontSize:"15px",whiteSpace:"pre-line"});card.appendChild(msg);
    btns=el("div",{display:"flex",gap:"8px",marginTop:"16px",flexWrap:"wrap"});card.appendChild(btns);
    box.appendChild(card);(document.body||document.documentElement).appendChild(box)}
  function say(t){ui();msg.textContent=t}
  function btn(t,main,fn){var b=el("button",{flex:"1",minWidth:"120px",padding:"12px",borderRadius:"10px",border:main?"0":"1px solid #c9d2dc",background:main?"#F2B632":"#fff",color:"#1B2E45",fontSize:"15px",fontWeight:"700",cursor:"pointer"},t);b.type="button";b.onclick=fn;btns.appendChild(b);return b}
  function clearBtns(){if(btns)btns.textContent=""}
  function close(reload){if(box)box.remove();box=null;if(reload)location.replace(location.pathname)}
  function pl(n,a,b){return n+" "+(n===1?a:b)}
  function kb(n){return n>=1048576?(Math.round(n/104857.6)/10)+" MB":Math.max(1,Math.round(n/1024))+" KB"}

  // ---------- συλλογή όσων φτάνουν ----------
  var IN={ls:{},idb:{},opfs:[]},bytes=0,src=null,done=false;
  function addLs(items){if(!items||typeof items!=="object")return;for(var k in items){if(lsOk(k)&&typeof items[k]==="string"){IN.ls[k]=items[k];bytes+=items[k].length*2}}}
  function addIdbSchema(d){if(!d||IDB.indexOf(d.name)<0||!Array.isArray(d.stores))return;IN.idb[d.name]={version:Math.max(1,+d.version||1),stores:d.stores,recs:{}}}
  function addIdbRecs(d){var x=d&&IN.idb[d.name];if(!x||typeof d.store!=="string"||!Array.isArray(d.recs))return;(x.recs[d.store]=x.recs[d.store]||[]).push.apply(x.recs[d.store],d.recs)}
  function addOpfs(d){if(d&&opfsOk(d.path)&&d.blob instanceof Blob){IN.opfs.push({path:d.path,blob:d.blob});bytes+=d.blob.size}}
  function count(){var n=Object.keys(IN.ls).length,r=0;for(var k in IN.idb)for(var s in IN.idb[k].recs)r+=IN.idb[k].recs[s].length;return{ls:n,idb:r,opfs:IN.opfs.length}}

  // ---------- εγγραφή ----------
  function lsWrite(){var pire=[];for(var k in IN.ls){try{var old=localStorage.getItem(k);if(old!=null&&old!==IN.ls[k])localStorage.setItem("metafora-prin:"+k,old);localStorage.setItem(k,IN.ls[k]);pire.push(k)}catch(e){throw new Error("Δεν χωράει στη μνήμη του κινητού: "+k)}}return pire}
  function idbOpen(name,ver,up){return new Promise(function(res,rej){var r=ver?indexedDB.open(name,ver):indexedDB.open(name);r.onupgradeneeded=function(){if(up)up(r.result,r.transaction)};r.onsuccess=function(){res(r.result)};r.onerror=function(){rej(r.error)};r.onblocked=function(){rej(new Error("Κλείσε τα άλλα παράθυρα της εφαρμογής και ξαναδοκίμασε."))}})}
  function mkStores(db,tx,stores){stores.forEach(function(s){var st;if(!db.objectStoreNames.contains(s.name)){var o={};if(s.keyPath!=null)o.keyPath=s.keyPath;if(s.autoIncrement)o.autoIncrement=true;st=db.createObjectStore(s.name,o)}else st=tx.objectStore(s.name);
    (s.indexes||[]).forEach(function(i){if(!st.indexNames.contains(i.name))st.createIndex(i.name,i.keyPath,{unique:!!i.unique,multiEntry:!!i.multiEntry})})})}
  async function idbWrite(){var pire=[];
    for(var name in IN.idb){var x=IN.idb[name],db=await idbOpen(name);var missing=x.stores.some(function(s){return!db.objectStoreNames.contains(s.name)});
      if(missing||db.version<x.version){var v=Math.max(db.version+(missing?1:0),x.version);db.close();db=await idbOpen(name,v,function(d,tx){mkStores(d,tx,x.stores)})}
      for(var s in x.recs){var info=x.stores.filter(function(z){return z.name===s})[0]||{};var recs=x.recs[s];
        for(var i=0;i<recs.length;i+=200){var part=recs.slice(i,i+200);
          await new Promise(function(res,rej){var t=db.transaction(s,"readwrite"),o=t.objectStore(s);part.forEach(function(kv){if(info.keyPath!=null)o.put(kv[1]);else o.put(kv[1],kv[0])});t.oncomplete=res;t.onerror=function(){rej(t.error)};t.onabort=function(){rej(t.error||new Error("abort"))}})}}
      db.close();pire.push(name)}
    return pire}
  async function opfsWrite(){var pire=[];if(!IN.opfs.length)return pire;var root=await navigator.storage.getDirectory();
    for(var i=0;i<IN.opfs.length;i++){var f=IN.opfs[i],parts=f.path.split("/").filter(Boolean),dir=root;
      for(var j=0;j<parts.length-1;j++)dir=await dir.getDirectoryHandle(parts[j],{create:true});
      var h=await dir.getFileHandle(parts[parts.length-1],{create:true}),w=await h.createWritable();await w.write(f.blob);await w.close();pire.push(f.path)}
    return pire}
  function exists(){if(typeof cfg.exei==="function"){try{return cfg.exei()?1:0}catch(e){}}var n=0;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(lsOk(k)&&k.indexOf("metafora-prin:")<0)n++}}catch(e){}return n}

  async function apply(){clearBtns();say("Αποθήκευση…");
    try{var p={ls:lsWrite(),idb:await idbWrite(),opfs:await opfsWrite()};
      // η εφαρμογή που τρέχει από κάτω δεν πρέπει να ξαναγράψει τα δικά της (άδεια) στοιχεία πάνω στα μεταφερμένα πριν ξανανοίξει
      try{var orig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===window.localStorage&&lsOk(k))return;return orig.apply(this,arguments)}}catch(e){}
      if(src)src.postMessage({glenapps:"metafora",typos:"ok",app:cfg.app,pire:p},GEFYRA);
      say("✓ Τα στοιχεία των «"+onoma+"» ήρθαν εδώ.\n\nΗ εφαρμογή θα ξανανοίξει. Μετά, στη σελίδα «Μεταφορά στοιχείων», μπορείς να σβήσεις τα παλιά.");
      clearBtns();btn("Άνοιγμα",true,function(){close(true)})}
    catch(e){if(src)src.postMessage({glenapps:"metafora",typos:"lathos",app:cfg.app,lathos:String(e&&e.message||e)},GEFYRA);
      say("⚠ Η μεταφορά δεν ολοκληρώθηκε: "+(e&&e.message||e)+"\n\nΤα παλιά στοιχεία δεν πειράχτηκαν. Δοκίμασε ξανά από τη σελίδα «Μεταφορά στοιχείων».");clearBtns();btn("Κλείσιμο",false,function(){close(false)})}}
  function ask(){var c=count();if(!c.ls&&!c.idb&&!c.opfs){say("Δεν βρέθηκαν στοιχεία των «"+onoma+"» στην παλιά διεύθυνση.");clearBtns();btn("Κλείσιμο",false,function(){close(false)});
      if(src)src.postMessage({glenapps:"metafora",typos:"akyro",app:cfg.app,keno:1},GEFYRA);return}
    var ex=exists();
    say("Ήρθαν από την παλιά διεύθυνση: "+[c.ls?pl(c.ls,"στοιχείο","στοιχεία")+" ρυθμίσεων και δεδομένων":"",c.idb?pl(c.idb,"εγγραφή","εγγραφές"):"",c.opfs?pl(c.opfs,"αρχείο","αρχεία"):""].filter(Boolean).join(", ")+" ("+kb(bytes)+").\n\n"+
      (ex?"⚠ Εδώ υπάρχουν ήδη στοιχεία. Θα αντικατασταθούν· τα τωρινά φυλάγονται πρώτα σε αντίγραφο μέσα στο κινητό.\n\n":"")+"Να αποθηκευτούν εδώ;");
    clearBtns();btn("Αποθήκευση",true,apply);btn("Άκυρο",false,function(){if(src)src.postMessage({glenapps:"metafora",typos:"akyro",app:cfg.app},GEFYRA);close(false)})}

  // ---------- 1) από τη σελίδα «Μεταφορά στοιχείων» (παράθυρο που μας άνοιξε) ----------
  window.addEventListener("message",function(ev){
    if(ev.origin!==GEFYRA||!window.opener||ev.source!==window.opener||done)return;var d=ev.data;
    if(!d||d.glenapps!=="metafora"||d.app!==cfg.app)return;src=ev.source;
    if(d.typos==="ls")addLs(d.items);else if(d.typos==="idb")addIdbSchema(d);else if(d.typos==="idbrec")addIdbRecs(d);else if(d.typos==="opfs")addOpfs(d);
    else if(d.typos==="arxi")say("Λήψη στοιχείων…");else if(d.typos==="telos"){done=true;ask()}});
  function ready(){ui();say("Σύνδεση με την παλιά διεύθυνση…");
    if(window.opener){try{window.opener.postMessage({glenapps:"metafora",typos:"etoimos",app:cfg.app,thelo:{ls:LS,idb:IDB,opfs:OPFS}},GEFYRA)}catch(e){}}
    setTimeout(function(){if(!src&&!done)fileMode()},window.opener?15000:0)}

  // ---------- 2) εναλλακτικά: από «αρχείο μεταφοράς» ----------
  function b64blob(o){var bin=atob(o.b64),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new Blob([u],{type:o.type||""})}
  function revive(v){if(v&&typeof v==="object"){if(v.__blob&&typeof v.__blob.b64==="string")return b64blob(v.__blob);if(v.__date)return new Date(v.__date);
      if(Array.isArray(v))return v.map(revive);var o={};for(var k in v)o[k]=revive(v[k]);return o}return v}
  async function fromFile(file){try{var j=JSON.parse(await file.text());
      if(!j||j.glenapps!=="metafora-arxeio"||j.app!==cfg.app){say("⚠ Αυτό δεν είναι αρχείο μεταφοράς των «"+onoma+"».");return}
      IN={ls:{},idb:{},opfs:[]};bytes=file.size;addLs(j.ls);(j.idb||[]).forEach(function(d){addIdbSchema(d);for(var s in (d.recs||{}))addIdbRecs({name:d.name,store:s,recs:revive(d.recs[s])})});
      (j.opfs||[]).forEach(function(f){addOpfs({path:f.path,blob:b64blob(f)})});done=true;ask()}catch(e){say("⚠ Το αρχείο δεν διαβάζεται.")}}
  function fileMode(){ui();say("Δεν ήρθε απάντηση από τη σελίδα «Μεταφορά στοιχείων».\n\nΑν εκεί πάτησες «Αρχείο μεταφοράς», διάλεξε το αρχείο εδώ.");clearBtns();
    var inp=el("input");inp.type="file";inp.accept=".json,application/json";inp.style.display="none";inp.onchange=function(){if(inp.files[0])fromFile(inp.files[0])};box.appendChild(inp);
    btn("Διάλεξε αρχείο",true,function(){inp.click()});btn("Κλείσιμο",false,function(){close(false)})}
  window.GlenMetafora={arxeio:fromFile};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ready);else ready();
})();
