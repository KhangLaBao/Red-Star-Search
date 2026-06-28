const http = require("http");
const https = require("https");
const url = require("url");
const fs = require('fs');
const path = require('path');
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
// API quotas & usage tracking (simple in-memory daily counters)
// Set daily limits via env vars: SERP_DAILY_LIMIT, RAPID1_DAILY_LIMIT, RAPID2_DAILY_LIMIT, RAPID3_DAILY_LIMIT, WIKI_DAILY_LIMIT
// -----------------------------
const API_LIMITS = {
    serp: Number(process.env.SERP_DAILY_LIMIT || 250),
    rapid1: Number(process.env.RAPID1_DAILY_LIMIT || 10000),
    rapid2: Number(process.env.RAPID2_DAILY_LIMIT || 10000),
    rapid3: Number(process.env.RAPID3_DAILY_LIMIT || 10000),
    wiki: Number(process.env.WIKI_DAILY_LIMIT || 10000)
};
let API_USAGE = { serp: 0, rapid1: 0, rapid2: 0, rapid3: 0, wiki: 0 };
let usageDay = (new Date()).toISOString().slice(0,10);
// Track month for monthly resets (YYYY-MM)
let usageMonth = (new Date()).toISOString().slice(0,7);

// persistent usage file so state survives sleeps/restarts
const USAGE_FILE = path.join(__dirname, 'api_usage.json');

function loadUsageFromFile() {
    try {
        if (!fs.existsSync(USAGE_FILE)) return;
        const raw = fs.readFileSync(USAGE_FILE, 'utf8');
        const obj = JSON.parse(raw || '{}');
        if (obj.api_usage) API_USAGE = Object.assign(API_USAGE, obj.api_usage);
        if (obj.api_limits) Object.assign(API_LIMITS, obj.api_limits);
        if (obj.usageDay) usageDay = obj.usageDay;
        if (obj.usageMonth) usageMonth = obj.usageMonth;
        if (obj.lastQuery) lastQuery = obj.lastQuery;
        console.log('Loaded API usage from', USAGE_FILE);
    } catch (e) {
        console.error('Failed to load usage file:', e && e.message ? e.message : e);
    }
}

function saveUsageToFile() {
    try {
        const obj = { api_usage: API_USAGE, api_limits: API_LIMITS, usageDay, usageMonth, lastQuery };
        fs.writeFileSync(USAGE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save usage file:', e && e.message ? e.message : e);
    }
}

// remember last search query so the home page can show it
let lastQuery = '';

// simple html escape to avoid injecting raw user input into pages
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c];
    });
}

// Allow overriding SerpApi reported usage from environment (useful to sync with provider)
if (process.env.SERP_API_USED || process.env.SERP_API_LIMIT) {
    try {
        if (process.env.SERP_API_LIMIT) API_LIMITS.serp = Number(process.env.SERP_API_LIMIT);
        if (process.env.SERP_API_USED) API_USAGE.serp = Number(process.env.SERP_API_USED);
    } catch (e) { /* ignore parse errors */ }
}

function checkResetUsage() {
    const today = (new Date()).toISOString().slice(0,10);
    const month = (new Date()).toISOString().slice(0,7);
    // Monthly reset has priority: if month changed, zero counters for new month
    if (month !== usageMonth) {
        API_USAGE = { serp: 0, rapid1: 0, rapid2: 0, rapid3: 0, wiki: 0 };
        usageMonth = month;
        usageDay = today;
        saveUsageToFile();
        return;
    }
    // Daily reset (within same month)
    if (today !== usageDay) {
        API_USAGE = { serp: 0, rapid1: 0, rapid2: 0, rapid3: 0, wiki: 0 };
        usageDay = today;
        saveUsageToFile();
    }
}

function recordUsage(provider) {
    if (!API_USAGE.hasOwnProperty(provider)) return;
    API_USAGE[provider] = (API_USAGE[provider] || 0) + 1;
    // persist immediately so state survives sleep/restarts
    try { saveUsageToFile(); } catch (e) {}
}

