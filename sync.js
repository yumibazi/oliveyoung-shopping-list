/* Same-account sync. The publishable key is public; authorization is enforced by RLS. */
(() => {
'use strict';
const URL_BASE='https://jycsvwtynqkyhourttdu.supabase.co';
const API_KEY='sb_publishable_xGuIUtxUEM6nhgRisGqbog_USaaH_9a';
const AUTH_KEY='korea-shopping-auth-v1', CACHE_PREFIX='korea-shopping-cloud-v1:';
const allowed=k=>/^(oliveyoung|korea-shopping-(daiso|nyunyu))-(sort-20260915-v1|custom-20260915-v1|purchased-v1|deletions-v1|daiso-defaults-to-backup-v1|note-tags-v[23]:.+|note-v1:.+)$/.test(k);
const native=window.localStorage;
if(new URLSearchParams(location.hash.slice(1)).has('access_token'))history.replaceState(null,'',location.pathname+location.search);
const readJSON=(k,fallback)=>{try{return JSON.parse(native.getItem(k))??fallback;}catch{return fallback;}};
function validData(data){return data&&typeof data==='object'&&!Array.isArray(data)&&Object.entries(data).every(([k,v])=>allowed(k)&&typeof v==='string');}
const equalData=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);
let session=readJSON(AUTH_KEY,null), record={version:0,data:{},dirty:false}, busy=false, conflict=null, refreshTask=null, timer, suspended=false;
if(!session?.user?.id||!session.access_token)session=null;
const account=document.querySelector('#sync-account'), status=document.querySelector('#sync-status'), dialog=document.querySelector('#sync-dialog');
const authForm=document.querySelector('#sync-form'), detail=document.querySelector('#sync-detail'), error=document.querySelector('#sync-error');
const loginArea=document.querySelector('#sync-login-area'), memberArea=document.querySelector('#sync-member-area');
const importButton=document.querySelector('#sync-import'), resolveArea=document.querySelector('#sync-conflict');
let safeToReload=()=>!document.querySelector('dialog[open]'), uiReady=false, reloadWanted=false;
function say(message){status.textContent=message;detail.textContent=message;}
function cacheKey(){return CACHE_PREFIX+session.user.id;}
function readCache(){const saved=readJSON(cacheKey(),null);return saved&&validData(saved.data)&&Number.isSafeInteger(saved.version)&&saved.version>=0?saved:{version:0,data:{},dirty:false};}
function storeCache(next){native.setItem(cacheKey(),JSON.stringify(next));record=next;}
function guestData(){const data={};for(let i=0;i<native.length;i++){const k=native.key(i);if(allowed(k))data[k]=native.getItem(k);}return data;}
function updateUI(){account.textContent=session?'我的同步账号':'登录同步';loginArea.hidden=!!session;memberArea.hidden=!session;document.querySelector('#sync-email-display').textContent=session?.user?.email||'';importButton.hidden=!Object.keys(guestData()).length;resolveArea.hidden=!conflict;}
function message(e){if(e?.code==='invalid_credentials')return '邮箱或密码不正确，请重试。';if(e?.code==='email_not_confirmed')return '请先点击注册确认邮件中的链接，再回来登录。';if(e?.code==='over_email_send_rate_limit')return '确认邮件发送过于频繁，请稍后重试。';if(e?.code==='PGRST205'||e?.code==='PGRST202')return '同步表尚未初始化，请先在 Supabase 执行 setup.sql。修改已保留在此设备。';if(e?.code==='23514'||e?.status===413)return '清单超过同步容量，请减少上传图片的大小后重试。';if(e?.status===401)return '登录已过期，请重新登录；待同步修改仍保留在此设备。';if(e?.name==='AbortError'||e instanceof TypeError)return '暂时无法连接，修改已保存到此设备，联网后自动重试。';return e?.message||'同步失败，修改已保留，请重试。';}
async function request(path,options={},token){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);try{
 const r=await fetch(URL_BASE+path,{...options,signal:controller.signal,headers:{apikey:API_KEY,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...options.headers},credentials:'omit'});
 const data=await r.json().catch(()=>null);if(!r.ok){const e=Error(data?.msg||data?.message||data?.error_description||'服务暂时不可用');e.status=r.status;e.code=data?.code;throw e;}return data;
 }finally{clearTimeout(timeout);}}
