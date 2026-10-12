// Offline cache for the app shell. Bump VERSION whenever any file changes so devices pick up the update.
const VERSION='gp-practice-v36';
const FILES=['./','index.html','alphaTab.min.js','soundfont.js','chords.js','font/Bravura.woff2','font/Bravura.woff','font/Bravura.otf','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{ if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request))) });
