// Google Apps Script web app URL (doPost appends a row to the MCW 表單名單 sheet). PENDING: paste the /exec URL after deploying apps-script/Code.gs
// ===== Factory video: ONE-LINE SWITCH — 'logo' = current v04 clip, 'nologo' = 10/30 no-factory-logo version =====
var MCW_FACTORY_VIDEO = 'logo';
var MCW_VIDEOS = {
  logo:   { src: 'video/mcw-factory.mp4?v=2',        poster: 'img/video-poster.jpg' },
  nologo: { src: 'video/mcw-factory-nologo.mp4', poster: 'img/video-poster-nologo.jpg' }
};
var MCW_FORM_ENDPOINT = window.MCW_FORM_ENDPOINT_OVERRIDE || 'https://script.google.com/macros/s/AKfycbyErafjpdcCacwSCKVXFzTEUfJMwxBdVnVm_5TOW6MzZ55XoCoqEyD_ZG9lTD9MFv4faw/exec';
(function(){
  var $=function(id){return document.getElementById(id)};
  var fmt=function(n){return Math.round(n).toLocaleString('zh-TW')+' 元'};
  function calc(){
    var n=+$('c-n').value,u=+$('c-u').value,d=n*u*200,m=d*30,y=d*365,net=m*0.85-20000,pay=net>0?(n*400000)/(net*12):0;
    $('o-d').textContent=fmt(d);$('o-m').textContent=fmt(m);$('o-y').textContent=fmt(y);$('o-pay').textContent=pay?pay.toFixed(1):'—';
  }
  ['c-n','c-u'].forEach(function(id){$(id).addEventListener('change',calc)});
  calc();
})();

(function(){
  // scroll reveal
  var els=document.querySelectorAll('.sec,.reveal');
  if('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.05});
    els.forEach(function(el){io.observe(el)});
  } else els.forEach(function(el){el.classList.add('in')});
  // count-up for any [data-count]
  document.querySelectorAll('[data-count]').forEach(function(el){var t=+el.dataset.count,s=null;function f(ts){s=s||ts;var p=Math.min(1,(ts-s)/1200);el.textContent=Math.round(t*p).toLocaleString('zh-TW');if(p<1)requestAnimationFrame(f)}requestAnimationFrame(f)});
  // lead form
  var f=document.getElementById('leadForm');if(!f)return;var msg=f.querySelector('.form-msg'),btn=f.querySelector('.submit'),t0=Date.now();
  f.addEventListener('submit',function(ev){
    ev.preventDefault();msg.className='form-msg';msg.textContent='';
    var bad=[];f.querySelectorAll('[required]').forEach(function(i){var ok=i.value.trim()&&(!i.pattern||new RegExp('^'+i.pattern+'$').test(i.value.trim()));i.classList.toggle('invalid',!ok);if(!ok)bad.push(i)});
    if(bad.length){msg.classList.add('err');msg.textContent='請填寫姓名、正確的電話、地區與需求';bad[0].focus();return}
    if(f.website.value||Date.now()-t0<2500){msg.classList.add('ok');msg.textContent='已收到，我們會盡快與你聯繫！';f.reset();return}
    if(MCW_FORM_ENDPOINT.indexOf('http')!==0){msg.classList.add('err');msg.textContent='表單尚未開通，請先加官方 LINE @mcw27 、撥加盟專線 07-788-1902 或業務專線 0970-622-778';return}
    var d={};['name','phone','line','area','need','note'].forEach(function(k){d[k]=f[k].value.trim()});d.phone='09'+d.phone.replace(/\D/g,'');d.page=location.href;d.ts=new Date().toISOString();
    btn.disabled=true;btn.textContent='送出中…';
    fetch(MCW_FORM_ENDPOINT,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(d)}).then(function(){msg.classList.add('ok');msg.textContent='已收到，我們會盡快與你聯繫！';f.reset()}).catch(function(){msg.classList.add('err');msg.textContent='送出失敗，請改用官方 LINE @mcw27 、撥加盟專線 07-788-1902 或業務專線 0970-622-778'}).finally(function(){btn.disabled=false;btn.textContent='送出預約'});
  });
})();

(function(){
  var v=document.getElementById('factoryVideo');if(!v)return;
  var cfg=MCW_VIDEOS[MCW_FACTORY_VIDEO]||MCW_VIDEOS.logo;v.poster=cfg.poster;v.removeAttribute('controls');
  var bp=document.getElementById('vPlay'),bs=document.getElementById('vSound'),started=false,userPaused=false;
  function ui(){bp.textContent=v.paused?'▶ 播放':'❚❚ 暫停';bp.setAttribute('aria-label',v.paused?'播放':'暫停');bs.textContent=v.muted?'🔇 開聲音':'🔊 關聲音';bs.classList.toggle('on',!v.muted)}
  function start(){if(started)return;started=true;v.src=cfg.src;v.muted=true;v.play().catch(function(){}).finally?v.play().catch(function(){}):0}
  bp.addEventListener('click',function(){if(!started){start();userPaused=false;return}if(v.paused){userPaused=false;v.play().catch(function(){})}else{userPaused=true;v.pause()}});
  bs.addEventListener('click',function(){if(!started)start();v.muted=!v.muted;if(!v.muted){v.volume=1;userPaused=false;v.play().catch(function(){})}ui()});
  v.addEventListener('click',function(){bp.click()});
  ['play','pause','volumechange'].forEach(function(t){v.addEventListener(t,ui)});
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){if(es[0].isIntersecting){start();io.disconnect()}},{rootMargin:'300px 0px'});io.observe(v)}else start();
  ui();
})();
