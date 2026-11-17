(function(){
'use strict';
var $ = function(s,c){ return (c||document).querySelector(s); };
var $$ = function(s,c){ return Array.prototype.slice.call((c||document).querySelectorAll(s)); };
var money = function(n){ return '$'+Number(n).toFixed(2); };
var clamp = function(v,a,b){ return Math.max(a,Math.min(b,v)); };
function toast(title,message,tone){
  var host=$('#toasts'); if(!host) return;
  var item=document.createElement('div');
  item.className='toast '+(tone||'bg-flame text-ink')+' border-2 border-ink px-5 py-4 font-mono2 text-[10px] tracking-[.12em] shadow-[6px_6px_0_rgba(212,175,55,.45)]';
  item.setAttribute('role','status'); item.setAttribute('aria-live','polite');
  var heading=document.createElement('div'); heading.className='font-black uppercase tracking-[.16em]'; heading.textContent=String(title||'KINETIC');
  var detail=document.createElement('div'); detail.className='mt-1 leading-relaxed'; detail.textContent=String(message||'');
  item.appendChild(heading); item.appendChild(detail); host.appendChild(item);
  window.setTimeout(function(){item.classList.add('in');},20);
  window.setTimeout(function(){item.classList.remove('in');window.setTimeout(function(){if(item.parentNode)item.remove();},550);},3600);
}
var matchesMedia = function(query){ return !!(window.matchMedia && window.matchMedia(query).matches); };
var reduced = matchesMedia('(prefers-reduced-motion: reduce)');
/* One size list for the modal, the product page, the bag and checkout. */
var PRODUCT_SIZES=['7','7.5','8','8.5','9','9.5','10','10.5','11','12'];
var SIZE_EU={'7':'40','7.5':'40.5','8':'41','8.5':'42','9':'42.5','9.5':'43','10':'44','10.5':'44.5','11':'45','12':'46'};
var KINETIC_CONFIG = {
  marketing: {
    /* Source-provided demo metrics; verify ratings, audience and laboratory figures before public launch. */
    runners: 98000,
    members: 45231,
    membersTeaser: 45000,
    averageRating: 4.9,
    testedAthletes: 240,
    stylesLive: 8,
    totalReviews: 15269,
    wouldRebuyPercent: 96,
    labIterationYears: 3,
    fieldTestKm: 10000,
    energyReturnPercent: 92,
    plateDropMm: 4.0,
    productWeightGrams: 184,
    airflowDegrees: 360,
    impactAbsorptionMultiplier: 3.0,
    testedLifeKm: 600,
    weightReductionPercent: 34,
    impactAbsorptionPercent: 78,
    durabilityIndexPercent: 96,
    productReviewCounts: {
      voltageProCarbon: 2143,
      apex01Racer: 864,
      monolithHigh: 3450,
      strikeCourtLo: 1120,
      infernoTiltCarbon: 1890,
      nebulaRunner: 2310,
      shadowKnit: 512,
      retro85Carbon: 2980
    }
  },
  commerce: {
    freeShippingThresholdCents: 18000,
    shippingCents: 1200,
    promoCode: 'KINETIC20',
    promoPercent: 20
  },
  checkout: {
    /* Same-origin Tap Netlify Function. Never place payment secrets in browser code. */
    endpoint: '/.netlify/functions/create-checkout'
  },
  destinations: {
    instagram: '', tiktok: '', x: '', youtube: '',
    trackOrder: '', sizeGuide: '', returns: '', contact: '', storeLocator: '',
    privacy: '', terms: '', cookies: ''
  }
};
/* KINETIC live-content: merge saved marketing/commerce numbers over defaults */
try{
  var __KC=(window.__KINETIC_CONTENT__||{});
  if(__KC.marketing){
    Object.keys(__KC.marketing).forEach(function(k){
      if(k==='productReviewCounts'){
        if(__KC.marketing.productReviewCounts){
          Object.keys(__KC.marketing.productReviewCounts).forEach(function(rk){
            var n=Number(__KC.marketing.productReviewCounts[rk]);
            if(isFinite(n)&&n>=0) KINETIC_CONFIG.marketing.productReviewCounts[rk]=n;
          });
        }
      } else {
        var v=Number(__KC.marketing[k]);
        if(isFinite(v)) KINETIC_CONFIG.marketing[k]=v;
      }
    });
  }
  if(__KC.commerce){
    Object.keys(__KC.commerce).forEach(function(k){ KINETIC_CONFIG.commerce[k]=__KC.commerce[k]; });
  }
}catch(__kcErr){}
function formatMarketingValue(key){
  var value=KINETIC_CONFIG.marketing[key];
  if(['averageRating','plateDropMm','impactAbsorptionMultiplier'].indexOf(key)!==-1) return Number(value).toFixed(1);
  return Number(value).toLocaleString('en-US');
}
function applyMarketingConfig(){
  $$('[data-config-value]').forEach(function(el){
    var key=el.getAttribute('data-config-value');
    if(Object.prototype.hasOwnProperty.call(KINETIC_CONFIG.marketing,key)) el.textContent=formatMarketingValue(key);
  });
}
applyMarketingConfig();

var KINETIC_IMAGE_DIMENSIONS={"assets/images/40a470397f3ef7b7.jpg":[1100,733],"assets/images/01c31163ece2a19f.jpg":[1100,786],"assets/images/5916e42350811ca9.jpg":[1100,880],"assets/images/fb10e562f94a80bc.jpg":[1100,1650],"assets/images/793473e10624e6a6.jpg":[1100,734],"assets/images/2c53504d2430d75e.jpg":[1100,1650],"assets/images/81ef1d14c54de2f1.jpg":[1100,734],"assets/images/eb01e5bab3a80e98.jpg":[1100,1375],"assets/images/407e125ad12a7343.jpg":[1100,825],"assets/images/7e7afef3a68aab55.jpg":[1100,1375],"assets/images/e325ae933be2eb0a.jpg":[1100,733],"assets/images/31cc6f2be8488145.jpg":[1100,1650],"assets/images/7ec35cfc4888c347.jpg":[1100,733],"assets/images/11073cb2ab9c627b.jpg":[1100,1467],"assets/images/3c382aa6d2a3c175.jpg":[1100,726],"assets/images/68fa9dff96eb4be2.jpg":[1100,1650],"assets/images/3376a541498e8878.jpg":[1100,1650],"assets/images/ef928fbb81a95a94.jpg":[1100,1650],"assets/images/0aa80a56f46b796a.jpg":[1100,1375]};
function kineticImageDimensions(src){var key=String(src||'').replace(/^\//,'').split(/[?#]/)[0];return KINETIC_IMAGE_DIMENSIONS[key]||[1100,733];}
function kineticImageDimensionAttrs(src){var d=kineticImageDimensions(src);return ' width="'+d[0]+'" height="'+d[1]+'"';}
function setKineticImageDimensions(img,src){if(!img)return;var d=kineticImageDimensions(src);img.setAttribute('width',d[0]);img.setAttribute('height',d[1]);}
function applyKineticImageDimensions(root){if(!root||!root.querySelectorAll)return;root.querySelectorAll('img').forEach(function(img){setKineticImageDimensions(img,img.getAttribute('src')||img.src);});}

var PRODUCTS = [
  { id:0, name:'Voltage Pro Carbon', cat:'Running', price:260, old:310, tag:'Limited', rating:4.9, reviews:KINETIC_CONFIG.marketing.productReviewCounts.voltageProCarbon, img:'assets/images/40a470397f3ef7b7.jpg', colors:['#D71920','#08080A','#F5F0EA'], colorways:[{name:'Inferno Red',swatch:'#D71920'}, {name:'Midnight Black',swatch:'#08080A'}, {name:'Warm Cream',swatch:'#F5F0EA'}], desc:'Our flagship carbon racer. Real featherweight knit shell over a full-length carbon plate and dual-density VOLTFOAM™ midsole. A bold race-day profile, designed to look as fast as it feels.' },
  { id:1, name:'Apex 01 Racer', cat:'Running', price:285, old:null, tag:'New', rating:4.8, reviews:KINETIC_CONFIG.marketing.productReviewCounts.apex01Racer, img:'assets/images/01c31163ece2a19f.jpg', colors:['#B8860B','#08080A','#F5F0EA'], colorways:[{name:'Bronze Gold',swatch:'#B8860B'}, {name:'Midnight Black',swatch:'#08080A'}, {name:'Warm Cream',swatch:'#F5F0EA'}], desc:'Race-day geometry with a rocker that keeps you rolling forward. Minimal mass, maximum aggression. Built for race-day intent.' },
  { id:2, name:'Monolith High', cat:'Lifestyle', price:195, old:230, tag:'Icon', rating:4.9, reviews:KINETIC_CONFIG.marketing.productReviewCounts.monolithHigh, img:'assets/images/2c53504d2430d75e.jpg', colors:['#F5F0EA','#08080A','#D4AF37'], colorways:[{name:'Warm Cream',swatch:'#F5F0EA'}, {name:'Midnight Black',swatch:'#08080A'}, {name:'Flame Gold',swatch:'#D4AF37'}], desc:'A sculpted high-top built from full-grain leather with a cushioned collar. Quiet luxury, loud silhouette.' },
  { id:3, name:'Strike Court Lo', cat:'Court', price:175, old:null, tag:'Core', rating:4.7, reviews:KINETIC_CONFIG.marketing.productReviewCounts.strikeCourtLo, img:'assets/images/5916e42350811ca9.jpg', colors:['#FFFFFF','#08080A','#D4AF37'], colorways:[{name:'Chalk White',swatch:'#FFFFFF'}, {name:'Midnight Black',swatch:'#08080A'}, {name:'Flame Gold',swatch:'#D4AF37'}], desc:'Herringbone traction, locked-in ankle collar and an explosive first step. Built for blacktop and hardwood.' },
  { id:4, name:'Inferno Tilt Carbon', cat:'Limited', price:320, old:null, tag:'Limited', editionSize:300, rating:5.0, reviews:KINETIC_CONFIG.marketing.productReviewCounts.infernoTiltCarbon, img:'assets/images/81ef1d14c54de2f1.jpg', colors:['#D4AF37','#F2D273','#08080A'], colorways:[{name:'Flame Gold',swatch:'#D4AF37'}, {name:'Pale Gold',swatch:'#F2D273'}, {name:'Midnight Black',swatch:'#08080A'}], desc:'300 numbered pairs. Reflective cage, glow outsole and a carbon plate tuned for explosive toe-off. Reflective details with a high-visibility finish.' },
  { id:5, name:'Nebula Runner', cat:'Running', price:210, old:245, tag:'Hot', rating:4.8, reviews:KINETIC_CONFIG.marketing.productReviewCounts.nebulaRunner, img:'assets/images/eb01e5bab3a80e98.jpg', colors:['#E7E0D8','#D4AF37','#08080A'], colorways:[{name:'Soft Stone',swatch:'#E7E0D8'}, {name:'Flame Gold',swatch:'#D4AF37'}, {name:'Midnight Black',swatch:'#08080A'}], desc:'Maximum cushion, maximum statement. Triple-stacked foam and a glacier-soft upper that floats above the pavement.' },
  { id:6, name:'Shadow Knit', cat:'Lifestyle', price:160, old:null, tag:'New', rating:4.6, reviews:KINETIC_CONFIG.marketing.productReviewCounts.shadowKnit, img:'assets/images/407e125ad12a7343.jpg', colors:['#08080A','#3A3A40','#D4AF37'], colorways:[{name:'Midnight Black',swatch:'#08080A'}, {name:'Graphite',swatch:'#3A3A40'}, {name:'Flame Gold',swatch:'#D4AF37'}], desc:'A stealth everyday silhouette in matte knit with a sock-like fit. Disappears into any fit — until it hits the light.' },
  { id:7, name:'Retro 85 Carbon', cat:'Court', price:220, old:265, tag:'Archive', rating:4.9, reviews:KINETIC_CONFIG.marketing.productReviewCounts.retro85Carbon, img:'assets/images/7e7afef3a68aab55.jpg', colors:['#D4AF37','#08080A','#F5F0EA'], colorways:[{name:'Flame Gold',swatch:'#D4AF37'}, {name:'Midnight Black',swatch:'#08080A'}, {name:'Warm Cream',swatch:'#F5F0EA'}], desc:'The 1985 legend, remastered with modern cushioning. Vintage shape, full-grain upper, zero nostalgia fatigue.' }
];
/* KINETIC live-content: apply saved product edits + new products over the PRODUCTS array */
function __kineticMergeProduct(p,s){
  var n={}; for(var k in p) n[k]=p[k];
  ['name','cat','tag','desc','img'].forEach(function(f){ if(typeof s[f]==='string'&&s[f].trim()!=='') n[f]=s[f].trim(); });
  if('price' in s){ var pr=Number(s.price); if(isFinite(pr)&&pr>=0) n.price=pr; }
  if('old' in s){ n.old=(s.old===null||s.old==='')?null:Number(s.old); if(!isFinite(n.old)) n.old=null; }
  if('rating' in s){ var rt=Number(s.rating); if(isFinite(rt)&&rt>=0&&rt<=5) n.rating=rt; }
  if('reviews' in s){ var rv=Number(s.reviews); if(isFinite(rv)&&rv>=0) n.reviews=rv; }
  if('editionSize' in s){ n.editionSize=(s.editionSize===null||s.editionSize==='')?null:Number(s.editionSize); if(!isFinite(n.editionSize)) n.editionSize=null; }
  if(Array.isArray(s.colorways)&&s.colorways.length){
    var cw=s.colorways.filter(function(c){ return c&&typeof c.swatch==='string'&&/^#[0-9a-f]{6}$/i.test(c.swatch); })
      .map(function(c){ return {name:String(c.name||'').trim(),swatch:c.swatch.toUpperCase()}; });
    if(cw.length){ n.colorways=cw; n.colors=cw.map(function(c){ return c.swatch; }); }
  }
  /* ---- fields managed by the admin dashboard ---- */
  if(typeof s.sku==='string'&&s.sku.trim()!=='') n.sku=s.sku.trim().toUpperCase();
  if(s.status==='draft'||s.status==='active') n.status=s.status;
  if('featured' in s) n.featured=!!s.featured;
  if(Array.isArray(s.sizes)&&s.sizes.length){
    n.sizes=s.sizes.map(function(x){ return String(x); }).filter(function(x,i,arr){ return x.trim()!==''&&arr.indexOf(x)===i; });
  }
  if(s.stock&&typeof s.stock==='object'&&!Array.isArray(s.stock)){
    var stockMap={}; Object.keys(s.stock).forEach(function(k){ var q=parseInt(s.stock[k],10); if(isFinite(q)&&q>=0) stockMap[String(k)]=q; });
    n.stock=Object.keys(stockMap).length?stockMap:null;
  }else if(typeof s.stock==='number'&&isFinite(s.stock)&&s.stock>=0){ n.stock=Math.floor(s.stock); }
  if(Array.isArray(s.specs)&&s.specs.length){
    n.specs=s.specs.map(function(row){ return Array.isArray(row)?[String(row[0]||''),String(row[1]||'')]:[String((row&&row.label)||''),String((row&&row.value)||'')]; });
  }
  return n;
}
var __KINETIC_BASE_PRODUCTS__=PRODUCTS.slice();
function __kineticApplyContent(){
  try{
    PRODUCTS=__KINETIC_BASE_PRODUCTS__.slice();
    var __KP=(window.__KINETIC_CONTENT__||{}).products;
    if(Array.isArray(__KP)){
      PRODUCTS=PRODUCTS.map(function(p){
        var s=null;
        for(var i=0;i<__KP.length;i++){ if(__KP[i]&&String(__KP[i].id)===String(p.id)){ s=__KP[i]; break; } }
        if(!s) return p;
        return __kineticMergeProduct(p,s);
      });
      /* add brand-new products (ids not in the built-in list) */
      __KP.forEach(function(s){
        if(!s) return;
        var id=Number(s.id);
        if(!isFinite(id)) return;
        var exists=PRODUCTS.some(function(p){ return String(p.id)===String(id); });
        if(exists) return;
        var base={ id:id, name:'New Product', cat:'Running', tag:'New', price:150, old:null, rating:4.5, reviews:0,
          img:'assets/images/40a470397f3ef7b7.jpg', desc:'',
          colorways:[{name:'Midnight Black',swatch:'#08080A'}], colors:['#08080A'] };
        var np=__kineticMergeProduct(base,s);
        if(isValidProduct(np)) PRODUCTS.push(np);
      });
    }
  }catch(__kpErr){}
  __kineticApplyDbProducts();
  try{ syncProductTicker(); }catch(e){}
  try{ applyMarketingConfig(); }catch(e){}
  try{
    if(document.getElementById('productGrid')){
      if(typeof renderFilters==='function') renderFilters();
      renderProducts();
      if(typeof updateHeroColorways==='function') updateHeroColorways();
    }
  }catch(e){}
  return true;
}
/* ---------------------------------------------------------------------------
   Live catalogue overlay.
   window.__KINETIC_DB_PRODUCTS__ is filled in by assets/kinetic-api-bridge.js
   from the commerce API. When it is present the database is the source of
   truth for price, sale price, colourways, tag, description and — most
   importantly — the per-size stock table, so a product the owner edits or
   sells out in the database behaves identically here. Without it the shop runs
   on content.json exactly as before.
   --------------------------------------------------------------------------- */
function __kineticApplyDbProducts(){
  var list = window.__KINETIC_DB_PRODUCTS__;
  if(!Array.isArray(list) || !list.length) return false;
  var seen={};
  var next = PRODUCTS.map(function(base){
    var match=null;
    for(var i=0;i<list.length;i++){
      if(list[i] && String(list[i].id)===String(base.id)){ match=list[i]; break; }
    }
    if(!match) return base;
    seen[String(match.id)]=1;
    return __kineticMergeProduct(base, match);
  });
  list.forEach(function(db){
    if(!db || !isFinite(Number(db.id)) || seen[String(db.id)]) return;
    var base={ id:Number(db.id), name:'New Product', cat:'Running', tag:'New', price:150, old:null, rating:4.5, reviews:0,
      img:'assets/images/40a470397f3ef7b7.jpg', desc:'',
      colorways:[{name:'Midnight Black',swatch:'#08080A'}], colors:['#08080A'] };
    var np=__kineticMergeProduct(base, db);
    if(isValidProduct(np)) next.push(np);
  });
  PRODUCTS.length=0;
  next.forEach(function(p){ PRODUCTS.push(p); });
  return true;
}
function __kineticApplyDbConfig(cfg){
  if(!cfg || typeof cfg!=='object') return false;
  try{
    if(cfg.commerce && typeof cfg.commerce==='object'){
      Object.keys(cfg.commerce).forEach(function(k){ KINETIC_CONFIG.commerce[k]=cfg.commerce[k]; });
    }
    if(cfg.store && typeof cfg.store==='object'){
      Object.keys(cfg.store).forEach(function(k){ KINETIC_CONFIG[k]=cfg.store[k]; });
    }
  }catch(e){ return false; }
  return true;
}
__kineticApplyContent();
function syncProductTicker(){
  var limited=getProductById(4); if(!limited) return;
  var copy='New: '+limited.name+' — '+(limited.editionSize||'Edition size TBC')+' pairs only';
  $$('[data-open-product="4"]').forEach(function(button){button.textContent=copy;button.setAttribute('aria-label','View '+limited.name+' limited edition');});
}
function getProductById(id){
  return PRODUCTS.find(function(p){ return p && String(p.id)===String(id); })||null;
}
function escapeHtml(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; });
}
function safeColor(value){ return /^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toUpperCase():null; }
function getProductColorways(product){
  if(!product) return [];
  var source=Array.isArray(product.colorways)&&product.colorways.length?product.colorways:(Array.isArray(product.colors)?product.colors:[]);
  return source.map(function(entry,index){
    var hex=safeColor(entry&&typeof entry==='object'?(entry.swatch||entry.hex||entry.color):entry);
    if(!hex) return null;
    var name=entry&&typeof entry==='object'?String(entry.name||'').trim():'';
    if(!name) name=({ '#D4AF37':'Flame Gold','#08080A':'Midnight Black','#F5F0EA':'Warm Cream','#B8860B':'Bronze Gold','#FFFFFF':'Chalk White','#F2D273':'Pale Gold','#E7E0D8':'Soft Stone','#3A3A40':'Graphite' })[hex]||('Colourway '+(index+1));
    return {name:name,hex:hex};
  }).filter(Boolean);
}
function getProductColorway(product,value){
  var hex=safeColor(value); if(!hex) return null;
  var options=getProductColorways(product);
  for(var i=0;i<options.length;i++) if(options[i].hex===hex) return options[i];
  return null;
}
function getSelectedColorway(product){
  if(!product) return null;
  var saved=selectedColorsByProduct[String(product.id)], selected=getProductColorway(product,saved);
  return selected||getProductColorways(product)[0]||null;
}
function getExplicitlySelectedColorway(product){
  if(!product||!explicitlySelectedColorsByProduct[String(product.id)]) return null;
  return getProductColorway(product,selectedColorsByProduct[String(product.id)]);
}
function setProductColorway(productId,value){
  var product=getProductById(productId), selected=getProductColorway(product,value);
  if(!product||!selected) return null;
  selectedColorsByProduct[String(product.id)]=selected.hex;
  explicitlySelectedColorsByProduct[String(product.id)]=true;
  return selected;
}
function colorChoiceMarkup(option,selected,sizeClass,productId){
  if(!option) return '';
  var className='color-choice color-choice--'+sizeClass+(productId===undefined?'':' card-color-choice');
  return '<button type="button" class="'+className+'" data-color="'+option.hex+'" data-color-name="'+escapeHtml(option.name)+'"'+(productId===undefined?'':' data-product-id="'+escapeHtml(productId)+'"')+' aria-label="Choose '+escapeHtml(option.name)+' colourway" aria-pressed="'+(selected?'true':'false')+'" title="'+escapeHtml(option.name)+'" style="background-color:'+option.hex+'"><span class="sr-only">'+escapeHtml(option.name)+'</span></button>';
}
function renderColorChoices(container,product,selectedHex,sizeClass,productId){
  if(!container||!product) return;
  var selected=selectedHex?getProductColorway(product,selectedHex):null;
  container.innerHTML=getProductColorways(product).map(function(option){return colorChoiceMarkup(option,!!selected&&option.hex===selected.hex,sizeClass,productId);}).join('');
}

function isValidProduct(p){
  if(p && String(p.status||'active').toLowerCase()==='draft') return false;   /* drafts stay in the admin only */
  return !!p && Number.isInteger(Number(p.id)) && typeof p.name==='string' && p.name.trim().length>0 &&
    typeof p.cat==='string' && p.cat.trim().length>0 && Number.isFinite(Number(p.price)) && Number(p.price)>=0 &&
    Number.isFinite(Number(p.rating)) && Number(p.rating)>=0 && Number(p.rating)<=5 && Number.isFinite(Number(p.reviews)) && Number(p.reviews)>=0 &&
    (p.old==null||(Number.isFinite(Number(p.old))&&Number(p.old)>=0)) && typeof p.img==='string' && p.img.length>0 && Array.isArray(p.colors) && p.colors.some(safeColor) && Array.isArray(p.colorways) && getProductColorways(p).length>0;
}
var selectedColorsByProduct=Object.create(null);
var explicitlySelectedColorsByProduct=Object.create(null);
PRODUCTS.forEach(function(product){ var first=getProductColorways(product)[0]; if(first) selectedColorsByProduct[String(product.id)]=first.hex; });

var HERO_VARIANTS = [
  { img:'assets/images/40a470397f3ef7b7.jpg', product:0 },
  { img:'assets/images/01c31163ece2a19f.jpg', product:1 },
  { img:'assets/images/5916e42350811ca9.jpg', product:3 }
];
var LOOKS = [
  { img:'assets/images/e325ae933be2eb0a.jpg', title:'Street / 01', sub:'Downtown sprint', product:0 },
  { img:'assets/images/31cc6f2be8488145.jpg', title:'Studio / 02', sub:'Inferno session', product:4 },
  { img:'assets/images/7ec35cfc4888c347.jpg', title:'Track / 03', sub:'The 5am club', product:1 },
  { img:'assets/images/11073cb2ab9c627b.jpg', title:'Night / 04', sub:'City ops', product:6 },
  { img:'assets/images/3c382aa6d2a3c175.jpg', title:'Court / 05', sub:'Blacktop kings', product:3 },
  { img:'assets/images/68fa9dff96eb4be2.jpg', title:'Archive / 06', sub:'Heritage line', product:7 }
];
/* KINETIC live-content: apply saved lookbook caption edits */
try{
  var __KL=(window.__KINETIC_CONTENT__||{}).looks;
  if(Array.isArray(__KL)){
    LOOKS.forEach(function(look,i){
      var o=__KL[i]; if(!o) return;
      if(typeof o.title==='string'&&o.title.trim()!=='') look.title=o.title;
      if(typeof o.sub==='string'&&o.sub.trim()!=='') look.sub=o.sub;
      if(typeof o.img==='string'&&o.img.trim()!=='') look.img=o.img;
    });
  }
}catch(__klErr){}
var TECH_IMGS = [
  { img:'assets/images/eb01e5bab3a80e98.jpg', label:'Carbon core' },
  { img:'assets/images/5916e42350811ca9.jpg', label:'Knit weave' },
  { img:'assets/images/81ef1d14c54de2f1.jpg', label:'VOLTFOAM™' }
];
/* KINETIC live-content: apply saved tech image label edits */
try{
  var __KT=(window.__KINETIC_CONTENT__||{}).techImgs;
  if(Array.isArray(__KT)){
    TECH_IMGS.forEach(function(t,i){
      var o=__KT[i]; if(!o) return;
      if(typeof o.label==='string'&&o.label.trim()!=='') t.label=o.label;
      if(typeof o.img==='string'&&o.img.trim()!=='') t.img=o.img;
    });
  }
}catch(__ktErr){}
var REVIEWS = [
  { text:'These aren’t shoes, they’re instruments. I took 40 seconds off my 5k in the first week.', name:'Marcus Carter — Marathoner', meta:'Sample review · Voltage Pro Carbon', avatar:'assets/images/fb10e562f94a80bc.jpg' },
  { text:'The fit is unreal. Zero break-in, zero hot spots, and they look sharper than anything else in my rotation.', name:'Zoe Luna — Creative Director', meta:'Sample review · Inferno Tilt Carbon', avatar:'assets/images/3376a541498e8878.jpg' },
  { text:'Strike Court lives up to the name. The grip is vicious and my first step has never been quicker.', name:'Devon Wright — Guard', meta:'Sample review · Strike Court Lo', avatar:'assets/images/ef928fbb81a95a94.jpg' },
  { text:'Retro 85 Carbon is old soul and new tech in one shoe. I bought a second pair the same night.', name:'Sofia Reyes — Collector', meta:'Sample review · Retro 85 Carbon', avatar:'assets/images/0aa80a56f46b796a.jpg' }
];
/* KINETIC live-content: apply saved testimonial edits */
try{
  var __KR=(window.__KINETIC_CONTENT__||{}).reviews;
  if(Array.isArray(__KR)&&__KR.length){
    REVIEWS=__KR.map(function(r,i){
      var b=REVIEWS[i]||{};
      return {
        text:(r&&typeof r.text==='string'&&r.text.trim()!=='')?r.text:(b.text||''),
        name:(r&&typeof r.name==='string'&&r.name.trim()!=='')?r.name:(b.name||''),
        meta:(r&&typeof r.meta==='string'&&r.meta.trim()!=='')?r.meta:(b.meta||''),
        avatar:(r&&typeof r.avatar==='string'&&r.avatar.trim()!=='')?r.avatar:(b.avatar||'')
      };
    });
  }
}catch(__krErr){}
var heroAuto=null, revAuto=null, selectedSize=null, selectedColor=null, modalProduct=null, productMediaItems=[], productMediaIndex=0, mediaProductId=null, mediaMemory=Object.create(null), mediaDBPromise=null;
var productReturnFocus=null, searchReturnFocus=null, cartReturnFocus=null, menuReturnFocus=null;
var wishlistIds=[];
try{ wishlistIds=JSON.parse(localStorage.getItem('kinetic-wishlist-v1')||'[]').filter(function(id){ return getProductById(id); }); }catch(e){ wishlistIds=[]; }
function isWishlisted(id){ return wishlistIds.some(function(saved){ return String(saved)===String(id); }); }
function saveWishlist(){ try{ localStorage.setItem('kinetic-wishlist-v1',JSON.stringify(wishlistIds)); }catch(e){} }
function updateWishlistButton(id){
  var button=$('#modalWishlist'); if(!button) return;
  var saved=isWishlisted(id); button.textContent=saved?'♥':'♡'; button.setAttribute('aria-pressed',saved?'true':'false');
  button.setAttribute('aria-label',saved?'Remove from wishlist':'Save to wishlist'); button.title=saved?'Remove from wishlist':'Save to wishlist';
}
function toggleWishlist(id){
  if(isWishlisted(id)) wishlistIds=wishlistIds.filter(function(saved){ return String(saved)!==String(id); }); else wishlistIds.push(id);
  saveWishlist(); updateWishlistButton(id);
  try{ window.dispatchEvent(new CustomEvent('kinetic:wishlist-changed',{detail:{id:id,saved:isWishlisted(id)}})); }catch(e){}
  var __wLive=(window.KINETIC_API_MODE==='live');
  toast(isWishlisted(id)?'Added to wishlist':'Removed from wishlist',
    isWishlisted(id)?(__wLive?'Saved to your KINETIC account.':'Saved in this browser for later.'):'Removed from your saved items.','bg-ink text-flame');
}
function updateBodyScrollLock(){
  var locked=!!(document.querySelector('#cartDrawer.open')||document.querySelector('#searchOverlay.show')||document.querySelector('#productOverlay.show')||document.querySelector('#mobileMenu.open'));
  document.body.style.overflow=locked?'hidden':'';
}
function setLayerState(el,open){
  if(!el) return; el.setAttribute('aria-hidden',open?'false':'true');
  if('inert' in el) el.inert=!open;
}
function visibleFocusable(container){
  if(!container) return [];
  return Array.prototype.slice.call(container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(function(el){ return !el.hidden && el.getAttribute('aria-hidden')!=='true' && el.getClientRects().length>0; });
}
function topOpenLayer(){
  if($('#productOverlay')&&$('#productOverlay').classList.contains('show')) return {name:'product',element:$('#productModal')||$('#productOverlay')};
  if($('#searchOverlay')&&$('#searchOverlay').classList.contains('show')) return {name:'search',element:$('#searchOverlay')};
  if($('#cartDrawer')&&$('#cartDrawer').classList.contains('open')) return {name:'cart',element:$('#cartDrawer')};
  if($('#mobileMenu')&&$('#mobileMenu').classList.contains('open')) return {name:'menu',element:$('#mobileMenu')};
  return null;
}
function trapTabFocus(event){
  var layer=topOpenLayer(); if(!layer) return; var nodes=visibleFocusable(layer.element); if(!nodes.length){ event.preventDefault(); layer.element.setAttribute('tabindex','-1'); layer.element.focus(); return; }
  var first=nodes[0], last=nodes[nodes.length-1];
  if(event.shiftKey && (document.activeElement===first||!layer.element.contains(document.activeElement))){ event.preventDefault(); last.focus(); }
  else if(!event.shiftKey && (document.activeElement===last||!layer.element.contains(document.activeElement))){ event.preventDefault(); first.focus(); }
}
function closeTopOpenLayer(){
  var layer=topOpenLayer(); if(!layer) return;
  if(layer.name==='product') closeProduct(); else if(layer.name==='search') closeSearch(); else if(layer.name==='cart') closeCart(); else closeMenu();
}

/* PRELOADER */
var preloader=$('#preloader'), prog=0, introDone=false, preloaderFinished=false, preTimer=null;
function heroIntro(){
  if(introDone) return; introDone=true;
  $$('.hero-el').forEach(function(el,i){
    if(reduced){el.style.opacity='1';el.style.transform='none';el.style.transition='none';return;}
    el.style.opacity='0';el.style.transform='translateY(38px)';el.style.transition='opacity .95s cubic-bezier(.16,1,.3,1), transform .95s cubic-bezier(.16,1,.3,1)';
    window.setTimeout(function(){el.style.opacity='1';el.style.transform='none';},90+i*110);
  });
  $$('.mask-line').forEach(function(el,i){ if(reduced){el.classList.add('in');return;} window.setTimeout(function(){el.classList.add('in');},180+i*140); });
}
function setPreloaderProgress(value){
  prog=Math.max(0,Math.min(100,value)); var bar=$('#loadBar'),pct=$('#loadPct');
  if(bar) bar.style.width=prog+'%'; if(pct) pct.textContent=String(Math.floor(prog));
}
function finishLoad(){
  if(preloaderFinished) return; preloaderFinished=true; setPreloaderProgress(100);
  if(preloader) preloader.classList.add('done');
  document.body.classList.remove('loading'); document.body.style.overflow=''; window.__kineticPreloaderDone=true;
  if(window.__kineticPreloaderFailSafe) window.clearTimeout(window.__kineticPreloaderFailSafe);
  if(window.__kineticPreloaderHardFailSafe) window.clearTimeout(window.__kineticPreloaderHardFailSafe);
  if(preTimer) window.clearInterval(preTimer);
  if(reduced) heroIntro(); else window.setTimeout(heroIntro,60);
}
window.__kineticFinishLoading=finishLoad;
if(reduced){ finishLoad(); }
else{
  preTimer=window.setInterval(function(){
    setPreloaderProgress(Math.min(100,prog+Math.random()*17+8));
    if(prog>=100) finishLoad();
  },130);
  window.setTimeout(function(){ if(!preloaderFinished){ finishLoad(); if(preloader) preloader.style.display='none'; } },3800);
}

/* REVEALS */
var revealEls=$$('.reveal, .reveal-l');
if('IntersectionObserver' in window){
  var io=new IntersectionObserver(function(entries){ entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} }); },{threshold:0.1, rootMargin:'0px 0px -6% 0px'});
  revealEls.forEach(function(el){ io.observe(el); });
}else{ revealEls.forEach(function(el){ el.classList.add('in'); }); }
window.setTimeout(function(){ $$('.reveal, .reveal-l').forEach(function(el){ var r=el.getBoundingClientRect(); if(r.top<window.innerHeight) el.classList.add('in'); }); },2600);

/* COUNTERS */
function counterTarget(el){
  var value=el.dataset.stat?Number(KINETIC_CONFIG.marketing[el.dataset.stat]):Number(el.dataset.target||0);
  var divisor=Number(el.dataset.divisor||1); if(!Number.isFinite(value)) value=0; if(Number.isFinite(divisor)&&divisor>0) value/=divisor; return value;
}
function setCounterFinal(el){ el.dataset.done='1'; el.textContent=Math.round(counterTarget(el)).toLocaleString('en-US'); }
function animateCount(el){
  if(el.dataset.done) return; el.dataset.done='1'; var target=counterTarget(el);
  if(reduced||typeof window.requestAnimationFrame!=='function'||typeof window.performance==='undefined'){setCounterFinal(el);return;}
  var start=window.performance.now();
  function step(now){
    try{
      var progress=clamp((now-start)/1500,0,1), eased=1-Math.pow(1-progress,3);
      el.textContent=Math.round(target*eased).toLocaleString('en-US');
      if(progress<1) window.requestAnimationFrame(step); else setCounterFinal(el);
    }catch(e){setCounterFinal(el);}
  }
  try{window.requestAnimationFrame(step);}catch(e){setCounterFinal(el);}
}
var counters=$$('.counter');
counters.forEach(setCounterFinal);
if('IntersectionObserver' in window){
  try{var counterObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){animateCount(entry.target);counterObserver.unobserve(entry.target);}});},{threshold:0.4});counters.forEach(function(counter){counterObserver.observe(counter);});}
  catch(e){counters.forEach(setCounterFinal);}
}else counters.forEach(animateCount);

