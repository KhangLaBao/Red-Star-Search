const http = require("http");
const https = require("https");
const url = require("url");

// --------------------
// FETCH WITH RETRY + TIMEOUT
// --------------------
function fetchDuckDuckGo(query, callback, attempt = 1) {
    const target = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);

    const req = https.get(target, (res) => {
        let data = "";

        res.on("data", chunk => data += chunk);

        res.on("end", () => {
            callback(null, data);
        });
    });

    // IMPORTANT: prevent infinite hang
    req.setTimeout(8000, () => {
        req.destroy();

        if (attempt < 3) {
            return fetchDuckDuckGo(query, callback, attempt + 1);
        }

        callback(new Error("Timeout"), null);
    });

    req.on("error", () => {
        if (attempt < 3) {
            return fetchDuckDuckGo(query, callback, attempt + 1);
        }
        callback(new Error("Request failed"), null);
    });
}

// --------------------
// EXTRACT RESULTS (stable regex)
// --------------------
function extractResults(html) {
    const results = [];
    const seen = {};

    const regex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/g;

    let match;

    while ((match = regex.exec(html)) !== null) {
        let link = match[1];
        let title = match[2].replace(/<[^>]+>/g, "").trim();

        if (!link || seen[link]) continue;
        seen[link] = true;

        // skip DDG internal links
        if (link.includes("duckduckgo.com")) continue;

        results.push({ title, link });
    }

    return results;
}

// --------------------
// SERVER
// --------------------
const server = http.createServer((req, res) => {
    const q = url.parse(req.url, true);

    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
    });

    // HOME
    if (q.pathname === "/") {
        return res.end(`
            <h1>🌟 Red Star Search</h1>
            <form action="/search">
                <input name="q" />
                <button>Search</button>
            </form>
        `);
    }

    // SEARCH
    if (q.pathname === "/search") {
        const query = (q.query.q || "").trim();

        if (!query) {
            return res.end("<h2>Type something</h2>");
        }

        fetchDuckDuckGo(query, (err, html) => {

            // --------------------
            // FALLBACK (NO CRASH)
            // --------------------
            if (err || !html) {
                return res.end(`
                    <h2>Results for: ${query}</h2>
                    <p><b>Search engine failed. Showing fallback:</b></p>
                    <p><a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}">Wikipedia</a></p>
                    <p><a href="https://www.google.com/search?q=${encodeURIComponent(query)}">Google</a></p>
                `);
            }

            const results = extractResults(html);

            let out = `<h2>Results for: ${query}</h2>`;

            if (!results.length) {
                out += "<p>No results found.</p>";
            } else {
                results.slice(0, 10).forEach(r => {
                    out += `
                        <p>
                            <a href="${r.link}">${r.title || r.link}</a><br>
                            <small>${r.link}</small>
                        </p>
                    `;
                });
            }

            res.end(out);
        });

        return;
    }

    res.end("<h1>404</h1>");
});

// --------------------
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
    console.log("Red Star Search running on port " + PORT);
});