function getApiUsageHtml() {
    function pctLeft(limit, used) { if (!limit) return 0; return Math.max(0, Math.round((1 - (used / limit)) * 100)); }
    const serpLeft = pctLeft(API_LIMITS.serp, API_USAGE.serp);
    const r1Left = pctLeft(API_LIMITS.rapid1, API_USAGE.rapid1);
    const r2Left = pctLeft(API_LIMITS.rapid2, API_USAGE.rapid2);
    const r3Left = pctLeft(API_LIMITS.rapid3, API_USAGE.rapid3);
    const wikiLeft = pctLeft(API_LIMITS.wiki, API_USAGE.wiki);
    return `
        <div class="api-usage" style="margin-top:8px;font-size:12px;color:#333">
            <strong>API quotas left:</strong>
            <div>SerpApi: ${serpLeft}% (${API_USAGE.serp}/${API_LIMITS.serp})</div>
            <div>RapidAPI #1: ${r1Left}% (${API_USAGE.rapid1}/${API_LIMITS.rapid1})</div>
            <div>RapidAPI #2: ${r2Left}% (${API_USAGE.rapid2}/${API_LIMITS.rapid2})</div>
            <div>RapidAPI #3: ${r3Left}% (${API_USAGE.rapid3}/${API_LIMITS.rapid3})</div>
            <div>Wikipedia: ${wikiLeft}% (${API_USAGE.wiki}/${API_LIMITS.wiki})</div>
        </div>
    `;
}

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
    // record that we're making a SerpApi call
    recordUsage('serp');
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
    // record that we're making a SerpApi image call
    recordUsage('serp');
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
    // Map host to a rapid provider key and record usage
    try {
        if (host && host.indexOf('google-search74') !== -1) recordUsage('rapid1');
        else if (host && host.indexOf('google-search72') !== -1) recordUsage('rapid2');
        else if (host && host.indexOf('google-search-master-mega') !== -1) recordUsage('rapid3');
        else recordUsage('rapid1');
    } catch (e) {}
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
    // record wiki usage
    recordUsage('wiki');
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
        <title>Red Star Search(12.34)</title>
        <style>
            /* Ancient 2000-era WAP / web2.0 inspired styles (for this page only) */
            body{
                font-family: Verdana, Arial, Helvetica, sans-serif;
                background-color:#c0c0c0;
                color:#000;
                padding:14px;
                font-size:13px;
            }
            .page-wrap{ max-width:760px; margin:0 auto; }
            .logo{ display:block; margin-bottom:12px }
            .search-form{ background:#f7f3e0; border:2px outset #fff; padding:8px; border-radius:4px; overflow:hidden }
            /* Make input and button fit precisely — avoid inline whitespace gap */
            .search-input{ display:inline-block; box-sizing:border-box; width:calc(100% - 110px); padding:6px; border:2px inset #999; background:#fff9e6; font-size:14px }
            .search-btn{ display:inline-block; box-sizing:border-box; width:100px; padding:6px 8px; margin-left:6px; float:right; background:#ffdf80; border:2px solid #a06000; color:#000; font-weight:bold; cursor:pointer }
            .search-btn:active{ position:relative; top:1px }

            .note{ font-size:11px; color:#333 }

            .box{ background:#fff; padding:10px; margin:10px 0; border:2px solid #000; box-shadow:none }
            .result-title a{ color:#004080; font-weight:bold; text-decoration:underline }
            .result-meta{ color:#006400; font-size:12px; margin-top:6px }
            .result-snippet{ color:#222; font-size:13px; margin-top:8px }

            /* little beveled thumbnail area */
            .result-row{ display:flex; gap:8px }
            .thumb{ width:64px; height:48px; background:#eee; border:1px solid #999; text-align:center; line-height:48px; font-size:11px; color:#666 }

            /* retro link coloring */
            a{ color:#0000aa }

            /* small-screen fallback */
            @media (max-width:480px){
                .search-input{ width:60% }
                .thumb{ display:none }
            }

        </style>
    </head>
    <body>

    <h1>🌟 Red Star Search (Ver 12.34)</h1>
    <a href="https://red-star-search.onrender.com" style="display:inline-block;margin-bottom:12px;">&larr; Go back to HomePage!</a>

    <form action="/search" class="search-form">
        <input name="q" class="search-input" value="${query}">
        <button class="search-btn">Search</button>
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
                const thumbHtml = r.thumbnail ? `<div class="thumb"><img src="${r.thumbnail}" alt="thumbnail" style="max-width:64px;max-height:48px;border:0"></div>` : `<div class="thumb">&nbsp;</div>`;
                return `<div class="box"><div class="result-row">${thumbHtml}<div class="result-main"><div class="result-title"><a ${safeLink ? `href="${safeLink}" target="_blank" rel="noopener noreferrer"` : ''}>${r.title}</a></div><div class="result-meta">${safeLink || domain} • Type: web</div>${r.snippet?`<div class="result-snippet">${r.snippet}</div>`:''}</div></div></div>`;
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
    // reset daily counters if day changed
    checkResetUsage();

    // Admin endpoint to set usage values (e.g. /admin/usage?provider=serp&used=24&limit=250)
    if (q.pathname === '/admin/usage') {
        const prov = q.query.provider;
        const used = q.query.used !== undefined ? Number(q.query.used) : undefined;
        const limit = q.query.limit !== undefined ? Number(q.query.limit) : undefined;
        if (prov && API_USAGE.hasOwnProperty(prov)) {
            if (!Number.isNaN(used)) API_USAGE[prov] = used;
            if (!Number.isNaN(limit)) API_LIMITS[prov] = limit;
            // persist changes
            saveUsageToFile();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ok: true, provider: prov, used: API_USAGE[prov], limit: API_LIMITS[prov] }));
        }
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'invalid provider' }));
    }

    // Serve the block page directly if requested (avoid redirect loop)
    if (q.pathname === '/blocked.html') {
        const filePath = path.join(__dirname, 'blocked.html');
        return fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Failed to load block page');
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(data);
        });
    }

    // --- Browser blocking middleware based on User-Agent
    const ua = (req.headers['user-agent'] || '').toString();

    function majorFrom(regex) {
        const m = ua.match(regex);
        if (!m) return null;
        const v = parseInt(m[1].split('.')[0], 10);
        return Number.isNaN(v) ? null : v;
    }

    const isIE = /MSIE |Trident\//i.test(ua);
    const isOPR = /OPR\/(\d+)/i.test(ua);
    const isOperaOld = /Opera\/(\d+)/i.test(ua);
    const isChrome = /Chrome\/(\d+)/i.test(ua) && !/OPR\//i.test(ua) && !/Edg\//i.test(ua) && !/Chromium/i.test(ua) && !/CriOS/i.test(ua);
    const isFirefox = /Firefox\/(\d+)/i.test(ua);
    const isSafari = /Version\/(\d+)/i.test(ua) && /Safari\//i.test(ua) && !/Chrome|CriOS|Chromium|OPR|Edg/i.test(ua);

    const chromeMajor = majorFrom(/Chrome\/(\d+)/i);
    const firefoxMajor = majorFrom(/Firefox\/(\d+)/i);
    const safariMajor = majorFrom(/Version\/(\d+)/i);
    const oprMajor = majorFrom(/OPR\/(\d+)/i);
    const operaMajor = majorFrom(/Opera\/(\d+)/i);
    const operaMiniMajor = majorFrom(/Opera Mini\/(\d+)/i);
    const isEdge =
    /Edg\//.test(ua) ||
    /EdgA\//.test(ua) ||
    /EdgiOS\//.test(ua);

    let blocked = false;

    // Internet Explorer: allow all versions
    if (isIE) blocked = false;

    // Microsoft Edge: block ALL versions
    else if (isEdge) blocked = true;

    // Google Chrome: block Chrome 51+
    else if (isChrome && chromeMajor !== null && chromeMajor >= 51) blocked = true;

    // Firefox: allow up to v52, block v53+
    else if (isFirefox && firefoxMajor !== null && firefoxMajor >= 53) blocked = true;

    // Safari (Apple): allow up to v9, block v10+
    else if (isSafari && safariMajor !== null && safariMajor >= 10) blocked = true;

    // Opera (Chromium-based): OPR/15+ -> block
    else if (isOPR && oprMajor !== null && oprMajor >= 15) blocked = true;

    // Opera old (Presto) — allow up to 12; treat >12 as modern/blocked
    else if (!isOPR && isOperaOld && operaMajor !== null && operaMajor > 12) blocked = true;

    // Opera Mini: allow up to v9, block v10+
    else if (operaMiniMajor !== null && operaMiniMajor >= 10) blocked = true;

    if (blocked) {
        res.writeHead(302, { 'Location': '/blocked.html' });
        return res.end();
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

    // HOME
    if (q.pathname === "/") {
        return res.end(`
        <html>
        <head>
            <meta charset="utf-8">
            <title>Red Star Search</title>
            <style>
                /* Ancient 2000-era WAP / web2.0 inspired styles (home page) */
                body{ font-family: Verdana, Arial, Helvetica, sans-serif; background-color:#c0c0c0; color:#000; padding:14px; font-size:13px }
                .page-wrap{ max-width:760px; margin:0 auto }
                .logo{ display:block; margin-bottom:12px }
                .search-form{ background:#f7f3e0; border:2px outset #fff; padding:8px; border-radius:4px; overflow:hidden }
                .search-input{ display:inline-block; box-sizing:border-box; width:calc(100% - 110px); padding:6px; border:2px inset #999; background:#fff9e6; font-size:14px }
                .search-btn{ display:inline-block; box-sizing:border-box; width:100px; padding:6px 8px; margin-left:6px; float:right; background:#ffdf80; border:2px solid #a06000; color:#000; font-weight:bold; cursor:pointer }
                a{ color:#0000aa }
            </style>
        </head>
        <body>
            <div class="page-wrap">
                <h1>🌟 Red Star Search (12.34)</h1>
                <img class="logo" src="https://khanglabao.github.io/Red-Star-Search/imgs/logo.png" alt="Red Star Search logo">
                <form action="/search" class="search-form">
                    <input name="q" class="search-input" value="${escapeHtml(lastQuery)}">
                    <button class="search-btn">Search</button>
                </form>
                ${getApiUsageHtml()}
                <p class="note">Classic interface: Web 2.0 / WAP retro styling for this search UI only.</p>
            </div>
            <p>The counter may not accurate!</p>

<div class="notice-box">
    <b>📢 STATE INFORMATION BUREAU NOTICE 📢</b><br><br>

    Citizen, if your search appears slow, do not strike
    the monitor.

    The Render Central Search Computer Server is currently
    being awakened from an energy-conservation cycle.

    Archive personnel have been notified and are rushing
    toward the filing cabinets.

    Please allow one to two minutes for the machine to
    consume sufficient electricity and resume glorious
    operation.

    If more than three to five minutes have passed and
    your search request remains unfinished, please refresh
    the page or try again later. The machine may be
    experiencing an unusually stubborn awakening cycle.

    Thank you for your patience and continued support of
    reliable, but occasionally sleepy, infrastructure.

    Glory to low-bandwidth computing.
</div>

            <style> .notice-box {
    background: #fff8d5;
    border: 2px solid #aa8800;
    padding: 10px;
    margin: 10px 0;
    color: #000;
    font-size: 14px;
}</style>
        </body>
        </html>
        `);
    }

    // SEARCH
    if (q.pathname === "/search") {

        const query = q.query.q || "";
        // persist last query so homepage can show it after restarts
        try { lastQuery = query; saveUsageToFile(); } catch (e) {}
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

// load persisted usage on startup
loadUsageFromFile();

// save usage on process exit signals
function saveAndExit(code) {
    try { saveUsageToFile(); } catch (e) {}
    process.exit(code || 0);
}
process.on('SIGINT', () => saveAndExit(0));
process.on('SIGTERM', () => saveAndExit(0));

server.listen(PORT, "0.0.0.0", () => {
    console.log("🌟 Red Star Search Hybrid running");
});