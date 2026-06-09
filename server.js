const http = require("http");
const https = require("https");
const url = require("url");
let getJson = null;
try {
    const serp = require("serpapi");
    if (serp && serp.getJson) getJson = serp.getJson;
} catch (e) {
    console.warn('serpapi not installed; SerpApi provider disabled');
}

// --- API KEYS / CONFIG ---
const SERP_API_KEY = process.env.SERP_API_KEY || "f48359b7370f31c965f4ac42605920376c3797ee39fe7131ec139b3af4fa56ea";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "fe7f18dd34msh28d6ac0d74956fbp12b4afjsnb31038159c43";

// -----------------------------
// FETCH JSON (SearXNG)
// -----------------------------
function fetchJSON(searchUrl, callback) {
    https.get(searchUrl, (res) => {
        let data = "";

        res.on("data", c => data += c);

        res.on("end", () => {
            try {
                callback(null, JSON.parse(data));
            } catch (e) {
                callback(e, null);
            }
        });

    }).on("error", err => callback(err, null));
}



// -----------------------------
// HELPER: normalize JSON results
// -----------------------------
function normalizeResultsFromJson(json) {
    if (!json) return [];
    const out = [];

    function push(r, typeHint) {
        if (!r) return;
        const title = r.title || r.name || r.heading || r.snippet || r.title_no_formatting || String(r).slice(0,60) || '';
        let link = r.link || r.url || r.link_url || r.source || r.href || r.displayUrl || r.sourceUrl || '';
        // image fields
        const thumbnail = r.thumbnail || r.thumbnail_url || r.thumbnailLink || (r.image && (r.image.src || r.image.url)) || r.image_url || r.thumbnailUrl || null;

        // detect type
        let type = 'web';
        const keys = Object.keys(r||{}).join(' ').toLowerCase();
        if (thumbnail || keys.includes('image') || keys.includes('thumbnail')) type = 'image';
        if (keys.includes('news') || keys.includes('article') || keys.includes('publisher') || r.published_time) type = 'news';
        if (typeHint) type = typeHint;

        out.push({ title: title || link || '(no title)', link: link || '', type, snippet: r.snippet || r.summary || '', thumbnail: thumbnail || null });
    }

    if (Array.isArray(json)) json.forEach(r => push(r));
    if (json.organic_results) json.organic_results.forEach(r => push(r, 'web'));
    if (json.results) json.results.forEach(r => push(r));
    if (json.items) json.items.forEach(r => push(r));
    if (json.inline_images) json.inline_images.forEach(r => push(r, 'image'));
    if (json.image_results) json.image_results.forEach(r => push(r, 'image'));
    if (json.images) json.images.forEach(r => push(r, 'image'));
    if (json.news_results) json.news_results.forEach(r => push(r, 'news'));

    return out;
}

// -----------------------------
// SERPAPI (PRIMARY - provided key)
// -----------------------------
function searchSerpApi(query, callback) {
    if (!getJson) return callback(new Error('SerpApi module not available'), null);
    let finished = false;
    const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        console.error('SerpApi timed out for query', query);
        return callback(new Error('SerpApi timeout'), null);
    }, 4000);
    try {
        getJson({
            engine: "google",
            q: query,
            google_domain: "google.com",
            hl: "en",
            gl: "us",
            api_key: SERP_API_KEY
        }, (json) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            console.log('SerpApi returned callback, type:', typeof json === 'object' ? 'object' : typeof json);
            try {
                const results = normalizeResultsFromJson(json);
                console.log('SerpApi normalized results count:', results.length);
                if (results.length) return callback(null, results);
                console.error('SerpApi returned zero results for', query);
                return callback(new Error("no results from serpapi"), null);
            } catch (e) {
                return callback(e, null);
            }
        });
    } catch (e) {
        if (!finished) {
            finished = true;
            clearTimeout(timer);
            return callback(e, null);
        }
    }
}

// -----------------------------
// SERPAPI IMAGE SEARCH (tbm=isch)
// -----------------------------
function searchSerpApiImages(query, callback) {
    if (!getJson) return callback(new Error('SerpApi module not available'), null);
    try {
        getJson({
            engine: 'google',
            q: query,
            tbm: 'isch',
            google_domain: 'google.com',
            hl: 'en',
            gl: 'us',
            api_key: SERP_API_KEY
        }, (json) => {
            try {
                const results = normalizeResultsFromJson(json);
                if (results && results.length) return callback(null, results);
                return callback(new Error('no images from serpapi'), null);
            } catch (e) {
                return callback(e, null);
            }
        });
    } catch (e) {
        return callback(e, null);
    }
}

