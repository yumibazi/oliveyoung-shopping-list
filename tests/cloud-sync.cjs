const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://local').pathname;const p=path.join(root,file==='/'?'index.html':file);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(p));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const rows=new Map();let offline=false;const errors=[];
async function device(){const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.route('https://**/*',async r=>{const u=new URL(r.request().url());if(!u.hostname.endsWith('.supabase.co'))return r.abort();if(offline)return r.abort();const body=r.request().postDataJSON();let data;const uid=r.request().headers().authorization?.replace('Bearer token-','');
 if(u.pathname==='/auth/v1/token'){const id=body.email?.startsWith('other')?'other':'owner';data={access_token:'token-'+id,refresh_token:'refresh-'+id,expires_at:Date.now()/1000+3600,user:{id,email:body.email}};}
 else if(u.pathname==='/auth/v1/user')data={id:uid,email:uid+'@test.invalid'};
 else if(u.pathname==='/auth/v1/logout')data={};
 else if(u.pathname==='/rest/v1/shopping_sync')data=rows.has(uid)?[rows.get(uid)]:[];
 else if(u.pathname==='/rest/v1/rpc/save_shopping_sync'){const prev=rows.get(uid);if((prev?.version||0)!==body.expected_version)data=[];else{const row={user_id:uid,data:Object.fromEntries(Object.entries(body.next_data).sort(([a],[b])=>a.localeCompare(b))),version:(prev?.version||0)+1};rows.set(uid,structuredClone(row));data=[row];}}
 else return r.fulfill({status:404,json:{message:'not found'}});return r.fulfill({json:data});});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);return p;}
async function login(p,email='owner@test.invalid'){await p.locator('#sync-account').click();await p.locator('#sync-email').fill(email);await p.locator('#sync-password').fill('testing12345');await p.locator('#sync-login').click();await p.waitForFunction(()=>window.ShoppingSync?.signedIn);await p.waitForFunction(()=>document.querySelectorAll('.purchase-toggle').length===22);}
async function eventually(fn){for(let i=0;i<60;i++){try{await fn();return;}catch(e){if(i===59)throw e;await new Promise(r=>setTimeout(r,200));}}}
try{const a=await device();assert.equal(await a.locator('#sync-account').count(),1,'Account sync entry must exist');await login(a);const b=await device();await login(b);
await a.locator('[data-id="0"] .purchase-toggle').click();await eventually(async()=>assert(rows.get('owner')?.data['oliveyoung-purchased-v1']?.includes('0')));await eventually(async()=>assert.equal(await b.locator('[data-id="0"] .purchase-toggle').getAttribute('aria-pressed'),'true'));
console.log('PASS two-device purchased state sync');
// Offline writes survive reload and upload after reconnection.
offline=true;await a.locator('[data-id="1"] .purchase-toggle').click();await a.reload();await a.waitForFunction(()=>document.querySelectorAll('.purchase-toggle').length===22);assert.equal(await a.locator('[data-id="1"] .purchase-toggle').getAttribute('aria-pressed'),'true');offline=false;await a.evaluate(()=>window.dispatchEvent(new Event('online')));await eventually(async()=>assert(rows.get('owner').data['oliveyoung-purchased-v1'].includes('1')));console.log('PASS offline outbox survives reload');
const c=await device();await login(c,'other@test.invalid');assert.equal(await c.locator('[data-id="0"] .purchase-toggle').getAttribute('aria-pressed'),'false');console.log('PASS different account isolation');
// Live notes and custom products are synchronized, including across store switches.
await a.locator('[data-id="0"] .note-add').click();await a.locator('[data-id="0"] .note-editor input').fill('同步备注测试');await a.locator('[data-id="0"] .note-save').click();
await eventually(async()=>assert(await b.locator('[data-id="0"] .note-rail').textContent().then(t=>t.includes('同步备注测试'))));
await a.goto(base+'/?store=daiso');await a.locator('.add-item').first().click();await a.locator('[name=name]').fill('DAISO 同步测试');await a.locator('[name=url]').fill('https://www.daisomall.co.kr/');await a.locator('#add-form [type=submit]').click();
await eventually(async()=>assert(rows.get('owner').data['korea-shopping-daiso-custom-20260915-v1']?.includes('DAISO 同步测试')));
await b.goto(base+'/?store=daiso');await b.waitForFunction(()=>document.querySelectorAll('[data-id^="custom-"]').length===1);assert.equal(await b.locator('[data-id^="custom-"] h2').textContent(),'DAISO 同步测试');
await a.locator('#manage-items').click();await a.locator('.select-item').check();await a.locator('#delete-selected').click();
await eventually(async()=>assert.equal(await b.locator('article.card').count(),0));
console.log('PASS notes, new products, cross-store data and deletion sync');
// An incoming update must not reload an unfinished note editor.
await a.goto(base);await b.goto(base);await b.locator('[data-id="4"] .note-add').click();await b.locator('[data-id="4"] .note-editor input').fill('尚未提交的备注');
await a.locator('[data-id="4"] .purchase-toggle').click();await eventually(async()=>assert(rows.get('owner').data['oliveyoung-purchased-v1'].includes('4')));
await new Promise(r=>setTimeout(r,5500));assert.equal(await b.locator('[data-id="4"] .note-editor input').inputValue(),'尚未提交的备注');await b.locator('[data-id="4"] .note-cancel').click();await eventually(async()=>assert.equal(await b.locator('[data-id="4"] .purchase-toggle').getAttribute('aria-pressed'),'true'));console.log('PASS remote update waits for unfinished editor');
// Concurrent offline changes must not silently overwrite each other.
await a.goto(base);await b.goto(base);await a.waitForFunction(()=>document.querySelectorAll('.purchase-toggle').length===22);await b.waitForFunction(()=>document.querySelectorAll('.purchase-toggle').length===22);
offline=true;await a.locator('[data-id="2"] .purchase-toggle').click();await b.locator('[data-id="3"] .purchase-toggle').click();offline=false;await a.evaluate(()=>window.dispatchEvent(new Event('online')));await b.evaluate(()=>window.dispatchEvent(new Event('online')));
await eventually(async()=>assert((await a.locator('#sync-status').textContent()).includes('也修改')||(await b.locator('#sync-status').textContent()).includes('也修改')));
const conflicted=(await a.locator('#sync-status').textContent()).includes('也修改')?a:b;await conflicted.locator('#sync-account').click();assert(await conflicted.locator('#sync-conflict').isVisible());conflicted.once('dialog',d=>d.accept());await conflicted.locator('#sync-use-cloud').click();await conflicted.waitForFunction(()=>document.querySelectorAll('.purchase-toggle').length===22);console.log('PASS conflicting edits require an explicit choice');
// Guest state is imported only by explicit action; original guest keys remain intact.
await c.evaluate(()=>localStorage.setItem('oliveyoung-purchased-v1','["5"]'));await c.locator('#sync-account').click();c.once('dialog',d=>d.accept());await c.locator('#sync-import').click();await c.waitForFunction(()=>document.querySelectorAll('.purchase-toggle').length===22);await eventually(async()=>assert(rows.get('other').data['oliveyoung-purchased-v1']?.includes('5')));assert.equal(await c.evaluate(()=>localStorage.getItem('oliveyoung-purchased-v1')),'["5"]');console.log('PASS explicit migration keeps original local copy');
if(process.env.SYNC_SCREENSHOT)await c.screenshot({path:process.env.SYNC_SCREENSHOT});
assert.deepEqual(errors,[]);assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
