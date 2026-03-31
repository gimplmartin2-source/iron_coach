
// GIF Click Handler fuer manuelles Neuladen
document.addEventListener('DOMContentLoaded', function() {
    // Click-Handler fuer alle GIFs
    document.querySelectorAll('img[src*=".gif"]').forEach(function(img) {
        img.addEventListener('click', function() {
            var src = img.src;
            img.src = '';
            setTimeout(function() {
                img.src = src.split('?')[0] + '?reload=' + Date.now();
            }, 10);
        });
        img.style.cursor = 'pointer';
        img.title = 'Tap to reload';
    });
    
    // Auto-check alle 5 Sekunden
    setInterval(function() {
        document.querySelectorAll('img[src*=".gif"]').forEach(function(img) {
            if (img.complete && img.naturalWidth === 0) {
                var baseSrc = img.src.split('?')[0];
                img.src = baseSrc + '?reload=' + Date.now();
            }
        });
    }, 5000);
});