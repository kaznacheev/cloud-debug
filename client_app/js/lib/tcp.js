var TCP = {};

TCP.debug = false;

TCP.Socket = function(id, opt_owner) {
  this._id = id;
  this._owner = opt_owner;

  var logPrefix = "Socket " + this._id;
  this._logError = console.error.bind(console, logPrefix);
  if (TCP.debug)
    this._logDebug = console.debug.bind(console, logPrefix);
  else
    this._logDebug = function() {};

  TCP.Socket._register(this);
};

TCP.Socket._count = 0;

TCP.Socket._registry = {};

TCP.Socket._register = function(socket) {
  if (TCP.Socket._registry[socket._id]) {
    socket._logError('already registered');
    return;
  }

  if (TCP.Socket._count++ == 0) {
    chrome.sockets.tcp.onReceive.addListener(TCP.Socket._dispatchReceive);
    chrome.sockets.tcp.onReceiveError.addListener(TCP.Socket._dispatchReceiveError);
  }

  TCP.Socket._registry[socket._id] = socket;
  socket._logDebug("created, total: " + TCP.Socket._count);
};

TCP.Socket._unregister = function(socket) {
  if (!TCP.Socket._registry[socket._id]) {
    socket._logError('not registered');
    return;
  }

  delete TCP.Socket._registry[socket._id];

  if (--TCP.Socket._count == 0) {
    chrome.sockets.tcp.onReceive.removeListener(TCP.Socket._dispatchReceive);
    chrome.sockets.tcp.onReceiveError.removeListener(TCP.Socket._dispatchReceiveError);
  }
  socket._logDebug("deleted, total: " + TCP.Socket._count);
};

TCP.Socket.getByOwner = function(owner) {
  var results = [];
  for (var key in TCP.Socket._registry) {
    if (TCP.Socket._registry.hasOwnProperty(key)) {
      var socket = TCP.Socket._registry[key];
      if (socket._owner == owner)
        results.push(socket);
    }
  }
  return results;
};

TCP.Socket.connect = function(peerAddress, peerPort, owner, callback) {
  var logError = console.error.bind(console, "Connecting to " + peerAddress + ":" + peerPort);
  chrome.sockets.tcp.create(function(createInfo) {
    chrome.sockets.tcp.connect(createInfo.socketId, peerAddress, peerPort, function(result) {
      try {
        if (chrome.runtime.lastError) {
          logError(chrome.runtime.lastError.message);
          callback();
        } else if (result < 0) {
          callback();
        } else {
          callback(new TCP.Socket(createInfo.socketId, owner));
        }
      } catch (e) {
        logError(e.stack);
      }
    }.bind(this));
  });
};

TCP.Socket._dispatchReceive = function(receiveInfo) {
  var socket = TCP.Socket._registry[receiveInfo.socketId];
  if (socket) {
    try {
      socket._onReceive(receiveInfo.data);
    } catch (e) {
      socket._logError(e.stack);
    }
  } else {
    console.error('onReceive: unknown socket id ' + receiveInfo.socketId);
  }
};

TCP.Socket._dispatchReceiveError = function(receiveInfo) {
  var socket = TCP.Socket._registry[receiveInfo.socketId];
  if (socket) {
    try {
      socket._onReceiveError(receiveInfo.resultCode);
    } catch (e) {
      socket._logError(e.stack);
    }
  } else {
    console.error('onReceiveError: unknown socket id ' + receiveInfo.socketId);
  }
};

TCP.Socket.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._closing = true;

    TCP.Socket._unregister(this);
    this._onClose();
    chrome.sockets.tcp.close(this._id);
  },

  send: function(data) {
    chrome.sockets.tcp.send(this._id, data, function(sendInfo) {
      if (sendInfo.resultCode < 0) {
        this._logError('send error '+ sendInfo.resultCode);
      } else if (sendInfo.bytesSent != data.byteLength)
        this._logError('sent ' + sendInfo.bytesSent + ' out of ' + data.byteLength + ' bytes');
      else
        this._logDebug('sent ' + data.byteLength + ' bytes');
    }.bind(this));
  },

  _onClose: function() {
    if (this.onclose)
      this.onclose();
  },

  _onReceive: function(data) {
    this._logDebug('received ' + data.byteLength + ' bytes');
    if (this._closing)
      return;

    if (this.onmessage)
      this.onmessage(data);
  },

  _onReceiveError: function() {
    if (this._closing)
      return;
    this.close();
  }
};

TCP.Server = function(address, port, handlerClass, handlerContext) {
  this._address = address;
  this._port = port;
  this._handlerClass = handlerClass;
  this._handlerContext = handlerContext;

  var logPrefix = address + ":" + port;
  this._logInfo = console.info.bind(console, logPrefix);
  this._logError = console.error.bind(console, logPrefix);
  chrome.sockets.tcpServer.create(this._onCreate.bind(this));
};

TCP.Server.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._closing = true;
    if (this._socketId) {
      chrome.sockets.tcpServer.close(this._socketId);
      this._logInfo('Closed server socket ' + this._socketId);
    }
    if (this._onAcceptBound)
      chrome.sockets.tcpServer.onAccept.removeListener(this._onAcceptBound);

    TCP.Socket.getByOwner(this).forEach(function (socket) {
      socket.close();
    });
  },

  _onCreate: function(createInfo) {
    this._logInfo('Created server socket ' + createInfo.socketId);
    if (this._closing) {
      chrome.sockets.tcpServer.close(createInfo.socketId);
      this._logInfo('Closed server socket ' + createInfo.socketId);
      return;
    }
    this._socketId = createInfo.socketId;
    chrome.sockets.tcpServer.listen(
        this._socketId, this._address, this._port, this._onListen.bind(this));
  },

  _onListen: function(result) {
    if (result) {
      this._logError('Listen returned ' + result);
      return;
    }
    this._onAcceptBound = this._onAccept.bind(this);
    chrome.sockets.tcpServer.onAccept.addListener(this._onAcceptBound);
  },

  _onAccept: function(acceptInfo) {
    if (acceptInfo.socketId != this._socketId)
      return;
    var socket = new TCP.Socket(acceptInfo.clientSocketId, this);
    try {
      new this._handlerClass(this._handlerContext, socket);
    } catch (e) {
      socket._logError("Handler constructor failed", e.stack);
      socket.close();
      return;
    }
    chrome.sockets.tcp.setPaused(acceptInfo.clientSocketId, false, function() {});
  }
};