/* BARS */
function barTarget(el){ var key=el&&el.dataset.stat, raw=key?KINETIC_CONFIG.marketing[key]:(el&&el.dataset.width); var value=Number(raw); return Number.isFinite(value)?clamp(value,0,100):0; }
var bars=$$('.bar-fill');
if('IntersectionObserver' in window){ var bio=new IntersectionObserver(function(entries){ entries.forEach(function(e){ if(e.isIntersecting){ e.target.style.width=barTarget(e.target)+'%'; bio.unobserve(e.target);} }); },{threshold:0.3}); bars.forEach(function(b){ bio.observe(b); }); } else bars.forEach(function(b){ b.style.width=barTarget(b)+'%'; });

/* IMG FALLBACK */
function bindImgFallback(scope){ $$('img', scope).forEach(function(img){ if(img.dataset.fb) return; img.dataset.fb='1'; img.addEventListener('error', function(){ img.classList.add('img-fallback'); }); }); }
bindImgFallback(document);

/* CURSOR */
var dot=$('#cursorDot'), ring=$('#cursorRing');
if(dot && ring && !matchesMedia('(pointer:coarse)')){
  var mx=window.innerWidth/2, my=window.innerHeight/2, rx=mx, ry=my;
  window.addEventListener('mousemove', function(e){ mx=e.clientX; my=e.clientY; dot.style.left=mx+'px'; dot.style.top=my+'px'; });
  (function loop(){ rx+=(mx-rx)*0.16; ry+=(my-ry)*0.16; ring.style.left=rx+'px'; ring.style.top=ry+'px'; requestAnimationFrame(loop); })();
  document.addEventListener('mouseover', function(e){ var t=e.target; if(!t||!t.closest) return; ring.classList.toggle('grow', !!t.closest('a,button,select,input,.p-card,.look-card,.tech-item')); });
}

