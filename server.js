const http = require("http");
const https = require("https");
const url = require("url");

function fetchPage(query, callback) {
    const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(query);

    https.get(searchUrl, (res) => {
        let data = "";

        res.on("data", chunk => data += chunk);
        res.on("end", () => callback(data));
    }).on("error", () => {
        callback("<h1>Error fetching results</h1>");
    });
}

const server = http.createServer((req, res) => {

    const q = url.parse(req.url, true);

    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
    });

    // HOME PAGE
    if (req.url === "/") {
        res.end(`
            <h1>🌟 Red Star Search</h1>
            <form action="/search">
                <input name="q" />
                <button>Search</button>
            </form>
        `);
        return;
    }

    // SEARCH PAGE
    if (q.pathname === "/search") {
        const query = q.query.q || "test";

        fetchPage(query, (html) => {

            // SUPER SIMPLE CLEANING (retro mode)
            const links = html.match(/<a href="\/url\?q=(https.*?)&/g) || [];

            let output = "<h2>Results for: " + query + "</h2>";

            links.slice(0, 10).forEach(l => {
                const clean = l.replace('<a href="/url?q=', '').split("&")[0];

                output += `<p><a href="${clean}">${clean}</a></p>`;
            });

            res.end(output);
        });

        return;
    }

});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("Red Star Server running");
});