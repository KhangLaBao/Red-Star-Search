const http = require("http");
const https = require("https");
const url = require("url");
const options = {
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }
};


// -----------------------------
// FETCH DUCKDUCKGO HTML RESULTS
// -----------------------------
function searchDDG(query, callback) {
    const searchUrl =
        "https://duckduckgo.com/html/?q=" +
        encodeURIComponent(query);

    https.get(searchUrl, (res) => {
        let data = "";

        res.on("data", chunk => data += chunk);

res.on("end", () => {
    console.log("RAW HTML START >>>");
    console.log(data.slice(0, 1000));
    console.log("RAW HTML END <<<");

    callback(null, data);
});

    }).on("error", (err) => {
        callback(err, null);
    });
}

// -----------------------------
// PARSE RESULTS (FROGFIND STYLE)
// -----------------------------
function parseResults(html) {
    const results = [];

    // Step 1: extract ALL links from results page
    const regex = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>(.*?)<\/a>/g;

    let match;

    while ((match = regex.exec(html)) !== null) {
        let link = cleanLink(match[1]);
        let title = match[2].replace(/<[^>]*>/g, "").trim();

        // filter garbage links
        if (!title || !link) continue;
        if (link.includes("duckduckgo.com/y.js")) continue;

        results.push({ title, link });
    }

    return results;
}

function cleanLink(url) {
    try {
        // Case 1: DuckDuckGo redirect with uddg=
        if (url.includes("uddg=")) {
            const part = url.split("uddg=")[1];
            return decodeURIComponent(part);
        }

        // Case 2: relative DDG redirect
        if (url.startsWith("/l/?")) {
            const part = url.split("uddg=")[1];
            if (part) return decodeURIComponent(part);
        }

        // Case 3: protocol-relative links
        if (url.startsWith("//")) {
            return "https:" + url;
        }

        return url;
    } catch (e) {
        return url;
    }
}

// -----------------------------
// HTML PAGE RENDER
// -----------------------------
function renderPage(query, results) {
    let output = `
    <html>
    <head>
        <meta charset="utf-8">
        <title>Red Star Search</title>
        <style>
            body { font-family: Arial; background:#eee; padding:20px; }
            a { color:#0000EE; }
            .box { background:white; padding:10px; margin:10px 0; }
        </style>
    </head>
    <body>
        <h1>🌟 Red Star Search (Ver 12.8)</h1>

        <form action="/search">
            <input name="q" value="${query}" style="width:300px;">
            <button>Search</button>
        </form>

        <hr>

        <h2>Results for: ${query}</h2>
    `;

    if (!results.length) {
        output += `
            <p><b>No results found.</b></p>
            <a href="https://en.wikipedia.org/wiki/Special:Search?search=${query}">
                Wikipedia fallback
            </a>
        `;
    } else {
        results.slice(0, 10).forEach(r => {
            output += `
                <div class="box">
                    <a href="${r.link}" target="_blank">${r.title}</a>
                    <br>
                    <small>${r.link}</small>
                </div>
            `;
        });
    }

    output += `
    </body>
    </html>
    `;

    return output;
}

// -----------------------------
// SERVER
// -----------------------------
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
                <input name="q">
                <button>Search</button>
            </form>
        `);
    }

    // SEARCH
    if (q.pathname === "/search") {

        const query = q.query.q || "";

        searchDDG(query, (err, html) => {

            if (err || !html) {
                return res.end(renderPage(query, []));
            }

            const results = parseResults(html);

            return res.end(renderPage(query, results));
        });

        return;
    }

    res.end("404");
});

// -----------------------------
const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("🌟 Red Star Search running on port " + PORT);
});