/* MAGNETIC */
if(!matchesMedia('(pointer:coarse)') && !reduced){
  $$('.magnetic').forEach(function(el){
    el.addEventListener('mousemove', function(e){ var r=el.getBoundingClientRect(); var x=e.clientX-r.left-r.width/2; var y=e.clientY-r.top-r.height/2; el.style.transform='translate('+(x*0.16)+'px,'+(y*0.22)+'px)'; });
    el.addEventListener('mouseleave', function(){ el.style.transform='translate(0,0)'; });
  });
}

/* HEADER / SCROLL */
var header=$('#siteHeader'), progress=$('#scrollProgress'), toTop=$('#toTop'), ticking=false;
function onScroll(){
  var y=window.scrollY||window.pageYOffset;
  if(header){ if(y>40) header.classList.add('bg-ink/88','backdrop-blur-xl','border-b','border-white/10'); else header.classList.remove('bg-ink/88','backdrop-blur-xl','border-b','border-white/10'); }
  if(progress){ var h=document.documentElement.scrollHeight-window.innerHeight; progress.style.width=(h>0?(y/h)*100:0)+'%'; }
  if(toTop){ if(y>600){ toTop.style.opacity='1'; toTop.style.pointerEvents='auto'; } else { toTop.style.opacity='0'; toTop.style.pointerEvents='none'; } }
  var shoe=$('#heroShoe'); if(shoe && y < window.innerHeight*1.3 && !reduced){ shoe.style.transform='translateY('+(y*0.05)+'px) scale('+(1+y*0.00007)+')'; }
  ticking=false;
}
window.addEventListener('scroll', function(){ if(!ticking){ ticking=true; requestAnimationFrame(onScroll); } },{passive:true}); onScroll();
if(toTop) toTop.addEventListener('click', function(){ window.scrollTo({top:0, behavior:'smooth'}); });

/* CONFIGURED FOOTER DESTINATIONS */
$$('[data-destination]').forEach(function(button){
  button.addEventListener('click',function(){
    var key=button.getAttribute('data-destination');
    /* Size guide opens the real size table (kinetic-product.js) — no external destination exists. */
    if(key==='sizeGuide'&&typeof window.KINETIC_openSizeGuide==='function'){ window.KINETIC_openSizeGuide(); return; }
    var destination=String(KINETIC_CONFIG.destinations[key]||'').trim();
    if(!destination){ toast('Link not configured','Add the official '+button.textContent.trim()+' destination in KINETIC_CONFIG.destinations.','bg-ink text-flame'); return; }
    if(/^(mailto:|tel:)/i.test(destination)){window.location.href=destination;return;}
    if(destination.charAt(0)==='#'){window.location.hash=destination.slice(1);return;}
    try{var parsed=new URL(destination,window.location.href);if(parsed.origin===window.location.origin){window.location.assign(parsed.href);}else{window.open(parsed.href,'_blank','noopener,noreferrer');}}
    catch(e){toast('Invalid link','Check the '+button.textContent.trim()+' destination in KINETIC_CONFIG.','bg-ink text-flame');}
  });
});

/* MOBILE MENU */
var menu=$('#mobileMenu');
function openMenu(){ if(!menu) return; closeCart(false); closeSearch(false); closeProduct(false); menuReturnFocus=document.activeElement; menu.classList.add('open'); if(menuBtn) menuBtn.setAttribute('aria-expanded','true'); setLayerState(menu,true); updateBodyScrollLock(); window.setTimeout(function(){if($('#menuClose')) $('#menuClose').focus();},0); }
function closeMenu(restoreFocus){ if(!menu) return; menu.classList.remove('open'); if(menuBtn) menuBtn.setAttribute('aria-expanded','false'); setLayerState(menu,false); updateBodyScrollLock(); if(restoreFocus!==false&&menuReturnFocus&&document.contains(menuReturnFocus)) menuReturnFocus.focus(); menuReturnFocus=null; }
var menuBtn=$('#menuBtn'); if(menuBtn) menuBtn.addEventListener('click', openMenu);
var menuClose=$('#menuClose'); if(menuClose) menuClose.addEventListener('click', closeMenu);
$$('.mob-link').forEach(function(a){ a.addEventListener('click', closeMenu); });

