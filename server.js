const http = require("http");

const server = http.createServer(function(req, res) {

    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
    });

    res.end(`
        <html>
        <head>
            <title>Red Star Server</title>
        </head>
        <body bgcolor="#e5e5e5">
            <center>
                <h1>🌟 Red Star Server Online!</h1>
                <p>Comrade, the backend is operational.</p>
            </center>
        </body>
        </html>
    `);

});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", function() {
    console.log("Red Star Server running.");
});