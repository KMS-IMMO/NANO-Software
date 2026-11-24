const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
// Teil 2: Überzahlung von Hand der Person zuordnen, dann Prüfliste und Vermögensbericht ansehen
const { chromium } = require('playwright'); const fs=require('fs');
module.exports=async(p)=>{
 return p.evaluate(async()=>{
 const {db}=await import('/src/db/index.ts'); const bank=await import('/src/logic/bank.ts');
 const u=(await db.select("SELECT * FROM bankumsaetze WHERE status='offen' AND gegenpartei='Clara Conrad'"))[0];
 const pid=(await db.select("SELECT id FROM personen WHERE nachname='Conrad'"))[0].id;
 await bank.zuordnenPerson(u,pid);
 return db.select("SELECT datum,betrag,buchungskonto_id,text FROM buchungen WHERE bankumsatz_id=$1",[u.id]);
 });
};