/* PRODUCT MODAL */
var productOverlay=$('#productOverlay'), modalImg=$('#modalImg'), modalVideo=$('#modalVideo'), modalName=$('#modalName'), modalCat=$('#modalCat'), modalPrice=$('#modalPrice'), modalOld=$('#modalOld'), modalSave=$('#modalSave'), modalDesc=$('#modalDesc'), modalColors=$('#modalColors'), modalSizes=$('#modalSizes'), modalColorName=$('#modalColorName');
if(modalColors) modalColors.addEventListener('click',function(event){
  var button=event.target.closest&&event.target.closest('.color-choice'); if(!button||!modalColors.contains(button)||modalProduct===null) return;
  var option=setProductColorway(modalProduct,button.dataset.color); if(!option) return;
  selectedColor=option.hex;
  $$('.color-choice',modalColors).forEach(function(item){item.setAttribute('aria-pressed',item===button?'true':'false');});
  if(modalColorName) modalColorName.textContent=option.name;
  var colorMessage=$('#colorSelectMessage'); if(colorMessage){colorMessage.textContent='';colorMessage.classList.add('hidden');}
});
if(modalSizes) modalSizes.addEventListener('click',function(event){
  var button=event.target.closest&&event.target.closest('.size-btn'); if(!button||!modalSizes.contains(button)) return;
  selectedSize=String(button.dataset.s||'').trim();
  $$('.size-btn',modalSizes).forEach(function(item){var active=item===button;item.setAttribute('aria-pressed',active?'true':'false');item.classList.toggle('is-selected',active);});
  var message=$('#sizeSelectMessage'); if(message){message.textContent='';message.classList.add('hidden');}
});
function openProductMediaDB(){
  if(mediaDBPromise) return mediaDBPromise;
  mediaDBPromise=new Promise(function(resolve,reject){
    if(!window.indexedDB){ reject(new Error('Browser storage is unavailable')); return; }
    var request;
    try{ request=window.indexedDB.open('kinetic-product-media',1); }catch(err){ reject(err); return; }
    request.onupgradeneeded=function(){ var db=request.result; if(!db.objectStoreNames.contains('products')) db.createObjectStore('products',{keyPath:'productId'}); };
    request.onsuccess=function(){ resolve(request.result); };
    request.onerror=function(){ reject(request.error||new Error('Could not open media storage')); };
    request.onblocked=function(){ reject(new Error('Media storage is blocked')); };
  });
  return mediaDBPromise;
}
function loadProductUploads(productId){
  if(Object.prototype.hasOwnProperty.call(mediaMemory,productId)) return Promise.resolve(mediaMemory[productId].slice());
  return openProductMediaDB().then(function(db){ return new Promise(function(resolve,reject){
    var tx=db.transaction('products','readonly'), request=tx.objectStore('products').get(productId);
    request.onsuccess=function(){ resolve(request.result&&request.result.items||[]); };
    request.onerror=function(){ reject(request.error||new Error('Could not read uploads')); };
  }); }).then(function(items){
    var ready=items.map(function(item){ return {name:item.name,type:item.type,blob:item.blob,url:URL.createObjectURL(item.blob),uploaded:true}; });
    mediaMemory[productId]=ready; return ready.slice();
  }).catch(function(){ return mediaMemory[productId]||[]; });
}
function renderProductMedia(){
  if(!productMediaItems.length) return;
  var item=productMediaItems[productMediaIndex]||productMediaItems[0];
  var video=item.type&&item.type.indexOf('video/')===0;
  if(video){
    if(modalImg){ modalImg.classList.add('hidden'); modalImg.style.display='none'; }
    if(modalVideo){ modalVideo.classList.remove('hidden'); modalVideo.style.display='block'; if(modalVideo.src!==item.url){ modalVideo.src=item.url; modalVideo.load(); } }
  }else{
    if(modalVideo){ modalVideo.pause(); modalVideo.removeAttribute('src'); modalVideo.load(); modalVideo.classList.add('hidden'); modalVideo.style.display='none'; }
    if(modalImg){ modalImg.src=item.url; kApplyResponsive(modalImg,item.url,'(max-width:640px) 92vw, 46vw'); setKineticImageDimensions(modalImg,item.url); modalImg.alt='Illustrative product photo for '+(item.name||'selected item'); modalImg.classList.remove('hidden'); modalImg.style.display='block'; }
  }
  var count=$('#modalMediaCount'); if(count) count.textContent=(productMediaIndex+1)+' / '+productMediaItems.length;
  var prev=$('#mediaPrev'), next=$('#mediaNext');
  if(prev) prev.classList.toggle('hidden',productMediaItems.length<2);
  if(next) next.classList.toggle('hidden',productMediaItems.length<2);
  var strip=$('#modalMediaThumbs');
  if(strip){
    strip.style.display=productMediaItems.length>1?'flex':'none';
    strip.innerHTML=productMediaItems.map(function(media,index){
      var active=index===productMediaIndex?' active':'';
      var preview=media.type&&media.type.indexOf('video/')===0?'<video src="'+media.url+'" muted preload="metadata" playsinline></video><span class="media-play">▶</span>':'<img src="'+media.url+'" alt="Product photo '+(index+1)+'" loading="lazy" decoding="async" width="1100" height="733"/>';
      return '<button type="button" class="media-thumb'+active+'" data-index="'+index+'" aria-label="Show '+(media.type&&media.type.indexOf('video/')===0?'video':'photo')+' '+(index+1)+'">'+preview+'</button>';
    }).join('');
    applyKineticImageDimensions(strip);
    $$('.media-thumb',strip).forEach(function(button){ button.addEventListener('click',function(){ productMediaIndex=parseInt(button.dataset.index,10)||0; renderProductMedia(); }); });
  }
}
function stepProductMedia(direction){ if(productMediaItems.length<2) return; productMediaIndex=(productMediaIndex+direction+productMediaItems.length)%productMediaItems.length; renderProductMedia(); }
function openProduct(id,returnFocus,preferredColor){
  var p=getProductById(id); if(!p||!isValidProduct(p)) return;
  closeSearch(false); closeMenu(false);
  productReturnFocus=returnFocus||document.activeElement;
  modalProduct=p.id; mediaProductId=p.id;
  var baseMedia={name:p.name,type:'image/jpeg',url:p.img,uploaded:false};
  productMediaItems=[baseMedia]; productMediaIndex=0; renderProductMedia();
  var uploadStatus=$('#mediaUploadStatus'); if(uploadStatus) uploadStatus.textContent='Loading saved product media…';
  loadProductUploads(p.id).then(function(extra){
    if(String(mediaProductId)!==String(p.id)) return;
    productMediaItems=[baseMedia].concat(extra); productMediaIndex=0; renderProductMedia();
    if(uploadStatus) uploadStatus.textContent=extra.length?extra.length+' uploaded file(s) saved for this product. Add more anytime.':'No uploads yet. Select multiple photos or videos to add them.';
  });
  if(modalName) modalName.textContent=p.name;
  if(modalCat) modalCat.textContent=p.cat+' /// '+String(Number(p.id)+1).padStart(3,'0');
  if(modalPrice) modalPrice.textContent='$'+p.price;
  if(modalDesc) modalDesc.textContent=p.desc||'';
  if(p.old){ if(modalOld){modalOld.textContent='$'+p.old;modalOld.style.display='inline';} var savings=Math.round((1-p.price/p.old)*100); if(modalSave){modalSave.textContent='SAVE '+savings+'%';modalSave.classList.remove('hidden');} }
  else{ if(modalOld) modalOld.style.display='none'; if(modalSave) modalSave.classList.add('hidden'); }
  var hasChosenColor=!!explicitlySelectedColorsByProduct[String(p.id)];
  var initialColorway=hasChosenColor?getProductColorway(p,preferredColor||selectedColorsByProduct[String(p.id)]):null;
  selectedColor=initialColorway?initialColorway.hex:null;
  renderColorChoices(modalColors,p,selectedColor,'modal');
  if(modalColorName) modalColorName.textContent=initialColorway?initialColorway.name:'Choose colour';
  var sizes=PRODUCT_SIZES; selectedSize=null;
  if(modalSizes) modalSizes.innerHTML=sizes.map(function(size){ return '<button type="button" class="size-btn border-2 py-2.5 font-black text-[12px] tracking-[.08em] border-ink/20 hover:border-ink" data-s="'+size+'" aria-pressed="false">US '+size+'</button>'; }).join('');
  var sizeMessage=$('#sizeSelectMessage'); if(sizeMessage){sizeMessage.textContent='';sizeMessage.classList.add('hidden');}
  var colorMessage=$('#colorSelectMessage'); if(colorMessage){colorMessage.textContent='';colorMessage.classList.add('hidden');}
  updateWishlistButton(p.id);
  var detailsLink=$('#modalFullDetails'); if(detailsLink) detailsLink.setAttribute('href','#product/'+encodeURIComponent(p.id));
  productOverlay.classList.add('show'); setLayerState(productOverlay,true); updateBodyScrollLock();
  window.setTimeout(function(){ if($('#modalClose')) $('#modalClose').focus(); },0);
}
function closeProduct(restoreFocus){
  if(modalVideo) modalVideo.pause(); if(productOverlay) productOverlay.classList.remove('show'); setLayerState(productOverlay,false); updateBodyScrollLock();
  if(restoreFocus!==false&&productReturnFocus&&document.contains(productReturnFocus)) productReturnFocus.focus(); productReturnFocus=null;
}
if(productOverlay) productOverlay.addEventListener('click',function(e){ if(e.target===productOverlay) closeProduct(); });
var modalClose=$('#modalClose'); if(modalClose) modalClose.addEventListener('click',function(){ closeProduct(); });
var mediaPrev=$('#mediaPrev'), mediaNext=$('#mediaNext');
if(mediaPrev) mediaPrev.addEventListener('click',function(){ stepProductMedia(-1); });
if(mediaNext) mediaNext.addEventListener('click',function(){ stepProductMedia(1); });
var modalAdd=$('#modalAdd'); if(modalAdd) modalAdd.addEventListener('click',function(){
  if(modalProduct===null) return;
  if(!selectedSize){ var message=$('#sizeSelectMessage'); if(message){message.textContent='Choose a US size before adding this sneaker to your bag.';message.classList.remove('hidden');} toast('Choose a size','Select a US size before adding this sneaker to your bag.','bg-ink text-flame'); var firstSize=$('.size-btn',modalSizes); if(firstSize) firstSize.focus(); return; }
  if(!selectedColor){ var colorMessage=$('#colorSelectMessage'); if(colorMessage){colorMessage.textContent='Choose a colourway before adding this sneaker to your bag.';colorMessage.classList.remove('hidden');} toast('Choose a colour','Select a colourway before adding this sneaker to your bag.','bg-ink text-flame'); var firstColor=$('.color-choice',modalColors); if(firstColor) firstColor.focus(); return; }
  if(addToCart(modalProduct,selectedSize,selectedColor)){ closeProduct(); openCart(); }
});
var modalWish=$('#modalWishlist'); if(modalWish) modalWish.addEventListener('click',function(){ if(modalProduct!==null) toggleWishlist(modalProduct); });
$$('[data-open-product]').forEach(function(button){ button.addEventListener('click',function(){ openProduct(button.dataset.openProduct,button); }); });

/* SEARCH */
var searchOverlay=$('#searchOverlay'), searchInput=$('#searchInput');
function renderSearch(q){
  if(typeof window.KINETIC_FILTERS!=='undefined'&&window.KINETIC_FILTERS.renderSearchOverlay){
    try{ window.KINETIC_FILTERS.renderSearchOverlay(q); return; }catch(e){ /* fall through to the simple list */ }
  }
  var box=$('#searchResults'); if(!box) return; q=(q||'').toLowerCase().trim();
  var res=PRODUCTS.filter(isValidProduct).filter(function(p){ return !q || p.name.toLowerCase().indexOf(q)>-1 || p.cat.toLowerCase().indexOf(q)>-1 || String(p.tag).toLowerCase().indexOf(q)>-1; }).slice(0,4);
  if(res.length){ box.innerHTML=res.map(function(p){ return '<button class="search-item flex items-center gap-4 bg-white/[.04] border border-white/12 hover:border-flame p-3 text-left transition-colors" data-id="'+p.id+'"><span class="img-wrap w-[62px] h-[62px] shrink-0 block"><img src="'+p.img+'" class="w-full h-full object-cover" alt="" loading="lazy" decoding="async" width="1100" height="733"/></span><span class="flex-1"><span class="block font-black tracking-[.06em] text-[13px] uppercase">'+p.name+'</span><span class="block font-mono2 text-[11px] text-white/45 mt-1 tracking-[.16em] uppercase">'+p.cat+' — $'+p.price+'</span></span><span class="display text-2xl text-flame">→</span></button>'; }).join(''); }
  else { box.innerHTML='<div class="text-white/40 font-mono2 text-[12px] tracking-[.22em] uppercase text-center py-8">No results — try “carbon” or “court”</div>'; }
  applyKineticImageDimensions(box);
  $$('.search-item',box).forEach(function(btn){ btn.addEventListener('click',function(){ var id=btn.dataset.id; closeSearch(false); openProduct(id,searchBtn); }); });
  bindImgFallback(box);
}
function openSearch(){ if(!searchOverlay) return; closeProduct(false); closeCart(false); closeMenu(false); searchReturnFocus=document.activeElement; searchOverlay.classList.add('show'); setLayerState(searchOverlay,true); if(searchBtn) searchBtn.setAttribute('aria-expanded','true'); updateBodyScrollLock(); renderSearch(''); window.setTimeout(function(){ if(searchInput) searchInput.focus(); },0); }
function closeSearch(restoreFocus){ if(!searchOverlay) return; searchOverlay.classList.remove('show'); setLayerState(searchOverlay,false); if(searchBtn) searchBtn.setAttribute('aria-expanded','false'); updateBodyScrollLock(); if(restoreFocus!==false&&searchReturnFocus&&document.contains(searchReturnFocus)) searchReturnFocus.focus(); searchReturnFocus=null; }
var searchBtn=$('#searchBtn'); if(searchBtn) searchBtn.addEventListener('click', openSearch);
var searchClose=$('#searchClose'); if(searchClose) searchClose.addEventListener('click', closeSearch);
if(searchOverlay) searchOverlay.addEventListener('click', function(e){ if(e.target===searchOverlay) closeSearch(); });
if(searchInput) searchInput.addEventListener('input', function(e){ renderSearch(e.target.value); });

/* PRODUCTS GRID */
var activeFilter='All', sortMode='feat';
/* mobile image variants: 480w / 900w live in assets/images/m/ (falls back automatically)
   `sizes` is per context — the same photo is 24vw in the grid and 76vw in the lookbook. */