// -----------------------------
// RAPIDAPI GENERIC CALL
// -----------------------------
function rapidApiGet(host, path, callback) {
    const options = {
        hostname: host,
        path: path,
        method: 'GET',
        headers: {
            'x-rapidapi-key': RAPIDAPI_KEY,
            'x-rapidapi-host': host,
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(options, (res) => {
        let data = '';
        // Log status for debugging
        if (res.statusCode && res.statusCode >= 400) {
            console.error('RapidAPI response status', res.statusCode, 'host', host, 'path', path);
        }
        res.on('data', c => data += c);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const results = normalizeResultsFromJson(json);
                if (!results.length) {
                    try { console.error('RapidAPI returned JSON keys:', Object.keys(json).slice(0,20)); } catch(e){}
                    console.error('RapidAPI raw length:', data.length);
                }
                return callback(null, results.length ? results : []);
            } catch (e) {
                console.error('RapidAPI parse error for host', host, 'path', path, 'error', e.message);
                console.error('RapidAPI raw body:', data.slice(0,200));
                // not JSON or parse error — surface error so caller can log and fallback
                return callback(new Error('rapidapi parse error'), null);
            }
        });
    });

    req.on('error', err => callback(err, null));
    req.end();
}

// -----------------------------
// RAPIDAPI #1 (google-search74)
// -----------------------------
function searchRapidAPI1(query, callback) {
    const host = 'google-search74.p.rapidapi.com';
    const path = '/?query=' + encodeURIComponent(query) + '&limit=10&related_keywords=true';
    rapidApiGet(host, path, callback);
}

// -----------------------------
// RAPIDAPI #2 (images)
// -----------------------------
function searchRapidAPI2(query, callback) {
    const host = 'google-search72.p.rapidapi.com';
    const path = '/imagesearch?q=' + encodeURIComponent(query) + '&gl=us&lr=lang_en&num=10&page=1';
    rapidApiGet(host, path, callback);
}

// -----------------------------
// RAPIDAPI #3 (patents)
// -----------------------------
function searchRapidAPI3(query, callback) {
    const host = 'google-search-master-mega.p.rapidapi.com';
    const path = '/patents?q=' + encodeURIComponent(query) + '&num=10&page=1';
    rapidApiGet(host, path, callback);
}

// -----------------------------
// WIKIPEDIA API
// -----------------------------
function searchWikipedia(query, callback) {
    const searchUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&format=json';
    https.get(searchUrl, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            try {
                const j = JSON.parse(data);
                const list = j.query && j.query.search ? j.query.search.map(s => ({ title: s.title, link: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')) })) : [];
                return callback(null, list);
            } catch (e) {
                return callback(e, null);
            }
        });
    }).on('error', err => callback(err, null));
}

// -----------------------------
// RENDER HTML
// -----------------------------
function render(query, results, source, currentType) {
    const ct = currentType || 'web';
    let out = `
    <html>
    <head>
        <meta charset="utf-8">
        <title>Red Star Search(12.11)</title>
        <style>
            body { font-family: Arial; background:#eee; padding:20px; }
            .box { background:#fff; padding:10px; margin:10px 0; }
            a { color:blue; }
        </style>
    </head>
    <body>

    <h1>🌟 Red Star Search (Ver 12.18)</h1>

    <form action="/search">
        <input name="q" value="${query}" style="width:300px;">
        <button>Search</button>
    </form>

    <p><small>Source: ${source}</small></p>

    <h2>Results for: ${query}</h2>
    `;

    // Group results by type for tabs
    const webResults = (results || []).filter(r => r.type === 'web');
    const imageResults = (results || []).filter(r => r.type === 'image');
    const newsResults = (results || []).filter(r => r.type === 'news');

    out += `
        <div style="margin-top:12px;">
            <h3>Web Results</h3>
            ${webResults.length ? webResults.slice(0,10).map(r => {
                const safeLink = (r.link && r.link !== 'undefined') ? r.link : '';
                const domain = safeLink ? (new URL(safeLink, 'https://example.com')).hostname : '';
                return `<div class="box"><div><small>Type: web</small></div><a ${safeLink ? `href="${safeLink}" target="_blank"` : ''}>${r.title}</a><br><small>${safeLink || domain}</small>${r.snippet?`<p>${r.snippet}</p>`:''}</div>`;
            }).join('') : '<p><b>No web results.</b></p>'}
        </div>
    </body></html>`;
    return out;
}

// -----------------------------
// Safe responder to avoid throwing during render
// -----------------------------
function safeRenderEnd(res, query, results, source, reqType) {
    try {
        const html = render(query, results, source, reqType);
        return res.end(html);
    } catch (e) {
        console.error('Render error:', e && e.stack ? e.stack : e);
        try {
            return res.end(`<html><body><h1>Error</h1><p>Rendering failed.</p></body></html>`);
        } catch (e2) {
            console.error('Failed to send error response', e2);
        }
    }
}

