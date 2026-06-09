const http = require("http");
const https = require("https");
const url = require("url");

// -------------------------
// DUCKDUCKGO INSTANT API
// -------------------------
function searchDDG(query, callback) {
    const api = "https://api.duckduckgo.com/?q="
        + encodeURIComponent(query)
        + "&format=json&no_html=1&skip_disambig=1";

    const req = https.get(api, (res) => {
        let data = "";

        res.on("data", chunk => data += chunk);

        res.on("end", () => {
            try {
                const json = JSON.parse(data);
                callback(null, json);
            } catch (e) {
                callback(e, null);
            }
        });
    });

    // 🚩 IMPORTANT: prevent infinite hanging
    req.setTimeout(6000, () => {
        req.destroy();
        callback(new Error("timeout"), null);
    });

    req.on("error", (err) => {
        callback(err, null);
    });
}
// -------------------------
// HTML RENDER
// -------------------------
function renderPage(title, content) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
            body { font-family: Arial; padding: 20px; background: #eee; }
            a { color: #1122cc; }
            .box { background: white; padding: 10px; border: 1px solid #999; }
        </style>
    </head>
    <body>
        <h1>🌟 Red Star Search</h1>
        <form action="/search">
            <input name="q" style="width:300px;">
            <button>Search</button>
        </form>
        <hr>
        ${content}
    </body>
    </html>
    `;
}

// -------------------------
// SERVER
// -------------------------
const server = http.createServer((req, res) => {

    const q = url.parse(req.url, true);

    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
    });

    // HOME
    if (q.pathname === "/") {
        return res.end(renderPage("Home", "<p>Enter a query to search.</p>"));
    }

    // SEARCH
    if (q.pathname === "/search") {

        const query = (q.query.q || "").trim();

        if (!query) {
            return res.end(renderPage("Empty", "<p>No query.</p>"));
        }

        searchDDG(query, (err, data) => {

            // -------------------
            // FALLBACK MODE
            // -------------------
            if (err || !data) {
                return res.end(renderPage(query, `
                    <p><b>Search failed.</b></p>
                    <a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}">
                        Wikipedia fallback
                    </a><br>
                    <a href="https://duckduckgo.com/?q=${encodeURIComponent(query)}">
                        DuckDuckGo fallback
                    </a>
                `));
            }

            // -------------------
            // MAIN RESULT
            // -------------------
            let content = `<div class="box">`;

            content += `<h2>${data.Heading || query}</h2>`;
            content += `<p>${data.AbstractText || "No instant answer found."}</p>`;

            if (data.AbstractURL) {
                content += `<a href="${data.AbstractURL}" target="_blank">
                    Source Link
                </a>`;
            }

            content += `</div>`;

            // Related topics (simple)
            if (data.RelatedTopics && data.RelatedTopics.length) {
                content += "<h3>Related</h3><ul>";

                data.RelatedTopics.slice(0, 5).forEach(t => {
                    if (t.FirstURL && t.Text) {
                        content += `<li><a href="${t.FirstURL}" target="_blank">${t.Text}</a></li>`;
                    }
                });

                content += "</ul>";
            }

            res.end(renderPage(query, content));
        });

        return;
    }

    res.end("404");
});

// -------------------------
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
    console.log("🌟 Red Star Search running on port " + PORT);
});