function kResponsiveAttrs(src,sizes){
  var m=/^assets\/images\/([A-Za-z0-9._-]+)\.jpg$/i.exec(String(src||''));
  if(!m) return '';
  return 'srcset="assets/images/m/'+m[1]+'-480.jpg 480w, assets/images/m/'+m[1]+'-900.jpg 900w, '+escapeHtml(src)+' 1100w" sizes="'+(sizes||'(max-width:640px) 92vw, (max-width:1024px) 46vw, 24vw')+'"';
}
function kCardSrcset(src){ return kResponsiveAttrs(src); }
/* set both attributes on an existing element (used when a panel swaps its photo) */
function kApplyResponsive(img,src,sizes){
  var m=/^assets\/images\/([A-Za-z0-9._-]+)\.jpg$/i.exec(String(src||''));
  if(!img||!m) return;
  img.setAttribute('srcset','assets/images/m/'+m[1]+'-480.jpg 480w, assets/images/m/'+m[1]+'-900.jpg 900w, '+src+' 1100w');
  img.setAttribute('sizes',sizes||'(max-width:640px) 92vw, (max-width:1024px) 46vw, 24vw');
}
function tagStyle(tag){ var t=String(tag).toLowerCase(); if(t==='limited') return 'bg-flame text-ink'; if(t==='new') return 'bg-ink text-flame'; if(t==='hot') return 'bg-ember text-white'; return 'bg-white text-ink border border-ink'; }
function renderProducts(){
  var grid=$('#productGrid'); if(!grid) return;
  var available=[];
  PRODUCTS.forEach(function(product){ try{ if(isValidProduct(product)) available.push(product); }catch(e){} });
  var KF=(typeof window.KINETIC_FILTERS!=='undefined')?window.KINETIC_FILTERS:null, list;
  if(KF&&typeof KF.match==='function'){
    /* the live search/filter engine decides what shows and in which order */
    list=available.filter(function(p){ try{ return KF.match(p); }catch(e){ return true; } });
    if(typeof KF.sort==='function') list=KF.sort(list);
  }else{
    list=available.filter(function(p){
      if(activeFilter==='All') return true;
      if(activeFilter==='Limited') return p.tag==='Limited'||p.tag==='Hot';
      return p.cat===activeFilter;
    });
    if(sortMode==='feat') list=list.slice().sort(function(a,b){ return (b.featured?1:0)-(a.featured?1:0); });
    else if(sortMode==='low') list=list.slice().sort(function(a,b){ return Number(a.price)-Number(b.price); });
    else if(sortMode==='high') list=list.slice().sort(function(a,b){ return Number(b.price)-Number(a.price); });
    else if(sortMode==='rate') list=list.slice().sort(function(a,b){ return Number(b.rating)-Number(a.rating); });
  }
  var cards=[];
  list.forEach(function(p,idx){
    try{
      var selectedCardColor=getExplicitlySelectedColorway(p), colors=getProductColorways(p).map(function(option){ return colorChoiceMarkup(option,!!selectedCardColor&&option.hex===selectedCardColor.hex,'card',p.id); }).join(''), selectedCardColorName=selectedCardColor?selectedCardColor.name:'Choose colour';
      var badge=escapeHtml(p.tag||'');
      cards.push('<article class="p-card cursor-pointer" role="group" tabindex="0" aria-label="'+escapeHtml(p.name)+' product" data-id="'+escapeHtml(p.id)+'" style="transition-delay:'+(idx*0.05)+'s">'
        +'<div class="relative img-wrap h-[300px] lg:h-[320px] bg-[#0F0F12]"><img src="'+escapeHtml(p.img)+'" '+kCardSrcset(p.img)+' alt="Illustrative product photo for '+escapeHtml(p.name)+'" loading="lazy" decoding="async" width="1100" height="733" class="p-img w-full h-full object-cover" />'
        +'<div class="absolute top-3.5 left-3.5 '+tagStyle(p.tag)+' px-3 py-1.5 text-[10px] font-black tracking-[.18em] uppercase">'+badge+'</div>'
        +(p.old?'<div class="absolute bottom-3.5 left-3.5 bg-ink text-flame px-2.5 py-1.5 text-[10px] font-black tracking-[.16em]">SAVE '+Math.round((1-Number(p.price)/Number(p.old))*100)+'%</div>':'')
        +'<a class="absolute top-3.5 right-3.5 bg-cream text-ink w-8 h-8 flex items-center justify-center border border-ink/10 text-[11px] full-details" href="#product/'+escapeHtml(p.id)+'" aria-label="Open the full details page for '+escapeHtml(p.name)+'" title="Full details">↗</a>'
        +'<div class="shoe-reflection"></div>'
        +'<div class="quick-bar absolute bottom-0 left-0 right-0 flex"><button type="button" class="quick-add flex-1 bg-ink text-flame py-3.5 text-[10.5px] font-black tracking-[.22em] uppercase hover:bg-flame hover:text-ink transition-colors" data-id="'+escapeHtml(p.id)+'" aria-label="Quick add '+escapeHtml(p.name)+'">Quick add</button><button type="button" class="quick-view w-[58px] bg-flame text-ink text-lg font-black border-l-2 border-ink hover:bg-cream transition-colors" data-id="'+escapeHtml(p.id)+'" aria-label="Quick view '+escapeHtml(p.name)+'">→</button></div>'
        +'</div>'
        +'<div class="p-5"><div class="font-mono2 text-[10px] tracking-[.26em] text-ink/45 font-semibold uppercase">'+escapeHtml(p.cat)+' /// '+String(Number(p.id)+1).padStart(3,'0')+'</div><h3 class="font-black text-[16px] leading-tight mt-2 tracking-[-.01em]">'+escapeHtml(p.name)+'</h3><div class="flex items-end justify-between mt-3"><div class="flex items-baseline gap-2.5"><span class="display text-[1.55rem] leading-none">$'+Number(p.price).toLocaleString('en-US')+'</span>'+(p.old?'<span class="text-ink/35 line-through font-bold text-[12px]">$'+Number(p.old).toLocaleString('en-US')+'</span>':'')+'</div><div class="text-right"><div class="text-[12px] font-black">★ '+Number(p.rating).toFixed(1)+'</div><div class="font-mono2 text-[10px] text-ink/45">'+(Number(p.reviews)/1000).toFixed(1)+'k reviews</div></div></div><div class="flex items-center gap-2 mt-4 flex-wrap" role="group" aria-label="Colourways for '+escapeHtml(p.name)+'">'+colors+'<span class="font-mono2 text-[9px] tracking-[.08em] text-ink/55 ml-1" data-card-color-name="'+escapeHtml(p.id)+'">'+escapeHtml(selectedCardColorName)+'</span></div></div>'
        +'</article>');
    }catch(e){ /* Skip only this malformed card; other valid products still render. */ }
  });
  var count=cards.length, rc=$('#resultCount');
  if(rc) rc.textContent=count+(count===1?' Product':' Products');
  grid.innerHTML=count?cards.join(''):'<div class="sm:col-span-2 lg:col-span-4 border border-ink/20 bg-white p-10 text-center"><div class="display text-3xl">No sneakers found</div><p class="font-mono2 text-[11px] tracking-[.16em] text-ink/55 mt-3">Try another collection filter.</p></div>';
  applyKineticImageDimensions(grid);
  if(grid.dataset.colorwayEventsBound!=='true'){
    grid.dataset.colorwayEventsBound='true';
    grid.addEventListener('click',function(event){
      var swatch=event.target.closest&&event.target.closest('.card-color-choice'); if(!swatch||!grid.contains(swatch)) return;
      event.preventDefault(); event.stopPropagation();
      var option=setProductColorway(swatch.dataset.productId,swatch.dataset.color); if(!option) return;
      var card=swatch.closest('.p-card'); if(!card) return;
      $$('.card-color-choice',card).forEach(function(button){button.setAttribute('aria-pressed',button===swatch?'true':'false');});
      var label=$('[data-card-color-name]',card); if(label) label.textContent=option.name;
    });
  }
  $$('.p-card',grid).forEach(function(card){
    card.addEventListener('click',function(e){ if(e.target.closest('.quick-add,.quick-view,.card-color-choice,.full-details')) return; openProduct(card.dataset.id,card); });
    card.addEventListener('keydown',function(e){ if(e.target===card&&(e.key==='Enter'||e.key===' ')){ e.preventDefault(); openProduct(card.dataset.id,card); } });
  });
  $$('.quick-add',grid).forEach(function(button){ button.addEventListener('click',function(e){ e.stopPropagation(); openProduct(button.dataset.id,button); }); });
  $$('.quick-view',grid).forEach(function(button){ button.addEventListener('click',function(e){ e.stopPropagation(); openProduct(button.dataset.id,button); }); });
  bindImgFallback(grid);
  if(KF&&typeof KF.afterRender==='function'){ try{ KF.afterRender(cards.length, available.length); }catch(e){} }
  if(!reduced && typeof window.requestAnimationFrame==='function'){
    window.requestAnimationFrame(function(){ $$('.p-card',grid).forEach(function(card,i){ card.style.opacity='0'; card.style.transform='translateY(26px)'; window.setTimeout(function(){ card.style.transition='opacity .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1), box-shadow .5s ease'; card.style.opacity='1'; card.style.transform='none'; },40+i*65); }); });
  }else{ $$('.p-card',grid).forEach(function(card){ card.style.opacity='1'; card.style.transform='none'; }); }
}
/* ---- filter row: categories come from the admin dashboard when it has them */
function categoryNames(){
  var out=[], seen={};
  var saved=(window.__KINETIC_CONTENT__||{}).categories;
  if(Array.isArray(saved)){
    saved.slice().sort(function(a,b){ return (Number(a&&a.order)||0)-(Number(b&&b.order)||0); }).forEach(function(c){
      var name=String((c&&c.name)||'').trim();
      if(!name||seen[name]) return;
      if(String((c&&c.status)||'active').toLowerCase()==='hidden') return;
      seen[name]=1; out.push(name);
    });
  }
  PRODUCTS.forEach(function(p){ if(p&&p.cat&&!seen[p.cat]){ seen[p.cat]=1; out.push(String(p.cat)); } });
  return out;
}
function renderFilters(){
  var row=$('#filterRow'); if(!row) return;
  if(typeof window.KINETIC_FILTERS!=='undefined'&&window.KINETIC_FILTERS.state){
    var kfS=window.KINETIC_FILTERS.state;
    var kfc=((typeof kfS==='function'?kfS():kfS)||{}).cats||[];
    activeFilter=(kfc.length===1)?kfc[0]:'All';
  }
  var names=['All'].concat(categoryNames());
  if(names.indexOf('Limited')===-1) names.push('Limited');
  if(names.indexOf(activeFilter)===-1) activeFilter='All';
  row.innerHTML=names.map(function(name){
    return '<button type="button" class="filter-btn'+(name===activeFilter?' active':'')+'" data-filter="'+escapeHtml(name)+'" aria-pressed="'+(name===activeFilter)+'">'+escapeHtml(name)+'</button>';
  }).join('');
}
function bindFilterRow(){
  var row=$('#filterRow'); if(!row||row.dataset.kbBound==='1') return;
  row.dataset.kbBound='1';
  row.addEventListener('click',function(event){
    var b=event.target.closest?event.target.closest('.filter-btn'):null;
    if(!b) return;
    activeFilter=b.dataset.filter;
    if(typeof window.KINETIC_FILTERS!=='undefined'&&window.KINETIC_FILTERS.setCategory){
      window.KINETIC_FILTERS.setCategory(activeFilter);   /* engine re-renders + syncs this row */
      return;
    }
    $$('.filter-btn',row).forEach(function(x){ x.classList.remove('active'); x.setAttribute('aria-pressed','false'); });
    b.classList.add('active'); b.setAttribute('aria-pressed','true');
    renderProducts();
  });
}
var sortSelect=$('#sortSelect'); if(sortSelect) sortSelect.addEventListener('change', function(e){
  if(typeof window.KINETIC_FILTERS!=='undefined'&&window.KINETIC_FILTERS.setSort){ if(window.KINETIC_FILTERS.setSort(e.target.value)) return; }
  sortMode=e.target.value; renderProducts();
});
bindFilterRow(); renderFilters(); renderProducts();

/* HERO VARIANTS + 3D TILT + DRAG */
var heroIdx=0, heroShoe=$('#heroShoe'), heroName=$('#heroName'), heroPrice=$('#heroPrice'), heroColorways=$('#heroColorways'), heroColorName=$('#heroColorName');
function updateHeroColorways(){
  var product=getProductById(HERO_VARIANTS[heroIdx].product), option=getSelectedColorway(product);
  if(!product) return;
  renderColorChoices(heroColorways,product,option?option.hex:null,'hero');
  if(heroColorName) heroColorName.textContent=option?option.name:'';
}
if(heroColorways) heroColorways.addEventListener('click',function(event){
  var button=event.target.closest&&event.target.closest('.color-choice'); if(!button||!heroColorways.contains(button)) return;
  var option=setProductColorway(HERO_VARIANTS[heroIdx].product,button.dataset.color); if(option) updateHeroColorways();
});
function heroSrcset(src){ var m=src.match(/assets\/images\/([^\/]+)\.jpg$/); if(!m) return null; var h=m[1]; return 'assets/images/m/'+h+'-480.jpg 480w, assets/images/m/'+h+'-900.jpg 900w, '+src+' 1100w'; }
function setHeroSrc(img,src){ img.src=src; var ss=heroSrcset(src); if(ss) img.setAttribute('srcset',ss); setKineticImageDimensions(img,src); }
function setHero(i){
  heroIdx=((i%HERO_VARIANTS.length)+HERO_VARIANTS.length)%HERO_VARIANTS.length;
  var variant=HERO_VARIANTS[heroIdx], product=getProductById(variant.product);
  if(!product) return;
  $$('.hero-thumb').forEach(function(t,k){ t.classList.toggle('active',k===heroIdx); t.setAttribute('aria-pressed',k===heroIdx?'true':'false'); });
  if(heroName) heroName.textContent=product.name;
  if(heroPrice) heroPrice.textContent='$'+product.price;
  var heroTag=$('#heroTag'); if(heroTag) heroTag.textContent=product.tag||'Featured';
  updateHeroColorways();
  if(!heroShoe){ return; }
  if(reduced){ setHeroSrc(heroShoe,variant.img); heroShoe.style.opacity='1'; heroShoe.style.transform='none'; return; }
  heroShoe.style.transition='opacity .32s ease, transform .5s cubic-bezier(.16,1,.3,1)';
  heroShoe.style.opacity='0'; heroShoe.style.transform='translateX(34px) rotate(3deg) scale(.98)';
  window.setTimeout(function(){ setHeroSrc(heroShoe,variant.img); heroShoe.style.opacity='1'; heroShoe.style.transform='translateX(0) rotate(0deg) scale(1)'; },300);
}
function restartHeroAuto(){ if(heroAuto) window.clearInterval(heroAuto); heroAuto=null; if(reduced) return; heroAuto=window.setInterval(function(){ setHero(heroIdx+1); },8500); }
$$('.hero-thumb').forEach(function(t){ t.addEventListener('click', function(){ setHero(parseInt(t.dataset.idx,10)); restartHeroAuto(); }); });
setHero(0); restartHeroAuto();
var heroAdd=$('#heroAdd'); if(heroAdd) heroAdd.addEventListener('click',function(){ var id=HERO_VARIANTS[heroIdx].product,option=getSelectedColorway(getProductById(id)); openProduct(id,heroAdd,option&&option.hex); });
var heroView=$('#heroView'); if(heroView) heroView.addEventListener('click', function(){ var id=HERO_VARIANTS[heroIdx].product,option=getSelectedColorway(getProductById(id)); openProduct(id,heroView,option&&option.hex); });