// -----------------------------
// SERVER
// -----------------------------
const server = http.createServer((req, res) => {

    const q = url.parse(req.url, true);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

    // HOME
    if (q.pathname === "/") {
        return res.end(`
            <h1>🌟 Red Star Search (12.18)</h1>
            <form action="/search">
                <input name="q">
                <button>Search</button>
            </form>
        `);
    }

    // SEARCH
    if (q.pathname === "/search") {

        const query = q.query.q || "";
        const reqType = (q.query && q.query.type) ? String(q.query.type).toLowerCase() : 'web';
        console.log('Received search request for:', query, 'type:', reqType);

        // -----------------------------
        // Provider chain (in order):
        // 1) SerpApi, 2) RapidAPI #1, 3) RapidAPI #2, 4) RapidAPI #3,
        // 5) Wikipedia, 6) Link fallback
        // -----------------------------

        // 1) SerpApi
        // If the request specifically asks for images, try RapidAPI image provider first
        if (reqType === 'images') {
            console.log('Request type=images — trying RapidAPI #2 first');
            return searchRapidAPI2(query, (errImg, imgResults) => {
                if (!errImg && imgResults && imgResults.length) {
                    return safeRenderEnd(res, query, imgResults, "RapidAPI #2 (Images)", reqType);
                }
                if (errImg) console.error('RapidAPI2 error:', errImg && errImg.message ? errImg.message : errImg);

                console.log('Falling back to SerpApi images after RapidAPI2');
                return searchSerpApiImages(query, (errImg2, imgResults2) => {
                    if (!errImg2 && imgResults2 && imgResults2.length) {
                        return safeRenderEnd(res, query, imgResults2, "SerpApi (images)", reqType);
                    }
                    if (errImg2) console.error('SerpApi images error:', errImg2 && errImg2.message ? errImg2.message : errImg2);

                    console.log('Trying SerpApi (regular)');
                    return searchSerpApi(query, (err, results) => {
                        if (!err && results && results.length) {
                            return safeRenderEnd(res, query, results, "SerpApi", reqType);
                        }
                        if (err) console.error('SerpApi error:', err && err.message ? err.message : err);

                        // continue with other fallbacks below
                        console.log('Trying RapidAPI #1');
                        return searchRapidAPI1(query, (err1, r1) => {
                            if (!err1 && r1 && r1.length) return safeRenderEnd(res, query, r1, "RapidAPI #1", reqType);
                            if (err1) console.error('RapidAPI1 error:', err1 && err1.message ? err1.message : err1);

                            console.log('Trying RapidAPI #2 (Images)');
                            return searchRapidAPI2(query, (err2, r2) => {
                                if (!err2 && r2 && r2.length) return safeRenderEnd(res, query, r2, "RapidAPI #2 (Images)", reqType);
                                if (err2) console.error('RapidAPI2 error:', err2 && err2.message ? err2.message : err2);

                                console.log('Trying RapidAPI #3 (Patents)');
                                return searchRapidAPI3(query, (err3, r3) => {
                                    if (!err3 && r3 && r3.length) return safeRenderEnd(res, query, r3, "RapidAPI #3 (Patents)", reqType);
                                    if (err3) console.error('RapidAPI3 error:', err3 && err3.message ? err3.message : err3);

                                    console.log('Trying Wikipedia API');
                                    return searchWikipedia(query, (errW, wres) => {
                                        if (!errW && wres && wres.length) return safeRenderEnd(res, query, wres, "Wikipedia API", reqType);
                                        if (errW) console.error('Wikipedia error:', errW && errW.message ? errW.message : errW);

                                        return safeRenderEnd(res, query, [], "Link fallback", reqType);
                                    });
                                });
                            });
                        });
                    });
                });
            });
        }

        console.log('Trying SerpApi');
        return searchSerpApi(query, (err, results) => {
            if (!err && results && results.length) return safeRenderEnd(res, query, results, "SerpApi", reqType);
            if (err) console.error('SerpApi error:', err && err.message ? err.message : err);

            // 2) RapidAPI #1
            console.log('Trying RapidAPI #1');
            return searchRapidAPI1(query, (err1, r1) => {
                if (!err1 && r1 && r1.length) return safeRenderEnd(res, query, r1, "RapidAPI #1", reqType);
                if (err1) console.error('RapidAPI1 error:', err1 && err1.message ? err1.message : err1);

                // 3) RapidAPI #2 (images)
                console.log('Trying RapidAPI #2 (Images)');
                return searchRapidAPI2(query, (err2, r2) => {
                    if (!err2 && r2 && r2.length) return safeRenderEnd(res, query, r2, "RapidAPI #2 (Images)", reqType);
                    if (err2) console.error('RapidAPI2 error:', err2 && err2.message ? err2.message : err2);

                    // 4) RapidAPI #3 (patents)
                    console.log('Trying RapidAPI #3 (Patents)');
                    return searchRapidAPI3(query, (err3, r3) => {
                        if (!err3 && r3 && r3.length) return safeRenderEnd(res, query, r3, "RapidAPI #3 (Patents)", reqType);
                        if (err3) console.error('RapidAPI3 error:', err3 && err3.message ? err3.message : err3);

                        // 5) Wikipedia
                        console.log('Trying Wikipedia API');
                        return searchWikipedia(query, (errW, wres) => {
                            if (!errW && wres && wres.length) return safeRenderEnd(res, query, wres, "Wikipedia API", reqType);
                            if (errW) console.error('Wikipedia error:', errW && errW.message ? errW.message : errW);

                            // 6) final link fallback
                            return safeRenderEnd(res, query, [], "Link fallback", reqType);
                        });
                    });
                });
            });
        });

        return;
    }

});

const PORT = process.env.PORT || 10000;

// Global error handlers to avoid silent crashes
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("🌟 Red Star Search Hybrid running");
});