async function token(){if(!session)throw Error('请先登录');if((session.expires_at||0)>Date.now()/1000+60)return session.access_token;
 if(!refreshTask)refreshTask=(async()=>{const id=session.user.id;const next=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});if(session?.user.id!==id)throw Error('账号已切换');next.expires_at=next.expires_at||Date.now()/1000+next.expires_in;native.setItem(AUTH_KEY,JSON.stringify(next));session=next;return next.access_token;})().finally(()=>refreshTask=null);
 return refreshTask;}
async function remote(versionOnly=false){const rows=await request('/rest/v1/shopping_sync?select='+(versionOnly?'version':'data,version')+'&user_id=eq.'+encodeURIComponent(session.user.id),{},await token());if(!Array.isArray(rows))throw Error('无法读取云端清单');const row=rows[0]||{data:{},version:0};if((!versionOnly&&!validData(row.data))||!Number.isSafeInteger(row.version))throw Error('云端清单格式有误，未覆盖此设备数据');return row;}
function requestReload(){reloadWanted=true;if(uiReady&&safeToReload()){
 try{sessionStorage.setItem('shopping-sync-scroll',JSON.stringify({url:location.pathname+location.search+location.hash,y:scrollY}));}catch{}
 location.reload();}else if(uiReady)say('其他设备有更新，完成当前操作后自动载入。');}
function showConflict(row){conflict=row;updateUI();say('其他设备也修改了清单。请点「我的同步账号」选择保留哪个版本；本机修改尚未被覆盖。');}
async function cycleInner(){if(!session||busy||suspended||conflict||reloadWanted)return;busy=true;try{
 record=readCache();
 if(record.dirty){
 const sent=structuredClone(record);say('正在同步…');
 const rows=await request('/rest/v1/rpc/save_shopping_sync',{method:'POST',body:JSON.stringify({expected_version:sent.version,next_data:sent.data})},await token());
 if(!Array.isArray(rows))throw Error('保存结果无效，未清除待同步修改');
 if(!rows.length){const row=await remote();if(equalData(row.data,sent.data)){const latest=readCache();storeCache({...latest,version:row.version,dirty:!equalData(latest.data,sent.data)});}else{showConflict(row);return;}}
 else{const latest=readCache();storeCache({...latest,version:rows[0].version,dirty:!equalData(latest.data,sent.data)});}
 say(record.dirty?'还有修改待同步…':'已同步');
 }else{
 const head=await remote(true);
 if(head.version===record.version){say('已同步');return;}
 const row=await remote();const latest=readCache();
 if(latest.dirty){record=latest;return;}
 if(row.version!==latest.version||!equalData(row.data,latest.data)){
 if(uiReady&&!safeToReload()){say('其他设备有更新，完成当前操作后自动载入。');return;}
 storeCache({version:row.version,data:row.data,dirty:false});if(uiReady)requestReload();
 }say('已同步');
 }
 }catch(e){say(message(e));}finally{busy=false;}}
