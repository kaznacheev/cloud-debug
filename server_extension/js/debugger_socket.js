function DebuggerSocket() {
  this._buffer = "";
}

DebuggerSocket.DEFAULT_SOCKET = "chrome_devtools_remote";

DebuggerSocket.FRONTEND_URL = "http://chrome-devtools-frontend.appspot.com/serve_rev/@{REV}/devtools.html";

DebuggerSocket.connect = function(socketName, callback) {
  if (socketName == DebuggerSocket.DEFAULT_SOCKET)
    callback(new DebuggerSocket());
  else
    callback();
};

DebuggerSocket.prototype = {
  close: function () {
    if (this._closing)
      return;
    this._closing = true;
    if (this._debuggee) {
      chrome.debugger.onDetach.removeListener(this._onDebuggerDetachBound);
      chrome.debugger.onEvent.removeListener(this._onDebuggerEventBound);
      chrome.debugger.detach(this._debuggee, function() {});
    }
    if (this.onclose)
      this.onclose();
  },

  send: function (data) {
    if (this._debuggee) {
      this._parseWebSocket(data);
      return;
    }

    this._buffer += ByteArray.toString(new Uint8Array(data));

    for (;;) {
      var endPos = this._buffer.indexOf("\r\n\r\n");
      if (endPos < 0)
        return;
      var lines = this._buffer.substr(0, endPos).split("\r\n");
      this._buffer = this._buffer.substr(endPos + 4);

      if (!lines.length) {
        this._respond400();
        return;
      }
      var requestParams = lines[0].split(' ');
      if (requestParams.length != 3 || requestParams[0].toUpperCase() != 'GET') {
        this._respond400();
        return;
      }
      var path = requestParams[1];
      var headers = {};
      lines.slice(1).forEach(function (line) {
        var colonPos = line.indexOf(":");
        if (colonPos > 0) {
          headers[line.substr(0, colonPos).trim().toLowerCase()] =
              line.substr(colonPos + 1).trim().toLowerCase();
        }
      });

      if (this._handleWebSocket(path, headers))
        return;

      this._handleGet(path, headers);
    }
  },

  _respond: function (buffer) {
    if (this.onmessage)
      this.onmessage(buffer);
  },

  _respondHTTP: function (status, message, headers, body) {
    var response = "HTTP/1.1 " + status + " " + message + "\r\n";
    if (!headers && body)
      headers = [];

    if (headers) {
      if (body)
        headers.push("Content-Length:" + body.length);
      response += headers.join("\r\n") + "\r\n";
    }
    response += "\r\n";
    if (body)
      response += body;
    this._respond(ByteArray.fromString(response).buffer);
  },

  _respond101: function() {
    this._respondHTTP(101, "WebSocket Protocol Handshake");
  },

  _respond200: function (body) {
    var headers;
    if (body && (typeof body != 'string')) {
      body = JSON.stringify(body);
      headers = ["Content-Type:application/json"];
    }
    this._respondHTTP(200, "OK", headers, body);
  },

  _respond400: function () {
    this._respondHTTP(400, "Bad request");
  },

  _respond404: function (message) {
    this._respondHTTP(404, "Not found", null, message);
  },

  _augmentTarget:  function(frontendUrl, host, target) {
    if (!target.attached) {
      var debugPath = host + "/devtools/page/" + target.id;
      target.devtoolsFrontendUrl = frontendUrl + "?ws=" + debugPath;
      target.webSocketDebuggerUrl = "ws://" + debugPath;
    }
    return target;
  },

  _createTargetHTML: function(target) {
    return '<a href="' + target.devtoolsFrontendUrl + '" ' +
           ' title="' + target.url + '">' + (target.title || 'untitled') + '</a>' +
           '&nbsp;&nbsp;(' + target.type + ')<br>';
  },

  _getTargetList: function(host, callback) {
    VersionInfo.request(function(version) {
      var frontendUrl = DebuggerSocket.FRONTEND_URL.replace("{REV}", version["WebKit-Revision"]);
      chrome.debugger.getTargets(function (targets) {
        callback(targets.map(this._augmentTarget.bind(this, frontendUrl, host)));
      }.bind(this));
    }.bind(this));
  },

  _handleGet: function (path, headers) {
    console.debug("GET " + path);
    var host = headers['host'] || '';

    if (path == "/") {
      this._getTargetList(host, function(targets) {
        this._respond200(targets.map(this._createTargetHTML.bind(this)).join('\n'));
      }.bind(this));
      return;
    }

    if (path == '/json/version') {
      VersionInfo.request(this._respond200.bind(this));
      return;
    }

    if (path == '/json' || path == '/json/list') {
      this._getTargetList(host, this._respond200.bind(this));
      return;
    }

    var match = path.match('^/json/new(\\?(.+)$)?');
    if (match) {
      var params = {};
      var url = match[2];
      if (url)
        params.url = decodeURIComponent(url);
      chrome.tabs.create(params);
      this._respond200();
      return;
    }

    match = path.match('^/json/(\\w+)/(.+)$');
    if (match) {
      var action = match[1];
      var targetId = match[2];

      chrome.debugger.getTargets(function (targets) {
        var target = targets.filter(function (target) {
          return target.id == targetId;
        })[0];

        if (!target || !target.tabId) {
          this._respond404("Target not found");
          return;
        }

        switch (action) {
          case 'activate':
            chrome.tabs.update(target.tabId, {active: true});
            this._respond200('Target activated');
            break;

          case 'close':
            chrome.tabs.remove(target.tabId);
            this._respond200('Target is closing');
            break;

          default:
            this._respond404('Unsupported action ' + action);
        }
      }.bind(this));
      return;
    }

    this._respond404('Unsupported path ' + path);
  },

  _handleWebSocket: function (path, headers) {
    if (headers["upgrade"] != "websocket")
      return false;

    var match = path.match("^/devtools/page/(.+)$");
    if (match) {
      var debuggee = {targetId: match[1]};
      chrome.debugger.attach(
          debuggee,
          VersionInfo.DEBUGGER_PROTOCOL,
          this._onDebuggerAttach.bind(this, debuggee));
      return true;
    }
    this._respond404("WebSocket not found at " + path);
    return true;
  },

  _onDebuggerAttach: function(debuggee) {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
      this._respond404(chrome.runtime.lastError.message);
      return;
    }

    console.debug('Debugger attached');
    if (this._closing) {
      chrome.debugger.detach(debuggee, function() {});
      return;
    }

    this._debuggee = debuggee;
    this._onDebuggerDetachBound = this._onDebuggerDetach.bind(this);
    this._onDebuggerEventBound = this._onDebuggerEvent.bind(this);
    chrome.debugger.onDetach.addListener(this._onDebuggerDetachBound);
    chrome.debugger.onEvent.addListener(this._onDebuggerEventBound);

    this._respond101();
  },

  _onDebuggerDetach: function(debuggee) {
    if (this._debuggee.targetId != debuggee.targetId)
      return;

    console.debug('Debugger detached');
    this.close();
  },

  _onDebuggerEvent: function(debuggee, method, params) {
    if (this._debuggee.targetId != debuggee.targetId)
      return;

    var message = { method: method };
    if (params)
      message.params = params;
    this._sendWebSocketFrame(JSON.stringify(message));
  },

  _parseWebSocket: function(arrayBuffer) {
    this._byteBuffer = ByteArray.concat(this._byteBuffer, new Uint8Array(arrayBuffer));

    for(;;) {
      var result;
      try {
        result = Hybi17.decode(this._byteBuffer);
      } catch (e) {
        console.error('Hybi17 decode error', e.stack);
        this.close();
        return;
      }
      if (!result)
        return;

      var message = ByteArray.toString(result.data);
      this._byteBuffer = this._byteBuffer.subarray(result.consumed);

      var messageObj;
      try {
        messageObj = JSON.parse(message);
      } catch (e) {
        console.error('Cannot parse ' + message, e.stack);
        this.close();
        return;
      }
      chrome.debugger.sendCommand(
          this._debuggee,
          messageObj.method,
          messageObj.params,
          this._onDebuggerCommandResponse.bind(this, messageObj.id));
    }
  },

  _onDebuggerCommandResponse: function(id, result) {
    this._sendWebSocketFrame(JSON.stringify({id: id, result: result }));
  },

  _sendWebSocketFrame: function(message) {
    this._respond(Hybi17.encode(ByteArray.fromString(message)).buffer);
  }
};

