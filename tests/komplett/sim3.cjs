const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
module.exports=async(p)=>p.evaluate(async()=>{
 const {db}=await import('/src/db/index.ts'); const bank=await import('/src/logic/bank.ts');
 const out={};
 // doppelte Umsätze in einer Datei + erneuter Import
 const bk=(await db.select("SELECT id FROM bankkonten WHERE name='Hausgeldkonto'"))[0].id;
 const zwei=[{datum:'2025-12-20',betrag:50,verwendungszweck:'Spende Gartenfest',gegenpartei:'Max Muster',gegen_iban:'DE00'},{datum:'2025-12-20',betrag:50,verwendungszweck:'Spende Gartenfest',gegenpartei:'Max Muster',gegen_iban:'DE00'}];
 const kurz=({neu,doppelt})=>({neu,doppelt}); out.erst=kurz(await bank.importieren(bk,zwei)); out.nochmal=kurz(await bank.importieren(bk,zwei));
 // CSV Sparkasse-Format
 const csv='"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"\n"DE12";"03.01.25";"03.01.25";"GUTSCHR. UEBERW.";"Hausgeld 01/2025";"Anna Albrecht";"DE11370501981111111111";"X";"1.250,00";"EUR";"Umsatz gebucht"\n"DE12";"10.01.25";"10.01.25";"LASTSCHRIFT";"Abschlag";"RheinEnergie AG";"DE90";"X";"-40,00";"EUR";"Umsatz gebucht"';
 out.csv=bank.parseCsv(csv);
 // aufräumen: die zwei Spenden-Umsätze wieder löschen
 await db.execute("DELETE FROM bankumsaetze WHERE verwendungszweck='Spende Gartenfest'");
 return out;
});
