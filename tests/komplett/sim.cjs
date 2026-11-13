const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1500,height:1000},locale:'de-DE'}); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:5179/#/'); await p.waitForTimeout(4000);
const xml=fs.readFileSync(__dirname + '/kontoauszug-2025.xml','utf8');
const r=await p.evaluate(async(xml)=>{
 const {db,insert}=await import('/src/db/index.ts'); const soll=await import('/src/logic/soll.ts'); const bank=await import('/src/logic/bank.ts');
 const k=async n=>(await db.select('SELECT id FROM buchungskonten WHERE nummer=$1',[n]))[0].id;
 const o=await insert('objekte',{verwaltungsart:'WEG',name:'WEG Testhaus',strasse:'Teststr. 1',plz:'50667',ort:'Köln',gesamt_mea:1000,gesamt_flaeche:260,ruecklage_anfang:10000,ruecklage_stichtag:'2024-12-31'});
 const E=[['EG links',70,250],['EG rechts',60,200],['1. OG links',80,300],['1. OG rechts',50,250]];
 const eid=[]; for(const [n,f,m] of E) eid.push(await insert('einheiten',{objekt_id:o,nummer:n,flaeche:f,mea:m}));
 const P=[['Anna','Albrecht','DE11370501981111111111'],['Bernd','Brandt','DE22370501982222222222'],['Clara','Conrad','DE33370501983333333333'],['Dieter','Dahm','DE44370501984444444444'],['Eva','Engel','DE55370501985555555555']];
 const pid=[]; for(const [v,n,i] of P) pid.push(await insert('personen',{rolle:'Eigentümer',vorname:v,nachname:n,iban:i,strasse:'Weg 1',plz:'50667',ort:'Köln'}));
 await insert('eigentum',{einheit_id:eid[0],person_id:pid[0],anteil:100,von:'2010-01-01'});
 await insert('eigentum',{einheit_id:eid[1],person_id:pid[1],anteil:100,von:'2010-01-01'});
 await insert('eigentum',{einheit_id:eid[2],person_id:pid[2],anteil:100,von:'2010-01-01'});
 await insert('eigentum',{einheit_id:eid[3],person_id:pid[3],anteil:100,von:'2010-01-01',bis:'2025-06-30'});
 await insert('eigentum',{einheit_id:eid[3],person_id:pid[4],anteil:100,von:'2025-07-01'});
 const HG=[[250,50],[200,40],[300,60],[250,50]];
 for(let i=0;i<4;i++) await insert('hausgeld',{einheit_id:eid[i],gueltig_ab:'2025-01-01',betrag:HG[i][0],davon_ruecklage:HG[i][1]});
 await insert('hausgeld',{einheit_id:eid[0],gueltig_ab:'2025-07-01',betrag:270,davon_ruecklage:50});
 const bk=await insert('bankkonten',{objekt_id:o,name:'Hausgeldkonto',iban:'DE12370501980000123456',anfangssaldo:5000,saldo_datum:'2024-12-31'});
 const f1=await insert('firmen',{name:'Provinzial Versicherung',gewerk:'Versicherung',iban:'DE90370501980005555555'});
 const f2=await insert('firmen',{name:'Sanitaer Rohr GmbH',gewerk:'Sanitär',iban:'DE90370501980006666666'});
 await insert('rechnungen',{objekt_id:o,firma_id:f1,rechnungsnr:'VS-998877',datum:'2025-01-15',betrag:1200,buchungskonto_id:await k('1250')});
 await insert('rechnungen',{objekt_id:o,firma_id:f2,rechnungsnr:'RE-2025-0815',datum:'2025-08-01',betrag:850,buchungskonto_id:await k('1300'),anteil_lohn:500});
 for(const [m,n] of [['RheinEnergie','1214'],['Hausmeister Kurz','1246'],['Verwalterverguetung','1400'],['Grundbesitzabgaben','1220']]) await insert('buchungsregeln',{muster:m,richtung:'Ausgang',buchungskonto_id:await k(n),objekt_id:o});
 const ns=await soll.sollStellen('2025-12',{objektId:o});
 const u=bank.parseDatei('k.xml',xml); const imp=await bank.importieren(bk,u);
 const auto=await bank.automatischZuordnen();
 const offen=await db.select("SELECT u.datum,u.betrag,u.gegenpartei,u.verwendungszweck FROM bankumsaetze u WHERE u.bankkonto_id=$1 AND status='offen'",[bk]);
 const ohneKonto=await db.select("SELECT datum,betrag,text FROM buchungen WHERE objekt_id=$1 AND buchungskonto_id IS NULL",[o]);
 const opk=await db.select(`SELECT person_id,einheit,art,SUM(betrag-bezahlt) AS offen FROM (${soll.OP_SQL}) WHERE objekt_id=$1 AND betrag-bezahlt>0.005 GROUP BY person_id,einheit,art`,[o]);
 return {o,ns,imp,auto,offen,ohneKonto,opk,parsed:u.length};
},xml);
console.log(JSON.stringify(r,null,1)); if(process.env.TEIL2) console.log("TEIL2",JSON.stringify(await require("./sim2.cjs")(p))); if(process.env.TEIL3) console.log("TEIL3",JSON.stringify(await require("./sim3.cjs")(p)));
fs.writeFileSync(AUS + '/state.json',JSON.stringify(await ctx.storageState()));
// Seiten prüfen
const seite=async(pfad,name)=>{await p.goto('http://localhost:5179/#'+pfad);await p.waitForTimeout(2500);
 const sel=p.locator('select').first(); try{ if(await sel.count()){ await sel.selectOption({label:'WEG Testhaus'}).catch(()=>{});} }catch{}
 const j=p.locator('input[type=number]').first(); if(await j.count()){await j.fill('2025');}
 await p.waitForTimeout(2500); await p.screenshot({path:AUS+`/${name}.png`,fullPage:true}); fs.writeFileSync(AUS+`/${name}.txt`,await p.locator('main').innerText().catch(()=>p.innerText('body')));};
await seite('/weg-abrechnung','weg');
if(process.env.UI) console.log("UI",JSON.stringify(await require("./ui.cjs")(p,fs)));
await seite('/auswertung','auswertung');
console.log('ERRS',errs.slice(0,10));
await b.close();})();
