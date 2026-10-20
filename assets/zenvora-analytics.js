/* Zenvora Digital privacy-conscious pageview counter. No IP addresses, names, or full referrer URLs are collected. */
(function(){
'use strict';
var cfg=window.ZENVORA_CONFIG;
if(!cfg||!cfg.supabaseUrl||!cfg.supabasePublishableKey)return;
var key='zenvora_analytics_visitor_v1',visitorId;
try{
 visitorId=localStorage.getItem(key);
 if(!visitorId){visitorId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2));localStorage.setItem(key,visitorId)}
}catch(e){visitorId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2))}
var pagePath=location.pathname.slice(0,300)||'/';
var refHost='';
try{if(document.referrer){var u=new URL(document.referrer);if(u.origin!==location.origin)refHost=u.hostname.slice(0,255)}}catch(e){}
var url=cfg.supabaseUrl.replace(/\/$/,'')+'/rest/v1/website_pageviews';
fetch(url,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabasePublishableKey,'Authorization':'Bearer '+cfg.supabasePublishableKey,'Prefer':'return=minimal'},body:JSON.stringify({visitor_id:visitorId,page_path:pagePath,referrer_host:refHost||null}),keepalive:true}).catch(function(){});
})();
