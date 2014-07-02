var TCP = {};

TCP.debug = false;

TCP.Socket = function(id, opt_owner) {
  this._id = id;
  this._owner = opt_owner;

  Logger.install(this, "TCP.Socket", this._id);
  
  TCP.Socket._register(this);
};

TCP.Socket._count = 0;

TCP.Socket._registry = {};

TCP.Socket._register = function(socket) {
  if (TCP.Socket._registry[socket._id]) {
    socket.error('Already registered');
    return;
  }

  if (TCP.Socket._count++ == 0) {
    chrome.sockets.tcp.onReceive.addListener(TCP.Socket._dispatchReceive);
    chrome.sockets.tcp.onReceiveError.addListener(TCP.Socket._dispatchReceiveError);
  }

  TCP.Socket._registry[socket._id] = socket;
  socket.debug("Created, total: " + TCP.Socket._count);
};

TCP.Socket._unregister = function(socket) {
  if (!TCP.Socket._registry[socket._id]) {
    socket.error('Not registered');
    return;
  }

  delete TCP.Socket._registry[socket._id];

  if (--TCP.Socket._count == 0) {
    chrome.sockets.tcp.onReceive.removeListener(TCP.Socket._dispatchReceive);
    chrome.sockets.tcp.onReceiveError.removeListener(TCP.Socket._dispatchReceiveError);
  }
  socket.debug("Deleted, total: " + TCP.Socket._count);
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
  chrome.sockets.tcp.create(function(createInfo) {
    chrome.sockets.tcp.connect(createInfo.socketId, peerAddress, peerPort, function(result) {
      var logger = Logger.create("TCP.Socket",  peerAddress + ":" + peerPort);
      try {
        if (chrome.runtime.lastError) {
          logger.error(TCP.Socket, context, chrome.runtime.lastError.message);
          callback();
        } else if (result < 0) {
          callback();
        } else {
          callback(new TCP.Socket(createInfo.socketId, owner));
        }
      } catch (e) {
        logger.error(TCP.Socket, e.stack);
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
      socket.error(e.stack);
    }
  } else {
    Logger.create("TCP.Socket", receiveInfo.socketId).error("onReceive: unknown socket");
  }
};

TCP.Socket._dispatchReceiveError = function(receiveInfo) {
  var socket = TCP.Socket._registry[receiveInfo.socketId];
  if (socket) {
    try {
      socket._onReceiveError(receiveInfo.resultCode);
    } catch (e) {
      socket.error(e.stack);
    }
  } else {
    Logger.create("TCP.Socket", receiveInfo.socketId).error("onReceiveError: unknown socket");
  }
};

TCP.Socket.prototype = {
  getId: function() {
    return this._id;
  },

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
      if (sendInfo.resultCode < 0)
        this.error('Send error '+ sendInfo.resultCode);
      else if (sendInfo.bytesSent != data.byteLength)
        this.error('Sent ' + sendInfo.bytesSent + ' out of ' + data.byteLength + ' bytes');
      else
        this.debug('Sent ' + data.byteLength + ' bytes');
    }.bind(this));
  },

  _onClose: function() {
    if (this.onclose)
      this.onclose();
  },

  _onReceive: function(data) {
    this.debug('Received ' + data.byteLength + ' bytes');
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

TCP.Server = function(address, port, handler) {
  this._address = address;
  this._port = port;
  this._handler = handler;

  Logger.install(this, "TCP.Server", address + ":" + port);

  chrome.sockets.tcpServer.create(this._onCreate.bind(this));
};

TCP.Server.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._closing = true;
    if (this._socketId) {
      chrome.sockets.tcpServer.close(this._socketId);
      this.log('Closed server socket ' + this._socketId);
    }
    if (this._onAcceptBound)
      chrome.sockets.tcpServer.onAccept.removeListener(this._onAcceptBound);

    TCP.Socket.getByOwner(this).forEach(function (socket) {
      socket.close();
    });
  },

  _onCreate: function(createInfo) {
    this.log('Created server socket ' + createInfo.socketId);
    if (this._closing) {
      chrome.sockets.tcpServer.close(createInfo.socketId);
      this.log('Closed server socket ' + createInfo.socketId);
      return;
    }
    this._socketId = createInfo.socketId;
    chrome.sockets.tcpServer.listen(
        this._socketId, this._address, this._port, this._onListen.bind(this));
  },

  _onListen: function(result) {
    if (result) {
      this.error('Listen returned ' + result);
      return;
    }
    this.debug('Listening');
    this._onAcceptBound = this._onAccept.bind(this);
    chrome.sockets.tcpServer.onAccept.addListener(this._onAcceptBound);
  },

  _onAccept: function(acceptInfo) {
    if (acceptInfo.socketId != this._socketId)
      return;
    this.debug("Accepted", acceptInfo.clientSocketId);
    var socket = new TCP.Socket(acceptInfo.clientSocketId, this);
    try {
      this._handler(socket);
    } catch (e) {
      socket.error("Accept handler failed", e.stack);
      socket.close();
      return;
    }
    if (!socket._closing)
      chrome.sockets.tcp.setPaused(acceptInfo.clientSocketId, false, function() {});
  }
};
