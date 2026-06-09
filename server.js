const http = require("http");
const https = require("https");
const url = require("url");
const { getJson } = require("serpapi");

// --- API KEYS / CONFIG ---
const SERP_API_KEY = "f48359b7370f31c965f4ac42605920376c3797ee39fe7131ec139b3af4fa56ea";
const RAPIDAPI_KEY = "fe7f18dd34msh28d6ac0d74956fbp12b4afjsnb31038159c43";

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
    if (Array.isArray(json)) return json.map(r => ({ title: r.title || r.name || r.title_no_formatting || r.heading || r.query || String(r).slice(0,60), link: r.link || r.url || r.link_url || r.source || r.href || "" }));
    if (json.organic_results) return json.organic_results.map(r => ({ title: r.title, link: r.link || r.url }));
    if (json.results) return json.results.map(r => ({ title: r.title || r.name, link: r.link || r.url }));
    if (json.items) return json.items.map(r => ({ title: r.title || r.name, link: r.link || r.url }));
    return [];
}

// -----------------------------
// SERPAPI (PRIMARY - provided key)
// -----------------------------
function searchSerpApi(query, callback) {
    try {
        getJson({
            engine: "google",
            q: query,
            google_domain: "google.com",
            hl: "en",
            gl: "us",
            api_key: SERP_API_KEY
        }, (json) => {
            try {
                const results = normalizeResultsFromJson(json);
                if (results.length) return callback(null, results);
                return callback(new Error("no results from serpapi"), null);
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
        res.on('data', c => data += c);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const results = normalizeResultsFromJson(json);
                return callback(null, results.length ? results : []);
            } catch (e) {
                // not JSON or parse error — return text as single result if useful
                return callback(null, []);
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
function render(query, results, source) {
    let out = `
    <html>
    <head>
        <meta charset="utf-8">
        <title>Red Star Search(12.10)</title>
        <style>
            body { font-family: Arial; background:#eee; padding:20px; }
            .box { background:#fff; padding:10px; margin:10px 0; }
            a { color:blue; }
        </style>
    </head>
    <body>

    <h1>🌟 Red Star Search</h1>

    <form action="/search">
        <input name="q" value="${query}" style="width:300px;">
        <button>Search</button>
    </form>

    <p><small>Source: ${source}</small></p>

    <h2>Results for: ${query}</h2>
    `;

    if (!results.length) {
        out += `
            <p><b>No results found.</b></p>
            <a href="https://en.wikipedia.org/wiki/Special:Search?search=${query}">
                Wikipedia fallback
            </a>
        `;
    } else {
        results.slice(0, 10).forEach(r => {
            out += `
                <div class="box">
                    <a href="${r.link}" target="_blank">${r.title}</a>
                    <br><small>${r.link}</small>
                </div>
            `;
        });
    }

    out += "</body></html>";
    return out;
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
            <h1>🌟 Red Star Search (12.10)</h1>
            <form action="/search">
                <input name="q">
                <button>Search</button>
            </form>
        `);
    }

    // SEARCH
    if (q.pathname === "/search") {

        const query = q.query.q || "";

        // -----------------------------
        // Provider chain (in order):
        // 1) SerpApi, 2) RapidAPI #1, 3) RapidAPI #2, 4) RapidAPI #3,
        // 5) Wikipedia, 6) Link fallback
        // -----------------------------

        // 1) SerpApi
        return searchSerpApi(query, (err, results) => {
            if (!err && results && results.length) return res.end(render(query, results, "SerpApi"));
            if (err) console.error('SerpApi error:', err && err.message ? err.message : err);

            // 2) RapidAPI #1
            return searchRapidAPI1(query, (err1, r1) => {
                if (!err1 && r1 && r1.length) return res.end(render(query, r1, "RapidAPI #1"));
                if (err1) console.error('RapidAPI1 error:', err1 && err1.message ? err1.message : err1);

                // 3) RapidAPI #2 (images)
                return searchRapidAPI2(query, (err2, r2) => {
                    if (!err2 && r2 && r2.length) return res.end(render(query, r2, "RapidAPI #2 (Images)"));
                    if (err2) console.error('RapidAPI2 error:', err2 && err2.message ? err2.message : err2);

                    // 4) RapidAPI #3 (patents)
                    return searchRapidAPI3(query, (err3, r3) => {
                        if (!err3 && r3 && r3.length) return res.end(render(query, r3, "RapidAPI #3 (Patents)"));
                        if (err3) console.error('RapidAPI3 error:', err3 && err3.message ? err3.message : err3);

                        // 5) Wikipedia
                        return searchWikipedia(query, (errW, wres) => {
                            if (!errW && wres && wres.length) return res.end(render(query, wres, "Wikipedia API"));
                            if (errW) console.error('Wikipedia error:', errW && errW.message ? errW.message : errW);

                            // 6) final link fallback
                            return res.end(render(query, [], "Link fallback"));
                        });
                    });
                });
            });
        });

        return;
    }

});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("🌟 Red Star Search Hybrid running");
});