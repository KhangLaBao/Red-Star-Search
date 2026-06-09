const http = require("http");
const https = require("https");
const url = require("url");

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
// SEARXNG SEARCH (PRIMARY)
// -----------------------------
function searchSearx(query, callback) {
    const url = `https://searx.be/search?q=${encodeURIComponent(query)}&format=json`;
    fetchJSON(url, callback);
}

// -----------------------------
// DUCKDUCKGO FALLBACK (HTML)
// -----------------------------
function searchDDG(query, callback) {
    const url = "https://duckduckgo.com/html/?q=" + encodeURIComponent(query);

    https.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        }
    }, (res) => {

        let data = "";

        res.on("data", c => data += c);

        res.on("end", () => {
            callback(null, data);
        });

    }).on("error", err => callback(err, null));
}

// -----------------------------
// PARSE DDG HTML
// -----------------------------
function parseDDG(html) {
    const results = [];
    const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;

    let match;

    while ((match = regex.exec(html)) !== null) {
        let link = match[1];
        let title = match[2].replace(/<[^>]*>/g, "").trim();

        results.push({ title, link });
    }

    return results;
}

// -----------------------------
// RENDER HTML
// -----------------------------
function render(query, results, source) {
    let out = `
    <html>
    <head>
        <meta charset="utf-8">
        <title>Red Star Search(12.9)</title>
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
            <h1>🌟 Red Star Search (12.9)</h1>
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
        // STEP 1: SEARXNG
        // -----------------------------
        searchSearx(query, (err, data) => {

            if (!err && data && data.results && data.results.length) {

                const results = data.results.map(r => ({
                    title: r.title,
                    link: r.url
                }));

                return res.end(render(query, results, "SearXNG"));
            }

            // -----------------------------
            // STEP 2: DDG fallback
            // -----------------------------
            searchDDG(query, (err2, html) => {

                if (!err2 && html) {

                    const results = parseDDG(html);

                    if (results.length) {
                        return res.end(render(query, results, "DuckDuckGo HTML"));
                    }
                }

                // -----------------------------
                // STEP 3: FINAL fallback
                // -----------------------------
                return res.end(render(query, [], "Wikipedia fallback"));
            });
        });

        return;
    }

});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("🌟 Red Star Search Hybrid running");
});