async function cycle(){if(navigator.locks)return navigator.locks.request('shopping-cloud-'+(session?.user.id||'guest'),{ifAvailable:true},lock=>lock?cycleInner():undefined);return cycleInner();}
function schedule(){clearTimeout(timer);timer=setTimeout(cycle,700);}
const storage={getItem(k){return session?(record.data[k]??null):native.getItem(k);},setItem(k,value){
 if(!session)return native.setItem(k,value);
 if(!allowed(k))throw Error('不支持的清单字段');
 if(suspended)throw Error('请先完成账号切换');
 if(reloadWanted)throw Error('其他标签页更新了清单，请完成当前操作并刷新后重试');
 const latest=readCache();
 if((latest.data[k]??null)!==(record.data[k]??null)){requestReload();throw Error('另一个标签页已修改此项，请刷新后重试');}
 const next={...latest,data:{...latest.data,[k]:String(value)},dirty:true};storeCache(next);say(conflict?'有版本冲突，修改已保留在此设备':'已保存，等待同步…');schedule();
}};
account.addEventListener('click',()=>{updateUI();error.textContent='';dialog.showModal();});
document.querySelector('#sync-close').addEventListener('click',()=>dialog.close());
authForm.addEventListener('submit',async e=>{e.preventDefault();const signup=e.submitter?.id==='sync-signup';const email=document.querySelector('#sync-email').value.trim(),password=document.querySelector('#sync-password').value;error.textContent='';const buttons=[...authForm.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{
 const path=signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password';
 const data=await request(path,{method:'POST',body:JSON.stringify({email,password})});
 if(!data?.access_token){error.textContent='请查收确认邮件，完成邮箱验证后回到这里登录。';return;}
 data.expires_at=data.expires_at||Date.now()/1000+data.expires_in;native.setItem(AUTH_KEY,JSON.stringify(data));location.reload();
 }catch(e){error.textContent=message(e);}finally{buttons.forEach(b=>b.disabled=false);document.querySelector('#sync-password').value='';}});
document.querySelector('#sync-signout').addEventListener('click',async()=>{
 if(busy){error.textContent='正在保存，请稍后再退出。';return;}
 if(readCache().dirty&&!confirm('还有未上传的修改，将保留在此设备。确定退出登录？'))return;
 suspended=true;try{await request('/auth/v1/logout?scope=local',{method:'POST'},await token());}catch{}
 native.removeItem(AUTH_KEY);location.reload();
});
document.querySelector('#sync-retry').addEventListener('click',()=>{if(conflict){updateUI();return;}cycle();});
importButton.addEventListener('click',()=>{
 if(busy||conflict){error.textContent='请先等待同步完成或处理版本冲突。';return;}
 if(!confirm('将把这台设备未登录时的三家店清单导入当前账号，替换当前账号清单。其他设备同步后也会更新。继续？'))return;
 try{const data=guestData();const latest=readCache();storeCache({...latest,data,dirty:true});dialog.close();reloadWanted=true;location.reload();}catch(e){error.textContent=message(e);}
});
document.querySelector('#sync-use-cloud').addEventListener('click',async()=>{
 if(!confirm('使用云端版本会放弃此设备待同步的修改，确定继续？'))return;
 try{const row=await remote();storeCache({...row,dirty:false});conflict=null;location.reload();}catch(e){error.textContent=message(e);}
});
document.querySelector('#sync-use-local').addEventListener('click',async()=>{
 if(!confirm('将以此设备的完整清单替换云端版本，其他设备的不同修改可能被替换。继续？'))return;
 try{const latest=await remote();const current=readCache();storeCache({...current,version:latest.version,dirty:true});conflict=null;updateUI();await cycle();}catch(e){error.textContent=message(e);}
});
window.addEventListener('online',()=>cycle());
window.addEventListener('focus',()=>cycle());
window.addEventListener('storage',e=>{
 if(e.key===AUTH_KEY){const next=readJSON(AUTH_KEY,null);if(next?.user?.id!==session?.user?.id){suspended=true;location.reload();}else session=next;}
 if(session&&e.key===cacheKey()){const next=readCache();if(!equalData(next.data,record.data))requestReload();else record=next;}
});
window.addEventListener('beforeunload',e=>{if(session&&record.dirty&&!reloadWanted&&!suspended){e.preventDefault();e.returnValue='';}});
const ready=(async()=>{updateUI();if(session){record=readCache();await cycle();}else say('登录后可在其他设备继续整理');})();
window.ShoppingSync={ready,storage,get signedIn(){return !!session;},setSafeToReload(fn){safeToReload=fn;uiReady=true;
 try{const saved=JSON.parse(sessionStorage.getItem('shopping-sync-scroll'));sessionStorage.removeItem('shopping-sync-scroll');if(saved?.url===location.pathname+location.search+location.hash)setTimeout(()=>scrollTo(0,saved.y),150);}catch{}
}};
setInterval(()=>{if(reloadWanted&&uiReady&&safeToReload())requestReload();else if(!document.hidden)cycle();},5000);
})();
