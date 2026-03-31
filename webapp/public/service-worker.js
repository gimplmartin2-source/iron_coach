// Service Worker für Offline-GIF-Caching
const CACHE_NAME = 'ironcoach-gifs-v1';
const EXERCISE_GIFS = [
    '/exercises/bankdruecken_langhantel_flachbank.gif',
    '/exercises/bankdruecken_ausfuehrung_mit_kurzhanteln.gif',
    '/exercises/bankdruecken_schraeg_mit_langhantel-1.gif',
    '/exercises/butterfly_uebung_mit_kurzhanteln-2.gif',
    '/exercises/dips_ausfuehrung-trizeps_dips_geraet-1.gif',
    '/exercises/rumenian_deadlift-1.gif',
    '/exercises/klimmzugstange_uebungen-enge_klimmzuege_untergriff-1.gif',
    '/exercises/rudern_langhantel.gif',
    '/exercises/rudern_am_kabelzug-einarmig-1.gif',
    '/exercises/rudern_mit_kurzhantel-einarmig-1.gif',
    '/exercises/latzuggeraet_uebungen-latzuggeraet_kabelzug_obergriff.gif',
    '/exercises/t_bar_rudern-beidarmig.gif',
    '/exercises/rueckenstrecker_uebungen_gym-rueckenstrecker_geraet_zusatzgewicht.gif',
    '/exercises/kniebeugen_ausfuehrung-1.gif',
    '/exercises/beinpresse_muskeln-45_grad_beinpresse_breit.gif',
    '/exercises/beinstrecker_maschine-1.gif',
    '/exercises/beinbeuger_maschine.gif',
    '/exercises/glute-bridge.gif',
    '/exercises/calf_raises-1.gif',
    '/exercises/ausfallschritte_kurzhantel_nach_vorne.gif',
    '/exercises/schulterdruecken_mit_kurzhanteln-stehend-1.gif',
    '/exercises/kurzhantel_seitheben-sitzend-1.gif',
    '/exercises/frontheben_kurzhantel_stehend_einarmig.gif',
    '/exercises/face-pulls-kabelzug.gif',
    '/exercises/bizeps_curls_kurzhanteln_abwechselnd.gif',
    '/exercises/hammercurl_kurzhanteln_abwechselnd.gif',
    '/exercises/trizeps_uebungen_fitnessstudio-trizepsdruecken_am_kabelzug-1.gif',
    '/exercises/trizepstraining_zuhause-kurzhandell_trizepsdruecken_beidarmig.gif',
    '/exercises/plank.gif',
    '/exercises/bauchmuskeluebungen_zu_hause-crunches.gif',
    '/exercises/liegendes_beinheben-1.gif',
    '/exercises/russian_twist.gif',
    '/exercises/adim-core.gif',
    '/exercises/dead-bug.gif',
    '/exercises/bird-dog.gif',
    '/exercises/torso-rotation.gif',
    '/exercises/butterfly-stretch.gif',
    '/exercises/cat-cow.gif',
    '/exercises/hip-stretch.gif',
    '/exercises/child-pose.gif'
];

// Install: Cache alle GIFs
self.addEventListener('install', event => {
    console.log('🔧 Service Worker: Installiere...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✅ Service Worker: GIFs werden gecacht...');
                return cache.addAll(EXERCISE_GIFS);
            })
            .catch(err => console.log('⚠️ Service Worker: Cache Fehler:', err))
    );
    self.skipWaiting();
});

// Activate: Alte Caches löschen
self.addEventListener('activate', event => {
    console.log('🚀 Service Worker: Aktiviert');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: Aus Cache oder Network
self.addEventListener('fetch', event => {
    // Nur GIF-Requests abfangen
    if (event.request.url.includes('/exercises/') && event.request.url.endsWith('.gif')) {
        event.respondWith(
            caches.match(event.request).then(response => {
                // Cache first, dann Network als Fallback
                if (response) {
                    console.log('📦 Service Worker: GIF aus Cache geliefert');
                    return response;
                }
                
                return fetch(event.request).then(networkResponse => {
                    // Im Cache speichern für später
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                    return networkResponse;
                });
            })
        );
    }
});
