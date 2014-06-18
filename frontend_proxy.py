#!/usr/bin/python

import BaseHTTPServer
import re
import sys
import urllib2

SOURCE_URL = "http://chrome-devtools-frontend.appspot.com/serve_rev/@%s%s"

WEBSOCKET_PATCH = """
window.WebSocket = function() {
    console.log("Created patched WebSocket");
    this.send = function(message) {
        window.parent.postMessage(message, "*");
    };
    window.addEventListener('message', function(event) {
        try {
            this.onmessage(event);
        } catch(e) {
            console.error("Cannot parse message", event.data.length, event.data);
            console.log(e.stack);
        }
    }.bind(this));
    setTimeout(function() {
        this.onopen();
    }.bind(this), 0);
};
"""

class Handler(BaseHTTPServer.BaseHTTPRequestHandler):
    def do_GET(self):
        match = re.match("^/(\d+)(/.+)$", self.path)
        if match:
            revision = match.group(1)
            path = match.group(2)
            try:
                url = "http://localhost:8001" + path
                # url = SOURCE_URL % (revision, path)
                print "Fetching", url
                response = urllib2.urlopen(url)
                content = response.read()

                if "new WebSocket(" in content:
                    content += WEBSOCKET_PATCH

                self.send_response(200)

                for header in response.headers.headers:
                    match = re.match("(.+)\s*?:\s*?(.+)", header)
                    if not match:
                        continue
                    header_key = match.group(1)
                    if header_key.lower() == "content-length":
                        continue
                    header_value = match.group(2)
                    self.send_header(header_key, header_value)

            except urllib2.HTTPError, e:
                content = str(e)
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
        else:
            content = "Malformed URL"
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")

        self.send_header("Content-Length", len(content))
        self.end_headers()
        self.wfile.write(content)


def main():
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    else:
        port = 8002

    print 'Serving at port %d' % port

    httpd = BaseHTTPServer.HTTPServer(('', port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()


if __name__ == '__main__':
    main()