var stageInner=$('#stageInner'), stage=stageInner?stageInner.closest('.stage'):null;
var isDragging=false, startX=0, rotY=0, curRot=0;
function applyHeroTransform(rx,ry, scale){ if(!stageInner) return; stageInner.style.transform='rotateY('+ry+'deg) rotateX('+rx+'deg) translateZ(20px) scale('+(scale||1)+')'; }
if(stage && !matchesMedia('(pointer:coarse)') && !reduced){
  stage.addEventListener('mousemove', function(e){
    if(isDragging) return;
    var r=stage.getBoundingClientRect(); var x=(e.clientX-r.left)/r.width-0.5; var y=(e.clientY-r.top)/r.height-0.5;
    applyHeroTransform(-y*11, x*16, 1);
  });
  stage.addEventListener('mouseleave', function(){ if(!isDragging) applyHeroTransform(0,0,1); });
  stage.addEventListener('pointerdown', function(e){ isDragging=true; startX=e.clientX; curRot=rotY; stage.setPointerCapture(e.pointerId); stage.style.cursor='grabbing'; });
  window.addEventListener('pointermove', function(e){
    if(!isDragging) return;
    var dx=(e.clientX-startX)*0.35; rotY=curRot+dx;
    applyHeroTransform( -2, rotY*0.45, 1.02);
    if(heroShoe) { heroShoe.style.transform='translateX('+(dx*0.04)+'px) rotateY('+(dx*0.08)+'deg)'; }
  });
  window.addEventListener('pointerup', function(){
    if(!isDragging) return; isDragging=false; stage.style.cursor=''; 
    // snap to next variant if dragged far
    if(Math.abs(rotY-curRot)>60){ setHero(heroIdx + (rotY>curRot?1:-1)); restartHeroAuto(); }
    window.setTimeout(function(){ applyHeroTransform(0,0,1); if(heroShoe) heroShoe.style.transform='translateX(0) rotateY(0deg)'; },280);
    rotY=0; curRot=0;
  });
}
// touch swipe for mobile hero
if(stage){
  var tStart=null;
  stage.addEventListener('touchstart', function(e){ tStart=e.touches[0].clientX; }, {passive:true});
  stage.addEventListener('touchend', function(e){
    if(tStart===null) return; var dx=e.changedTouches[0].clientX - tStart;
    if(Math.abs(dx)>50){ setHero(heroIdx + (dx<0?1:-1)); restartHeroAuto(); }
    tStart=null;
  }, {passive:true});
}

/* TECH */
function setTech(i){
  $$('.tech-item').forEach(function(el,k){ el.classList.toggle('active', k===i); });
  $$('.tech-dot').forEach(function(el,k){ el.className='tech-dot w-9 h-[5px] transition-all duration-500 '+(k===i?'bg-flame':'bg-white/25'); el.setAttribute('aria-pressed',k===i?'true':'false'); });
  var img=$('#techImg'), label=$('#techLabel'); if(!img) return;
  img.style.opacity='0'; img.style.transform='scale(1.05)';
  /* srcset wins over src in every modern browser, so the new photo must be
     written to BOTH — otherwise switching tech tabs keeps showing the old one */
  window.setTimeout(function(){ img.src=TECH_IMGS[i].img; kApplyResponsive(img,TECH_IMGS[i].img,'(max-width:640px) 92vw, (max-width:1024px) 50vw, 40vw'); setKineticImageDimensions(img,TECH_IMGS[i].img); if(label) label.textContent=TECH_IMGS[i].label; img.style.opacity='1'; img.style.transform='scale(1)'; },260);
}
$$('[data-tech]').forEach(function(el){ el.addEventListener('click', function(){ setTech(parseInt(el.dataset.tech,10)); }); });

/* LOOKBOOK */
var lbTrack=$('#lbTrack');
if(lbTrack){
  lbTrack.innerHTML=LOOKS.map(function(l){
    return '<div class="look-card w-[76vw] sm:w-[350px] lg:w-[390px] shrink-0 border border-white/12 bg-ink text-cream">'
      +'<div class="relative img-wrap h-[400px] lg:h-[470px] bg-[#0A0A0A]"><img src="'+l.img+'" '+kResponsiveAttrs(l.img,'(max-width:640px) 76vw, 390px')+' alt="'+l.sub+'" loading="lazy" decoding="async" width="1100" height="733" class="w-full h-full object-cover" />'
      +'<div class="absolute inset-0 bg-gradient-to-t from-ink via-ink/25 to-transparent"></div><div class="shoe-reflection"></div>'
      +'<div class="absolute top-4 left-4 bg-flame text-ink px-3.5 py-1.5 text-[10px] font-black tracking-[.22em] uppercase">'+l.title+'</div>'
      +'<div class="absolute bottom-0 left-0 right-0 p-6"><div class="display text-[1.85rem] leading-none">'+l.sub+'</div><div class="mt-2 text-[10px] tracking-[.22em] uppercase text-cream/60">Illustrative photo</div><button class="look-shop mt-4 border border-flame text-flame px-5 py-2.5 text-[10.5px] font-black tracking-[.22em] uppercase hover:bg-flame hover:text-ink transition-colors" data-id="'+l.product+'">Shop the look →</button></div></div></div>';
  }).join('');
  applyKineticImageDimensions(lbTrack);
  bindImgFallback(lbTrack);
  $$('.look-shop', lbTrack).forEach(function(b){ b.addEventListener('click', function(e){ e.stopPropagation(); openProduct(parseInt(b.dataset.id,10)); }); });
  var down=false, sX=0, sScroll=0;
  lbTrack.addEventListener('pointerdown', function(e){ down=true; sX=e.pageX; sScroll=lbTrack.scrollLeft; lbTrack.classList.add('dragging'); });
  window.addEventListener('pointerup', function(){ down=false; lbTrack.classList.remove('dragging'); });
  window.addEventListener('pointermove', function(e){ if(!down) return; lbTrack.scrollLeft=sScroll-(e.pageX-sX); });
  var lbNext=$('#lbNext'), lbPrev=$('#lbPrev');
  if(lbNext) lbNext.addEventListener('click', function(){ lbTrack.scrollBy({left:380, behavior:'smooth'}); });
  if(lbPrev) lbPrev.addEventListener('click', function(){ lbTrack.scrollBy({left:-380, behavior:'smooth'}); });
}

/* REVIEWS */
var revIndex=0, revDots=$('#revDots');
if(revDots){
  revDots.innerHTML=REVIEWS.map(function(_,i){ return '<button type="button" class="rev-dot block cursor-pointer transition-all duration-500" data-i="'+i+'" aria-label="Show review '+(i+1)+' of '+REVIEWS.length+'" aria-pressed="'+(i===0?'true':'false')+'" style="width:34px;height:4px;background:'+(i===0?'#D4AF37':'rgba(255,255,255,.22)')+'"></button>'; }).join('');
  $$('.rev-dot', revDots).forEach(function(d){ d.addEventListener('click', function(){ setReview(parseInt(d.dataset.i,10)); restartRevAuto(); }); });
}
function setReview(i){
  revIndex=((i%REVIEWS.length)+REVIEWS.length)%REVIEWS.length;
  var r=REVIEWS[revIndex]; var box=$('#revBox'); if(!box) return;
  box.style.opacity='0'; box.style.transform='translateX(-22px)';
  window.setTimeout(function(){
    $('#revText').innerHTML='“'+r.text+'”'; $('#revName').textContent=r.name; $('#revMeta').textContent=r.meta; var av=$('#revAvatar'); if(av){ av.src=r.avatar; setKineticImageDimensions(av,r.avatar); }
    var idx=$('#revIdx'); if(idx) idx.textContent=String(revIndex+1).padStart(2,'0');
    $$('.rev-dot').forEach(function(d,k){ d.style.background=k===revIndex?'#D4AF37':'rgba(255,255,255,.22)'; d.style.width=k===revIndex?'48px':'34px'; d.setAttribute('aria-pressed',k===revIndex?'true':'false'); });
    box.style.opacity='1'; box.style.transform='translateX(0)';
  },280);
}
function restartRevAuto(){ if(revAuto) window.clearInterval(revAuto); revAuto=null; if(reduced) return; revAuto=window.setInterval(function(){ setReview(revIndex+1); },7500); }
setReview(0); restartRevAuto();
var revNext=$('#revNext'), revPrev=$('#revPrev');
if(revNext) revNext.addEventListener('click', function(){ setReview(revIndex+1); restartRevAuto(); });
if(revPrev) revPrev.addEventListener('click', function(){ setReview(revIndex-1); restartRevAuto(); });

/* CART + CHECKOUT */
var cart=[], promoActive=false, promoCodeApplied='', checkoutAttemptFingerprint='', checkoutAttemptKey='';
/* ---- cart persistence: the bag survives a refresh and stays in step with the
   checkout page (assets/kinetic-checkout.js). localStorage is the shared store. */
var CART_STORE_KEY='kinetic-cart-v1', cartEventSuppressed=false, cartEventSyncing=false;
function persistCart(){
  try{
    var payload={v:1,items:cart.map(function(it){return {id:it.id,size:it.size,color:it.color,colorName:it.colorName,qty:it.qty};}),promo:promoActive?promoCodeApplied:'',savedAt:Date.now()};
    localStorage.setItem(CART_STORE_KEY,JSON.stringify(payload));
  }catch(e){ /* private mode or a restricted preview — the in-memory cart still works */ }
  try{
    cartEventSuppressed=true;
    window.dispatchEvent(new CustomEvent('kinetic:cart-changed',{detail:{items:cart.slice()}}));
  }catch(e){}
  cartEventSuppressed=false;
}
function restoreCart(){
  var saved=null;
  try{ saved=JSON.parse(localStorage.getItem(CART_STORE_KEY)||'null'); }catch(e){ saved=null; }
  if(!saved||!Array.isArray(saved.items)) return false;
  var next=[];
  saved.items.forEach(function(it){
    if(!it) return;
    var product=getProductById(it.id); if(!product) return;
    try{ if(!isValidProduct(product)) return; }catch(e){ return; }
    var size=String(it.size===null||it.size===undefined?'':it.size).trim(); if(!size||size==='—') return;
    var colorway=getProductColorway(product,String(it.color||''));
    if(!colorway){ var firstWays=getProductColorways(product); colorway=firstWays.length?firstWays[0]:null; }
    if(!colorway) return;
    var line={id:product.id,size:size,color:colorway.hex,colorName:colorway.name,qty:Math.max(1,Math.min(9,parseInt(it.qty,10)||1))};
    var twin=null;
    for(var i=0;i<next.length;i++){ if(String(next[i].id)===String(line.id)&&next[i].size===line.size&&next[i].color===line.color){ twin=next[i]; break; } }
    if(twin) twin.qty=Math.min(9,twin.qty+line.qty); else next.push(line);
  });
  cart=next;
  promoActive=!!saved.promo;
  promoCodeApplied=saved.promo?String(saved.promo).toUpperCase():'';
  var promoField=$('#promoInput'); if(promoField) promoField.value=promoCodeApplied;
  var removeBtn=$('#promoRemove'); if(removeBtn) removeBtn.classList.toggle('hidden',!promoActive);
  return true;
}
function syncCartFromStore(){
  cartEventSyncing=true;
  try{ restoreCart(); renderCart(); }catch(e){}
  cartEventSyncing=false;
}
window.addEventListener('kinetic:cart-changed',function(){ if(cartEventSuppressed||cartEventSyncing) return; syncCartFromStore(); });
function makeCheckoutAttemptKey(){
  if(window.crypto&&typeof window.crypto.randomUUID==='function') return window.crypto.randomUUID();
  return 'knt-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
}
function moneyCents(cents){ return '$'+(Math.max(0,Number(cents)||0)/100).toFixed(2); }
function calculateCartTotals(items,appliedCode){
  var itemCount=0, subtotalCents=0;
  (Array.isArray(items)?items:[]).forEach(function(item){
    var product=getProductById(item&&item.id), qty=Math.max(0,Math.min(99,parseInt(item&&item.qty,10)||0));
    if(!product||!isValidProduct(product)||!qty) return;
    var priceCents=Math.round(Number(product.price)*100); if(!Number.isFinite(priceCents)||priceCents<0) return;
    itemCount+=qty; subtotalCents+=priceCents*qty;
  });
  var isPromo=String(appliedCode||'').trim().toUpperCase()===KINETIC_CONFIG.commerce.promoCode;
  var discountCents=itemCount&&isPromo?Math.round(subtotalCents*KINETIC_CONFIG.commerce.promoPercent/100):0;
  var thresholdCents=KINETIC_CONFIG.commerce.freeShippingThresholdCents;
  var shippingCents=itemCount===0?0:(subtotalCents>=thresholdCents?0:KINETIC_CONFIG.commerce.shippingCents);
  var remainingCents=Math.max(0,thresholdCents-subtotalCents);
  return {
    itemCount:itemCount,
    subtotalCents:subtotalCents,
    discountCents:discountCents,
    shippingCents:shippingCents,
    totalCents:Math.max(0,subtotalCents-discountCents+shippingCents),
    freeShippingRemainingCents:remainingCents,
    shippingProgressPercent:thresholdCents?Math.min(100,Math.floor(subtotalCents/thresholdCents*100)):100,
    freeShippingUnlocked:itemCount>0&&subtotalCents>=thresholdCents
  };
}
function addToCart(id,size,color){
  var product=getProductById(id); if(!product||!isValidProduct(product)) return false;
  var chosenSize=String(size||selectedSize||'').trim();
  if(!chosenSize||PRODUCT_SIZES.indexOf(chosenSize)===-1){ var message=$('#sizeSelectMessage'); if(message){message.textContent='Choose a US size before adding this sneaker to your bag.';message.classList.remove('hidden');} toast('Choose a size','Select a US size before adding this sneaker to your bag.','bg-ink text-flame'); return false; }
  var requestedColor=color||(String(modalProduct)===String(product.id)?selectedColor:null)||(explicitlySelectedColorsByProduct[String(product.id)]?selectedColorsByProduct[String(product.id)]:null);
  var chosenColorway=getProductColorway(product,requestedColor);
  if(!chosenColorway){ var colorMessage=$('#colorSelectMessage'); if(colorMessage){colorMessage.textContent='Choose a colourway before adding this sneaker to your bag.';colorMessage.classList.remove('hidden');} toast('Choose a colour','Select a colourway before adding this sneaker to your bag.','bg-ink text-flame'); return false; }
  setProductColorway(product.id,chosenColorway.hex);
  var existing=cart.find(function(item){ return String(item.id)===String(product.id)&&String(item.size)===chosenSize&&String(item.color)===chosenColorway.hex; });
  if(existing) existing.qty=Math.min(9,existing.qty+1); else cart.push({id:product.id,size:chosenSize,color:chosenColorway.hex,colorName:chosenColorway.name,qty:1});
  renderCart(); toast('Added to bag',product.name+' · US '+chosenSize+' · '+chosenColorway.name,'bg-flame text-ink'); return true;
}
/* ---- stock: one source of truth for the product page, the bag and checkout.
   A product may carry its own table  stock:{ "8": 3, "9": 0 }  (0 = sold out,
   "*" = default for unlisted sizes). Without a table the availability is derived
   from the product id + size, so it never changes between visits. */
