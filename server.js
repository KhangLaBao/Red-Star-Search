const http = require("http");
const https = require("https");
const url = require("url");

function htmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtml(str) {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#x27;/g, "'");
}

function fetchDuckDuckGo(query, callback) {
  const target = "https://duckduckgo.com/html/?q=" + encodeURIComponent(query);

  https.get(target, (res) => {
    let data = "";

    res.on("data", (chunk) => {
      data += chunk;
    });

    res.on("end", () => {
      callback(null, data);
    });
  }).on("error", (err) => {
    callback(err, null);
  });
}

function extractResults(html) {
  const results = [];
  const seen = {};

  const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let link = match[1];
    let title = match[2];

    title = title.replace(/<[^>]+>/g, "");
    title = decodeHtml(title).trim();
    link = decodeHtml(link).trim();

    if (!link || seen[link]) continue;
    seen[link] = true;

    results.push({
      title: title || link,
      link: link
    });
  }

  return results;
}

function renderPage(title, body) {
  return `
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body {
      background: #e5e5e5;
      color: #000;
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 16px;
    }
    .box {
      max-width: 800px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #999;
      padding: 16px;
    }
    h1, h2 {
      margin-top: 0;
      color: #cc0000;
    }
    a {
      color: #1122cc;
    }
    .result {
      margin: 0 0 16px 0;
      padding-bottom: 12px;
      border-bottom: 1px solid #ddd;
    }
    .url {
      color: #008000;
      font-size: 12px;
      word-break: break-all;
      margin-top: 4px;
    }
    .small {
      color: #666;
      font-size: 12px;
    }
    input[type="text"] {
      width: 70%;
      max-width: 500px;
      padding: 6px;
      border: 1px solid #666;
    }
    button {
      padding: 6px 12px;
      border: 1px solid #444;
      background: linear-gradient(to bottom, #f8f8f8, #c0c0c0);
      cursor: pointer;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="box">
    ${body}
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  if (parsed.pathname === "/healthz") {
    res.end("ok");
    return;
  }

  if (parsed.pathname === "/") {
    res.end(renderPage("Red Star Search", `
      <h1>🌟 Red Star Search</h1>
      <p class="small">Comrade, the backend is operational.</p>
      <form action="/search" method="get">
        <input type="text" name="q" placeholder="Search the entire web..." />
        <button type="submit">Search</button>
      </form>
    `));
    return;
  }

  if (parsed.pathname === "/search") {
    const query = (parsed.query.q || "").trim();

    if (!query) {
      res.end(renderPage("Red Star Search", `
        <h1>🌟 Red Star Search</h1>
        <p class="small">Type something in the box above, comrade.</p>
        <form action="/search" method="get">
          <input type="text" name="q" placeholder="Search the entire web..." />
          <button type="submit">Search</button>
        </form>
      `));
      return;
    }

    fetchDuckDuckGo(query, (err, html) => {
      if (err) {
        res.end(renderPage("Red Star Search", `
          <h1>🌟 Red Star Search</h1>
          <p><b>Error:</b> Could not fetch DuckDuckGo.</p>
          <p class="small">${htmlEscape(err.message || String(err))}</p>
          <p><a href="/">Back</a></p>
        `));
        return;
      }

      const results = extractResults(html);

      let output = `
        <h1>🌟 Red Star Search</h1>
        <p class="small">Results for: <b>${htmlEscape(query)}</b></p>
        <form action="/search" method="get">
          <input type="text" name="q" value="${htmlEscape(query)}" />
          <button type="submit">Search</button>
        </form>
        <hr>
      `;

      if (!results.length) {
        output += `
          <p><b>No results found.</b></p>
          <p class="small">DuckDuckGo HTML returned no parseable links.</p>
        `;
      } else {
        results.slice(0, 10).forEach((r) => {
          output += `
            <div class="result">
              <div><a href="${htmlEscape(r.link)}">${htmlEscape(r.title)}</a></div>
              <div class="url">${htmlEscape(r.link)}</div>
            </div>
          `;
        });
      }

      output += `<p><a href="/">Back to home</a></p>`;
      res.end(renderPage(`Results for: ${query}`, output));
    });

    return;
  }

  res.statusCode = 404;
  res.end(renderPage("Not found", `
    <h1>404</h1>
    <p>Page not found, comrade.</p>
    <p><a href="/">Back to home</a></p>
  `));
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Red Star Server running on port " + PORT);
});