var Hybi17 = {};

Hybi17.encode = function(data) {
  var lengthCode;
  var lengthFieldSize;
  if (data.length <= 125) {
    lengthCode = data.length;
    lengthFieldSize = 0;
  } else if (data.length <= 0xFFFF) {
    lengthCode = 126;
    lengthFieldSize = 2;
  } else {
    lengthCode = 127;
    lengthFieldSize = 8;
  }
  var dataStart = 2 + lengthFieldSize + 4;

  var frame = new Uint8Array(dataStart + data.length);

  frame[0] = 128 | 1;
  frame[1] = 128 | lengthCode;

  if (lengthFieldSize) {
    var longLength = data.length;
    for (var i = 0; i != lengthFieldSize; ++i) {
      frame[2 + lengthFieldSize - 1 - i] = longLength & 0xFF;
      longLength >>= 8;
    }
  }

  var mask = frame.subarray(dataStart - 4, dataStart);
  for (var i = 0; i != mask.length; ++i)
    mask[i] = Math.ceil(Math.random() * 0xFF);

  for (var i = 0; i != data.length; ++i)
    frame[dataStart + i] = data[i] ^ mask[i % 4];

  return frame;
};

Hybi17.decode = function(frame) {
  if (frame.length < 2)
    return null;

  var fin = (frame[0] & 128) >> 7;
  var op = frame[0] & 15;

  if (fin != 1 || op != 1)
    throw new Error('Unsupported first byte = ' + frame[0].toString(16));

  var lengthFieldSize;
  var dataLength = frame[1] & 127;
  if (dataLength == 127) {
    lengthFieldSize = 8;
  } else if (dataLength == 126) {
    lengthFieldSize = 2;
  } else {
    lengthFieldSize = 0;
  }

  var dataStart = 2 + lengthFieldSize + 4;
  if (frame.length < dataStart)
    return null;

  if (lengthFieldSize) {
    dataLength = 0;
    for (var i = 0; i < lengthFieldSize; i++) {
      dataLength = dataLength * 256 + frame[2 + i];
    }
  }

  var frameSize = dataStart + dataLength;
  if (frame.length < frameSize)
    return null;

  var mask = frame.subarray(dataStart - 4, dataStart);

  var data = new Uint8Array(dataLength);
  for (var i = 0; i != dataLength; ++i) {
    data[i] = frame[dataStart + i] ^ mask[i % 4];
  }

  return {
    data: data,
    consumed: frameSize
  };
};