function stockSeed(value){
  var hash=2166136261, text=String(value);
  for(var i=0;i<text.length;i++){ hash^=text.charCodeAt(i); hash=(hash*16777619)>>>0; }
  return hash;
}
function stockForSize(product,size){
  if(!product||!isValidProduct(product)) return 0;
  var key=String(size==null?'':size).trim();
  if(!key) return 0;
  var table=(product.stock&&typeof product.stock==='object')?product.stock:null;
  var fallbackCap=null;
  if(typeof product.stock==='number'&&isFinite(product.stock)&&product.stock>=0) fallbackCap=Math.floor(product.stock);
  if(table){
    var raw=null;
    if(Object.prototype.hasOwnProperty.call(table,key)) raw=table[key];
    else if(Object.prototype.hasOwnProperty.call(table,'*')) raw=table['*'];
    if(raw!==null&&raw!==undefined){ var n=parseInt(raw,10); return isFinite(n)&&n>0?n:0; }
  }
  if(fallbackCap===0) return 0;
  var limited=String(product.tag||'').toLowerCase()==='limited'||!!product.editionSize;
  var roll=stockSeed(String(product.id)+'|'+key)%100;
  if(fallbackCap!==null) return Math.min(fallbackCap,9);
  if(limited){ if(roll<32) return 0; if(roll<62) return 1+(roll%2); if(roll<88) return 3+(roll%3); return 6+(roll%3); }
  if(roll<14) return 0;
  if(roll<44) return 1+(roll%2);
  if(roll<78) return 3+(roll%4);
  return 7+(roll%3);
}
function availableSizes(product){
  var wanted=(Array.isArray(product&&product.sizes)&&product.sizes.length)?product.sizes:PRODUCT_SIZES;
  return wanted.map(function(size){ return {size:String(size),stock:stockForSize(product,size),eu:SIZE_EU[String(size)]||''}; });
}
function productStockSummary(product){
  var rows=availableSizes(product), inStock=rows.filter(function(r){ return r.stock>0; });
  var lowest=inStock.length?inStock.reduce(function(min,row){ return Math.min(min,row.stock); },Infinity):0;
  return {rows:rows,available:inStock.length,total:rows.length,soldOut:rows.length-inStock.length,lowest:lowest===Infinity?0:lowest};
}
/* add an exact selection (product page, quick add, anything) */
function addItem(selection){
  selection=selection||{};
  var product=getProductById(selection.id);
  if(!product||!isValidProduct(product)) return {ok:false,reason:'missing',message:'That product is no longer in the collection.'};
  var size=String(selection.size===null||selection.size===undefined?'':selection.size).trim();
  if(PRODUCT_SIZES.indexOf(size)===-1) return {ok:false,reason:'size',message:'Choose a US size first.'};
  var colorway=getProductColorway(product,selection.color)||getProductColorway(product,selectedColorsByProduct[String(product.id)])||getProductColorways(product)[0];
  if(!colorway) return {ok:false,reason:'color',message:'Choose a colourway first.'};
  var stock=stockForSize(product,size);
  if(stock<=0) return {ok:false,reason:'stock',message:'Size US '+size+' is sold out for this colourway.'};
  var wanted=Math.max(1,Math.min(9,parseInt(selection.qty,10)||1));
  var index=-1;
  cart.forEach(function(item,i){ if(index<0&&String(item.id)===String(product.id)&&String(item.size)===size&&String(item.color).toUpperCase()===colorway.hex.toUpperCase()) index=i; });
  var inBag=index>=0?cart[index].qty:0, room=Math.max(0,Math.min(9,stock)-inBag);
  if(room<=0) return {ok:false,reason:'stock',message:'Your bag already holds the last US '+size+' pair we can sell.'};
  var added=Math.min(wanted,room);
  if(index>=0) cart[index].qty+=added;
  else cart.push({id:product.id,size:size,color:colorway.hex,colorName:colorway.name,qty:added});
  setProductColorway(product.id,colorway.hex);
  renderCart();
  return {
    ok:true, added:added, clamped:added<wanted, inBag:inBag+added, size:size,
    color:colorway.hex, colorName:colorway.name, stock:stock,
    message:added+' × '+product.name+' (US '+size+' · '+colorway.name+') added to your bag.'
  };
}
function removeItem(index){ if(index<0||index>=cart.length) return; cart.splice(index,1); renderCart(); toast('Removed','Item removed from your bag.','bg-white text-ink'); }
function changeQty(index,delta){
  var item=cart[index]; if(!item) return; item.qty+=delta;
  if(item.qty<=0) cart.splice(index,1); else item.qty=Math.min(9,item.qty);
  renderCart();
}
function setPromoMessage(text,kind){
  var msg=$('#promoMsg'); if(!msg) return; msg.textContent=text; msg.classList.remove('hidden');
  msg.style.color=kind==='error'?'#B8860B':(kind==='success'?'#08080A':'#555');
}
function renderCart(){
  cart=cart.filter(function(item){ var product=getProductById(item&&item.id); return !!product&&isValidProduct(product); });
  var summary=calculateCartTotals(cart,promoActive?promoCodeApplied:'');
  var box=$('#cartItems'), countBadge=$('#cartCount'), drawerCount=$('#cartDrawerCount');
  if(countBadge) countBadge.textContent=summary.itemCount;
  if(drawerCount) drawerCount.textContent='('+summary.itemCount+')';
  if(box){
    if(!cart.length){
      box.innerHTML='<div class="text-center py-14"><div class="display text-[3.4rem] text-ink/12 leading-none">Empty</div><p class="font-mono2 text-[11px] tracking-[.22em] uppercase text-ink/50 mt-4 leading-relaxed">Your bag is light.<br/>Fix that.</p><button type="button" class="empty-shop btn btn-dark mt-7 !py-3.5">Shop the collection <span class="arw">→</span></button></div>';
      var emptyShop=$('.empty-shop',box); if(emptyShop) emptyShop.addEventListener('click',function(){ closeCart(); var collection=$('#collection'); if(collection) collection.scrollIntoView({behavior:reduced?'auto':'smooth'}); });
    }else{
      var rows=[];
      cart.forEach(function(item,index){
        try{
          var product=getProductById(item.id); if(!isValidProduct(product)) return;
          var colorway=getProductColorway(product,item.color)||getSelectedColorway(product), color=colorway?colorway.hex:'#D4AF37', colorName=colorway?colorway.name:(item.colorName||'Colourway');
          rows.push('<div class="flex gap-3.5 bg-white border border-ink/12 p-3.5"><span class="img-wrap w-[76px] h-[76px] shrink-0 block"><img src="'+escapeHtml(product.img)+'" class="w-full h-full object-cover" alt="Illustrative product photo for '+escapeHtml(product.name)+'" loading="lazy" decoding="async" width="1100" height="733"/></span><div class="flex-1 min-w-0"><div class="flex justify-between gap-2 items-start"><div class="font-black text-[13px] leading-tight">'+escapeHtml(product.name)+'</div><button type="button" class="cart-remove text-ink/35 hover:text-ember font-black transition-colors" data-index="'+index+'" aria-label="Remove '+escapeHtml(product.name)+' from bag">✕</button></div><div class="font-mono2 text-[10px] tracking-[.13em] uppercase text-ink/50 mt-1.5">'+escapeHtml(product.cat)+' · US '+escapeHtml(item.size||'Not selected')+'</div><div class="flex items-center gap-2 mt-1 text-[10px] text-ink/65"><span aria-hidden="true" class="inline-block w-3.5 h-3.5 border border-ink/25 rounded-full" style="background:'+color+'"></span><span>Colour: '+escapeHtml(colorName)+'</span></div><div class="flex justify-between items-center mt-2.5"><div class="flex items-center border border-ink/20"><button type="button" class="cart-minus w-7 h-7 font-black hover:bg-ink hover:text-flame transition-colors" data-index="'+index+'" aria-label="Decrease quantity of '+escapeHtml(product.name)+'">−</button><span class="w-7 text-center font-black text-[12px] tabular" aria-label="Quantity">'+item.qty+'</span><button type="button" class="cart-plus w-7 h-7 font-black hover:bg-ink hover:text-flame transition-colors" data-index="'+index+'" aria-label="Increase quantity of '+escapeHtml(product.name)+'">+</button></div><div class="display text-[1.25rem]">'+moneyCents(Math.round(Number(product.price)*100)*item.qty)+'</div></div></div></div>');
        }catch(e){ /* Skip only this malformed cart row. */ }
      });
      box.innerHTML=rows.length?rows.join(''):'<div class="text-center py-14 font-mono2 text-[11px] tracking-[.16em] text-ink/55">Your bag is empty.</div>';
      applyKineticImageDimensions(box);
      $$('.cart-remove',box).forEach(function(button){ button.addEventListener('click',function(){ removeItem(parseInt(button.dataset.index,10)); }); });
      $$('.cart-minus',box).forEach(function(button){ button.addEventListener('click',function(){ changeQty(parseInt(button.dataset.index,10),-1); }); });
      $$('.cart-plus',box).forEach(function(button){ button.addEventListener('click',function(){ changeQty(parseInt(button.dataset.index,10),1); }); });
      bindImgFallback(box);
    }
  }
  var setText=function(selector,value){ var element=$(selector); if(element) element.textContent=value; };
  setText('#cartSubtotal',moneyCents(summary.subtotalCents));
  setText('#cartDiscount','-'+moneyCents(summary.discountCents));
  setText('#cartShipping',summary.itemCount===0?moneyCents(0):(summary.shippingCents===0?'FREE':moneyCents(summary.shippingCents)));
  setText('#cartTotal',moneyCents(summary.totalCents));
  var bar=$('#shipBar'); if(bar){ bar.style.width=summary.shippingProgressPercent+'%'; bar.style.background=summary.freeShippingUnlocked?'#08080A':'#B8860B'; }
  setText('#shipPct',summary.shippingProgressPercent+'%');
  setText('#shipMsg',summary.freeShippingUnlocked?'Free express shipping unlocked':'Add '+moneyCents(summary.freeShippingRemainingCents)+' for free shipping');
  var removePromo=$('#promoRemove'); if(removePromo) removePromo.classList.toggle('hidden',!promoActive);
  var checkoutButton=$('#checkoutBtn');
  if(checkoutButton){ var emptyBag=summary.itemCount===0; checkoutButton.disabled=emptyBag; checkoutButton.setAttribute('aria-disabled',emptyBag?'true':'false'); }
  persistCart();
}
function openCart(){
  if($('#searchOverlay.show')) closeSearch(false); if($('#productOverlay.show')) closeProduct(false); if($('#mobileMenu.open')) closeMenu(false);
  var drawer=$('#cartDrawer'), overlay=$('#cartOverlay'); if(!drawer) return;
  if(!drawer.classList.contains('open')) cartReturnFocus=document.activeElement;
  drawer.classList.add('open'); if(overlay) overlay.classList.add('show'); if(cartBtn) cartBtn.setAttribute('aria-expanded','true'); setLayerState(drawer,true); setLayerState(overlay,true); updateBodyScrollLock();
  window.setTimeout(function(){ if($('#cartClose')) $('#cartClose').focus(); },0);
}
function closeCart(restoreFocus){
  var drawer=$('#cartDrawer'), overlay=$('#cartOverlay'); if(drawer) drawer.classList.remove('open'); if(overlay) overlay.classList.remove('show'); if(cartBtn) cartBtn.setAttribute('aria-expanded','false'); setLayerState(drawer,false); setLayerState(overlay,false); updateBodyScrollLock();
  if(restoreFocus!==false&&cartReturnFocus&&document.contains(cartReturnFocus)) cartReturnFocus.focus(); cartReturnFocus=null;
}
var cartBtn=$('#cartBtn'); if(cartBtn) cartBtn.addEventListener('click',openCart);
var cartClose=$('#cartClose'); if(cartClose) cartClose.addEventListener('click',function(){ closeCart(); });
var cartOverlay=$('#cartOverlay'); if(cartOverlay) cartOverlay.addEventListener('click',function(){ closeCart(); });
var continueBtn=$('#continueBtn'); if(continueBtn) continueBtn.addEventListener('click',function(){ closeCart(); });
var promoInput=$('#promoInput'), promoApply=$('#promoApply'), promoRemove=$('#promoRemove');
function applyPromo(){
  var value=promoInput?promoInput.value.trim().toUpperCase():'';
  if(value===KINETIC_CONFIG.commerce.promoCode){ promoActive=true; promoCodeApplied=KINETIC_CONFIG.commerce.promoCode; if(promoInput) promoInput.value=promoCodeApplied; setPromoMessage('✓ 20% off merchandise applied.','success'); toast('Promo applied','20% off your merchandise subtotal.','bg-flame text-ink'); }
  else{ promoActive=false; promoCodeApplied=''; setPromoMessage(value?'✕ Invalid code — check the offer and try again.':'Enter a promo code or remove the applied code.','error'); }
  renderCart();
}
if(promoApply) promoApply.addEventListener('click',applyPromo);
if(promoInput){
  promoInput.addEventListener('keydown',function(event){ if(event.key==='Enter'){event.preventDefault();applyPromo();} });
  promoInput.addEventListener('input',function(){
    var current=promoInput.value.trim().toUpperCase();
    if(promoActive&&current!==promoCodeApplied){ promoActive=false; promoCodeApplied=''; setPromoMessage('Code changed — apply it again to update your discount.',''); renderCart(); }
  });
}
if(promoRemove) promoRemove.addEventListener('click',function(){ promoActive=false; promoCodeApplied=''; if(promoInput) promoInput.value=''; setPromoMessage('Promo code removed.',''); renderCart(); });
function setCheckoutStatus(message,isError){
  var status=$('#checkoutStatus'); if(!status) return; status.textContent=message; status.classList.remove('hidden'); status.style.color=isError?'#9B2C2C':'#333';
}
function startCheckout(){
  if(!cart.length){ setCheckoutStatus('Your bag is empty. Add a sneaker before checkout.',true); return; }
  if(cart.some(function(item){return !item.size||!getProductColorway(getProductById(item.id),item.color);})){ setCheckoutStatus('Every sneaker needs a selected size and colour. Remove incomplete lines and add them again.',true); return; }
  /* Primary path: the full KINETIC checkout page (assets/kinetic-checkout.js). */
  if(window.KINETIC_CHECKOUT&&typeof window.KINETIC_CHECKOUT.open==='function'){
    var carrierName=$('#checkoutName'), carrierEmail=$('#checkoutEmail');
    if(typeof window.KINETIC_CHECKOUT.prefill==='function'){
      window.KINETIC_CHECKOUT.prefill({name:carrierName?carrierName.value.trim():'', email:carrierEmail?carrierEmail.value.trim():''});
    }
    setCheckoutStatus('',false);
    var status=$('#checkoutStatus'); if(status) status.classList.add('hidden');
    persistCart();
    closeCart(false);
    if(window.KINETIC_CHECKOUT.open(1)!==false) return;
  }
  /* Fallback: the hosted Tap endpoint, when a store owner connects one. */
  var nameInput=$('#checkoutName'), emailInput=$('#checkoutEmail');
  if(!nameInput||!nameInput.value.trim()||!nameInput.checkValidity()){ if(nameInput){nameInput.reportValidity();nameInput.focus();} setCheckoutStatus('Enter your name to continue to checkout.',true); return; }
  if(!emailInput||!emailInput.value.trim()||!emailInput.checkValidity()){ if(emailInput){emailInput.reportValidity();emailInput.focus();} setCheckoutStatus('Enter a valid email address to continue to checkout.',true); return; }
  var endpoint=String(KINETIC_CONFIG.checkout.endpoint||'').trim();
  if(!endpoint){ setCheckoutStatus('Secure checkout is not configured. No payment was taken; your bag is unchanged.',true); return; }
  var button=$('#checkoutBtn'); if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  setCheckoutStatus('Connecting to secure checkout…',false);
  var payload={items:cart.map(function(item){return {productId:item.id,quantity:item.qty,size:item.size,colorHex:item.color};}),promoCode:promoActive?promoCodeApplied:'',customer:{name:nameInput.value.trim(),email:emailInput.value.trim()}};
  var attemptFingerprint=JSON.stringify(payload);
  if(attemptFingerprint!==checkoutAttemptFingerprint){ checkoutAttemptFingerprint=attemptFingerprint; checkoutAttemptKey=makeCheckoutAttemptKey(); }
  payload.idempotencyKey=checkoutAttemptKey;
  fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)})
    .then(function(response){ return response.json().catch(function(){return {};}).then(function(data){ if(!response.ok) throw new Error(data.error||'Checkout service returned '+response.status); return data; }); })
    .then(function(data){
      var destination=data&&(data.url||data.checkoutUrl||(data.transaction&&data.transaction.url)); if(!destination) throw new Error('Checkout did not return a payment URL.');
      var url=new URL(destination,window.location.href);
      if(url.protocol!=='https:') throw new Error('Checkout URL must use HTTPS.');
      window.location.assign(url.href);
    })
    .catch(function(error){ var detail=error&&error.message==='Failed to fetch'?'Secure checkout could not be reached.':'Secure checkout could not be confirmed.'; setCheckoutStatus(detail+' Your bag is unchanged.',true); })
    .finally(function(){ if(button){button.disabled=false;button.removeAttribute('aria-busy');} });
}
var checkoutBtn=$('#checkoutBtn'); if(checkoutBtn) checkoutBtn.addEventListener('click',startCheckout);
restoreCart();
renderCart();

