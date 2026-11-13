const AUS = process.env.NEOSS_TEST_AUSGABE || require('path').join(__dirname, 'ausgabe'); require('fs').mkdirSync(AUS, { recursive: true });
module.exports=async(p,fs)=>{
 await p.goto('http://localhost:5179/#/weg-abrechnung'); await p.waitForTimeout(2000);
 await p.locator('select').first().selectOption({label:'WEG Testhaus'}); await p.locator('input[type=number]').first().fill('2025'); await p.waitForTimeout(2500);
 await p.getByRole('button',{name:'PDF-Vorschau'}).first().click(); await p.waitForTimeout(4000);
 const src=await p.evaluate(()=>[...document.querySelectorAll('iframe,embed,object')].map(e=>e.src||e.data));
 let pdf=null; if(src[0]) pdf=await p.evaluate(async(u)=>{const b=await (await fetch(u)).arrayBuffer(); return Array.from(new Uint8Array(b));},src[0]);
 if(pdf) fs.writeFileSync(AUS + '/vorschau.pdf',Buffer.from(pdf));
 await p.keyboard.press('Escape'); await p.waitForTimeout(800);
 p.on('dialog',d=>d.accept()); const btn=p.getByRole('button',{name:/Abschluss: abschließen und PDF öffnen/}); await btn.scrollIntoViewIfNeeded(); await btn.click(); await p.waitForTimeout(5000);
 await p.screenshot({path:AUS + '/nach-abschluss.png'});
 const st=await p.evaluate(async()=>{const {db}=await import('/src/db/index.ts'); return db.select('SELECT objekt_id,art,jahr,status FROM abrechnungen');});
 const src2=await p.evaluate(()=>[...document.querySelectorAll('iframe')].map(e=>e.src)); if(src2[0]){const b=await p.evaluate(async(u)=>Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())),src2[0]); fs.writeFileSync(AUS + '/final.pdf',Buffer.from(b));} return {src,pdf:!!pdf,st,src2};
};
