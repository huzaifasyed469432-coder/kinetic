(function(){
  try {
    var forcePreloaderOff=function(){
      if(window.__kineticFinishLoading){window.__kineticFinishLoading();var loadedPre=document.getElementById('preloader');if(loadedPre)loadedPre.style.display='none';return;}
      var pre=document.getElementById('preloader'), bar=document.getElementById('loadBar'), pct=document.getElementById('loadPct');
      if(bar)bar.style.width='100%';if(pct)pct.textContent='100';
      if(pre){pre.classList.add('done');pre.style.display='none';}
      document.body.classList.remove('loading');document.body.style.overflow='';window.__kineticPreloaderDone=true;
    };
    if(!window.__kineticPreloaderDone) window.__kineticPreloaderFailSafe=window.setTimeout(forcePreloaderOff,3900);
  } catch(e) { try{document.body.classList.remove('loading');document.body.style.overflow='';}catch(ignore){} }
  var lookStart=null, lookMoved=false, heroStart=null, heroMoved=false, ignoreLookClick=false, ignoreHeroClick=false;
  document.addEventListener('pointerdown',function(e){
    var look=e.target.closest&&e.target.closest('.look-card');
    var stage=e.target.closest&&e.target.closest('.stage');
    if(look){lookStart={x:e.clientX,y:e.clientY};lookMoved=false;}
    if(stage){heroStart={x:e.clientX,y:e.clientY};heroMoved=false;}
  },true);
  document.addEventListener('pointermove',function(e){
    if(lookStart&&Math.hypot(e.clientX-lookStart.x,e.clientY-lookStart.y)>8)lookMoved=true;
    if(heroStart&&Math.hypot(e.clientX-heroStart.x,e.clientY-heroStart.y)>8)heroMoved=true;
  },true);
  document.addEventListener('pointerup',function(){
    if(lookStart&&lookMoved){ignoreLookClick=true;window.setTimeout(function(){ignoreLookClick=false;},400);}
    if(heroStart&&heroMoved){ignoreHeroClick=true;window.setTimeout(function(){ignoreHeroClick=false;},400);}
    lookStart=null;lookMoved=false;heroStart=null;heroMoved=false;
  },true);
  document.addEventListener('click',function(e){
    var look=e.target.closest&&e.target.closest('.look-card');
    if(look&&!e.target.closest('.look-shop,button,a')){
      if(ignoreLookClick){ignoreLookClick=false;return;}
      var shop=look.querySelector('.look-shop');if(shop)shop.click();
    }
    var stage=e.target.closest&&e.target.closest('.stage');
    if(stage&&!e.target.closest('button,a,.hero-thumb')){
      if(ignoreHeroClick){ignoreHeroClick=false;return;}
      var view=document.getElementById('heroView');if(view)view.click();
    }
  });
  document.querySelectorAll('.look-card').forEach(function(card){
    card.style.cursor='pointer';card.setAttribute('role','group');card.setAttribute('aria-label','Lookbook item: '+(card.querySelector('.display')?card.querySelector('.display').textContent.trim():'product look'));
  });
  var stage=document.querySelector('.stage');if(stage){stage.style.cursor='pointer';stage.setAttribute('role','button');stage.setAttribute('tabindex','0');stage.setAttribute('aria-label','Open featured shoe details; drag to tilt');stage.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();var view=document.getElementById('heroView');if(view)view.click();}});}
})();