/* CONFETTI */
function confetti(){
  if(reduced) return;
  var canvas=document.createElement('canvas'); canvas.style.cssText='position:fixed;inset:0;z-index:9998;pointer-events:none;'; document.body.appendChild(canvas);
  var ctx=canvas.getContext('2d'); if(!ctx){ canvas.remove(); return; }
  canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  var colors=['#D4AF37','#F2D273','#F5F0EA','#08080A'];
  var parts=[]; for(var i=0;i<130;i++){ parts.push({x:canvas.width/2+(Math.random()-0.5)*200, y:canvas.height*0.62, vx:(Math.random()-0.5)*17, vy:Math.random()*-15-5, s:Math.random()*9+4, c:colors[Math.floor(Math.random()*colors.length)], r:Math.random()*Math.PI, vr:(Math.random()-0.5)*0.32}); }
  var frames=0; (function anim(){ ctx.clearRect(0,0,canvas.width,canvas.height); frames++; parts.forEach(function(p){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.42; p.r+=p.vr; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.r); ctx.fillStyle=p.c; ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*0.6); ctx.restore(); }); if(frames<150) requestAnimationFrame(anim); else if(canvas.parentNode) canvas.remove(); })();
}

/* NETLIFY NEWSLETTER FORM */
var newsForm=$('#newsForm');
if(newsForm) newsForm.addEventListener('submit',function(event){
  event.preventDefault();
  var input=$('#newsInput'), submit=newsForm.querySelector('button[type="submit"]'), status=$('#newsStatus'), success=$('#newsSuccess'), honey=newsForm.querySelector('[name="bot-field"]');
  if(!input||!input.value.trim()||!input.checkValidity()){
    if(input){input.reportValidity();input.focus();}
    if(status){status.textContent='Enter a valid email address to join the club.';status.style.color='#9B2C2C';status.classList.remove('hidden');}
    return;
  }
  if(newsForm.dataset.submitting==='true') return;
  newsForm.dataset.submitting='true'; if(submit){submit.disabled=true;submit.setAttribute('aria-busy','true');submit.dataset.originalText=submit.textContent;submit.textContent='Joining…';}
  if(status){status.textContent='Submitting your email…';status.style.color='';status.classList.remove('hidden');}
  var body=new URLSearchParams(); body.set('form-name','newsletter'); body.set('email',input.value.trim()); body.set('bot-field',honey?honey.value:'');
  /* the club list is kept in this browser; a hosted form handler (Netlify) is used when present */
  function saveSubscriber(){
    try{
      var key='kinetic-club-v1', list=JSON.parse(localStorage.getItem(key)||'[]');
      if(!Array.isArray(list)) list=[];
      var email=input.value.trim(), known=false;
      list.forEach(function(entry){ if(String(entry&&entry.email||'').toLowerCase()===email.toLowerCase()) known=true; });
      if(!known) list.push({email:email,at:new Date().toISOString()});
      localStorage.setItem(key,JSON.stringify(list.slice(-500)));
    }catch(e){}
  }
  function succeed(){
    if(status) status.classList.add('hidden');
    newsForm.classList.add('hidden');
    if(success) success.classList.remove('hidden');
    toast('Welcome to the club','Use code KINETIC20 at checkout.','bg-ink text-flame');
    confetti();
  }
  function finish(){
    newsForm.dataset.submitting='false';
    if(submit){submit.disabled=false;submit.removeAttribute('aria-busy');submit.textContent=submit.dataset.originalText||'Sign me up →';}
  }
  var hosted=/(^|\.)netlify\.app$/i.test(location.hostname);
  saveSubscriber();
  if(hosted){
    fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()})
      .then(function(response){ if(!response.ok) throw new Error('Newsletter submission failed with '+response.status); return response; })
      .then(succeed)
      .catch(succeed)          /* saved locally above — never show the visitor an error */
      .finally(finish);
  }else{
    succeed();                 /* GitHub Pages: no form handler, so keep it in this browser */
    finish();
  }
});

/* KEYBOARD */
document.addEventListener('keydown',function(event){ if(event.key==='Escape'){ closeTopOpenLayer(); return; } if(event.key==='Tab') trapTabFocus(event); });

/* GSAP PARALLAX + HERO CANVAS PARTICLES */
try{
  if(window.gsap && window.ScrollTrigger && !reduced){
    gsap.registerPlugin(ScrollTrigger);
    gsap.utils.toArray('.wordmark').forEach(function(el){
      gsap.fromTo(el,{xPercent:-6},{xPercent:6,ease:'none',scrollTrigger:{trigger:el,start:'top bottom',end:'bottom top',scrub:0.6}});
    });
    gsap.utils.toArray('#lookbook .look-card').forEach(function(el){
      gsap.fromTo(el,{y:40,opacity:0.55},{y:0,opacity:1,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 92%',end:'top 55%',scrub:0.7}});
    });
  }
}catch(e){}

(function(){
  var c=$('#heroCanvas'); if(!c||reduced) return; var ctx=c.getContext('2d'); if(!ctx) return;
  function dpr(){ return Math.min(window.devicePixelRatio||1, 2); }
  function resize(){ var r=dpr(); c.width=c.offsetWidth*r; c.height=c.offsetHeight*r; ctx.setTransform(r,0,0,r,0,0); }
  resize(); window.addEventListener('resize', resize);
  var dots=[];
  for(var i=0;i<36;i++){ dots.push({x:Math.random(), y:Math.random(), r:Math.random()*1.4+0.6, v:Math.random()*0.0007+0.0002}); }
  function draw(){
    var w=c.offsetWidth, h=c.offsetHeight;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='rgba(212,175,55,0.9)';
    dots.forEach(function(d){
      d.y-=d.v; if(d.y<0) d.y=1;
      var x=d.x*w, y=d.y*h;
      ctx.beginPath(); ctx.arc(x,y,d.r,0,Math.PI*2); ctx.fill();
      // faint line to center
      ctx.strokeStyle='rgba(212,175,55,0.06)';
      ctx.beginPath(); ctx.moveTo(w*0.5,h*0.5); ctx.lineTo(x,y); ctx.stroke();
    });
    raf = requestAnimationFrame(draw);
  }
  /* animate only while the hero is on screen and the tab is visible */
  var running = false, raf = 0, onScreen = true;
  function start(){ if (running || !onScreen || document.hidden) return; running = true; raf = requestAnimationFrame(draw); }
  function stop(){ running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', function(){ if (document.hidden) stop(); else start(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function(entries){ onScreen = entries[0].isIntersecting; if (onScreen) start(); else stop(); }, { threshold: 0 }).observe(c);
  } else { start(); }
  start();
})();

/* ---------------------------------------------------------------- public API
   Used by kinetic-checkout.js (checkout page, order records) and by the store
   manager. Everything the checkout page needs, in one place. */
window.KINETIC_APP={
  version:'1.0',
  products:function(){ return PRODUCTS.slice(); },
  getProductById:getProductById,
  isValidProduct:isValidProduct,
  getProductColorway:getProductColorway,
  moneyCents:moneyCents,
  commerce:function(){ return KINETIC_CONFIG.commerce; },
  cart:function(){ return cart.slice(); },
  sizes:function(){ return PRODUCT_SIZES.slice(); },
  sizeEu:function(size){ return SIZE_EU[String(size)]||''; },
  stockFor:function(id,size){ return stockForSize(getProductById(id),size); },
  stockSummary:function(id){ return productStockSummary(getProductById(id)); },
  addItem:addItem,
  colorways:function(id){ var p=getProductById(id); return p?getProductColorways(p):[]; },
  selectedColorway:function(id){ var p=getProductById(id); return p?getSelectedColorway(p):null; },
  uploads:function(id){ return loadProductUploads(id); },
  reviews:function(){ return REVIEWS.slice(); },
  wishlist:{
    all:function(){ return wishlistIds.slice(); },
    has:isWishlisted,
    toggle:toggleWishlist,
    /* replace the whole list (used when an account's saved items arrive) */
    set:function(ids){
      var next=[];
      (Array.isArray(ids)?ids:[]).forEach(function(id){
        if(!getProductById(id)) return;
        if(next.some(function(x){ return String(x)===String(id); })) return;
        next.push(isFinite(Number(id))?Number(id):id);
      });
      wishlistIds=next;
      saveWishlist();
      try{ window.dispatchEvent(new CustomEvent('kinetic:wishlist-changed',{detail:{bulk:true,ids:wishlistIds.slice()}})); }catch(e){}
      return wishlistIds.slice();
    }
  },
  openQuickView:openProduct,
  reloadContent:function(){ return __kineticApplyContent(); },
  /* ---- live catalogue seam (used by kinetic-api-bridge.js) ---- */
  applyDbProducts:function(list){
    window.__KINETIC_DB_PRODUCTS__=Array.isArray(list)?list:null;
    var out=__kineticApplyContent();
    /* Tell the open product view that the catalogue data changed. Without this
       the product page keeps whatever stock it painted first (the built-in
       defaults, or a cached copy) while `stockFor()` already answers from the
       store database — so it can offer a size that is actually sold out. */
    try{ window.dispatchEvent(new CustomEvent('kinetic:catalogue-updated',{detail:{count:Array.isArray(list)?list.length:0}})); }catch(e){}
    return out;
  },
  applyDbConfig:function(cfg){ return __kineticApplyDbConfig(cfg); },
  dbProducts:function(){ return Array.isArray(window.__KINETIC_DB_PRODUCTS__)?window.__KINETIC_DB_PRODUCTS__.slice():[]; },
  productByUuid:function(uuid){
    var list=Array.isArray(window.__KINETIC_DB_PRODUCTS__)?window.__KINETIC_DB_PRODUCTS__:[];
    for(var i=0;i<list.length;i++){ if(String(list[i].uuid)===String(uuid)) return list[i]; }
    return null;
  },
  productBySlug:function(slug){
    var list=Array.isArray(window.__KINETIC_DB_PRODUCTS__)?window.__KINETIC_DB_PRODUCTS__:[];
    for(var i=0;i<list.length;i++){ if(String(list[i].slug)===String(slug)) return list[i]; }
    return null;
  },
  categories:function(){ return categoryNames(); },
  closeQuickView:function(){ closeProduct(false); },
  syncCart:function(){ persistCart(); },
  reloadCart:function(){ restoreCart(); renderCart(); },
  renderProducts:function(){ renderProducts(); },
  renderFilters:function(){ renderFilters(); },
  openCart:openCart,
  closeCart:closeCart,
  toast:toast,
  confetti:function(){ confetti(); },
  config:KINETIC_CONFIG
};

})();
