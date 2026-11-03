/* Τιμολόγια — τι παίρνει ο παραλήπτης «Μεταφορά στοιχείων» (metafora-lipsi.js) από την παλιά διεύθυνση
   aglentzakis-dot.github.io/Timologia/ → timologia.glenapps.gr.
   © 2026 Ανδρέας Μ. Γλεντζάκης (Andreas M. Glentzakis). Με την επιφύλαξη παντός δικαιώματος. All rights reserved.
   ls   : ρυθμίσεις (μαζί με το αποτύπωμα του κωδικού διαχειριστή και τα κλειδιά τεχνητής νοημοσύνης), τα τοπικά
          τιμολόγια/πληρωμές (όταν δεν υπάρχει κοινός φάκελος), αποθηκευμένες λίστες μοντέλων,
          ρυθμίσεις αντιγράφων («bk_Timologia_») και προτιμήσεις της λωρίδας εφαρμογών («asm_timologia_»).
          ΔΕΝ μεταφέρονται τα «tim_unlocked»/«tim_currentStaff»: στη νέα διεύθυνση ζητείται ξανά ο κωδικός.
   idb  : καμία δική της — η μόνη βάση είναι η κοινή «shared-backups» (δείκτης φακέλου), που ΔΕΝ μεταφέρεται:
          ο κοινός φάκελος (με τα τιμολόγια/πληρωμές ως αρχεία) ξαναδιαλέγεται στη νέα διεύθυνση.
   opfs : καμία — η εφαρμογή δεν χρησιμοποιεί την ιδιωτική μνήμη αρχείων.
   Η εφαρμογή δεν διαβάζει το κοινό κλειδί Pro («glenapps-kleidi»).
   exei : αν εδώ υπάρχουν ήδη τιμολόγια/πληρωμές ή έχει οριστεί κωδικός διαχειριστή. */
window.GLEN_METAFORA={app:"timologia",onoma:"Τιμολόγια",
  ls:["tim_config","tim_invoices_local","tim_payments_local","tim_gemini_models","tim_free_vision_models","bk_Timologia_","asm_timologia_"],
  idb:[],
  opfs:[],
  exei:function(){try{
    var a=["tim_invoices_local","tim_payments_local"].some(function(k){var v=localStorage.getItem(k);if(!v)return false;var d=JSON.parse(v);return Array.isArray(d)&&d.length>0});
    if(a)return true;var c=localStorage.getItem("tim_config");if(!c)return false;c=JSON.parse(c);return!!(c&&c.adminPinS&&c.adminPinH)}catch(e){return true}}};
