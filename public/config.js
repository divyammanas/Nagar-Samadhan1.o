(function () {
    const RENDER_BACKEND = 'https://nagar-samadhan1-o.onrender.com';
    const hostname = window.location.hostname;

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.onrender.com')) {
        window.API_BASE_URL = window.location.origin;
    } else {
        window.API_BASE_URL = RENDER_BACKEND;
    }
})();
