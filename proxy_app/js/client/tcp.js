var TCP = {};

TCP.Socket = function(id, opt_owner) {
  this._id = id;
  this._owner = opt_owner;
  TCP.Socket._register(this);
};

TCP.Socket._count = 0;

TCP.Socket._registry = {};

TCP.Socket._register = function(socket) {
  if (TCP.Socket._registry[socket._id]) {
    console.error('Socket already registered: ' + socket._id);
    return;
  }

  if (TCP.Socket._count++ == 0) {
    chrome.sockets.tcp.onReceive.addListener(TCP.Socket._dispatchReceive);
    chrome.sockets.tcp.onReceiveError.addListener(TCP.Socket._dispatchReceiveError);
  }

  TCP.Socket._registry[socket._id] = socket;
  console.debug("Created TCP socket " + socket._id + ", total: " + TCP.Socket._count);
};

TCP.Socket._unregister = function(socket) {
  if (!TCP.Socket._registry[socket._id]) {
    console.error('Socket not registered: ' + socket._id);
    return;
  }

  delete TCP.Socket._registry[socket._id];

  if (--TCP.Socket._count == 0) {
    chrome.sockets.tcp.onReceive.removeListener(TCP.Socket._dispatchReceive);
    chrome.sockets.tcp.onReceiveError.removeListener(TCP.Socket._dispatchReceiveError);
  }
  console.debug("Deleted TCP socket " + socket._id + ", total: " + TCP.Socket._count);
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
      try {
        if (result < 0)
          callback();
        else
          callback(new TCP.Socket(createInfo.socketId, owner));
      } catch (e) {
        console.error(e.stack);
      }
    });
  });
};

TCP.Socket._dispatchReceive = function(receiveInfo) {
  console.debug("Socket 'receive' event: id=" + receiveInfo.socketId + ", size=" + receiveInfo.data.byteLength);
  var socket = TCP.Socket._registry[receiveInfo.socketId];
  if (socket) {
    try {
      socket._onReceive(receiveInfo.data);
    } catch (e) {
      console.error(e.stack);
    }
  } else {
    console.error('onReceive: unknown socket id=' + receiveInfo.socketId);
  }
};

TCP.Socket._dispatchReceiveError = function(receiveInfo) {
  console.debug("Socket 'receiveError' event: id=" + receiveInfo.socketId + ", code=" + receiveInfo.resultCode);
  var socket = TCP.Socket._registry[receiveInfo.socketId];
  if (socket) {
    try {
      socket._onReceiveError(receiveInfo.resultCode);
    } catch (e) {
      console.error(e.stack);
    }
  } else {
    console.error('onReceiveError: unknown socket id=' + receiveInfo.socketId);
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
        console.error('Send error '+ sendInfo.resultCode + ' on ' + this._id);
      } else if (sendInfo.bytesSent != data.byteLength)
        console.error('Sent ' + sendInfo.bytesSent + ' out of ' + data.byteLength + ' bytes to ' + this._id);
      else
        console.debug('Sent ' + data.byteLength + ' bytes to ' + this._id);
    }.bind(this));
  },

  _onClose: function() {
    if (this.onclose)
      this.onclose();
  },

  _onReceive: function(data) {
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
  chrome.sockets.tcpServer.create(this._onCreate.bind(this));
};

TCP.Server.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._closing = true;
    if (this._socketId) {
      chrome.sockets.tcpServer.close(this._socketId);
      console.info('Closed server socket id=' + this._socketId);
    }
    if (this._onAcceptBound)
      chrome.sockets.tcpServer.onAccept.removeListener(this._onAcceptBound);

    TCP.Socket.getByOwner(this).forEach(function (socket) {
      socket.close();
    });
  },

  _onCreate: function(createInfo) {
    console.info('Created server socket id=' + createInfo.socketId);
    if (this._closing) {
      chrome.sockets.tcpServer.close(createInfo.socketId);
      console.info('Closed server socket id=' + createInfo.socketId);
      return;
    }
    this._socketId = createInfo.socketId;
    chrome.sockets.tcpServer.listen(
        this._socketId, this._address, this._port, this._onListen.bind(this));
  },

  _onListen: function(result) {
    if (result) {
      console.error('Listen returned ' + result);
      return;
    }
    this._onAcceptBound = this._onAccept.bind(this);
    chrome.sockets.tcpServer.onAccept.addListener(this._onAcceptBound);
  },

  _onAccept: function(acceptInfo) {
    if (acceptInfo.socketId != this._socketId)
      return;
    console.debug('Accepted connection on ' + acceptInfo.socketId + ' from ', acceptInfo.clientSocketId);
    var socket = new TCP.Socket(acceptInfo.clientSocketId, this);
    try {
      new this._handlerClass(this._handlerContext, socket);
    } catch (e) {
      console.error(e.stack);
      socket.close();
      return;
    }
    chrome.sockets.tcp.setPaused(acceptInfo.clientSocketId, false, function() {});
  }
};
