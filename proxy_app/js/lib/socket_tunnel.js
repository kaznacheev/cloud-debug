var SocketTunnel = {};

SocketTunnel.debug = false;

SocketTunnel.PacketType = {
  OPEN: 1,
  REFUSE: 2,
  CLOSE: 3,
  DATA: 4
};

SocketTunnel.CHANNEL_ID_OFFSET = 0;
SocketTunnel.CHANNEL_ID_SIZE = 4;

SocketTunnel.PACKET_TYPE_OFFSET = SocketTunnel.CHANNEL_ID_SIZE;
SocketTunnel.PACKET_TYPE_SIZE = 1;

SocketTunnel.PAYLOAD_OFFSET = SocketTunnel.PACKET_TYPE_OFFSET + SocketTunnel.PACKET_TYPE_SIZE;

SocketTunnel.Base = function(transportSocket, logPrefix) {
  this._transportSocket = transportSocket;
  this._transportSocket.onmessage = this._onTunnelMessage.bind(this);

  this._channelSockets = {};

  this._status = {
    connected: 0,
    refused: 0,
    active: 0,
    sent_pckts: 0,
    recv_pckts: 0,
    sent_bytes: 0,
    recv_bytes: 0
  };

  this._logError = console.error.bind(console, logPrefix);
  if (SocketTunnel.debug)
    this._logDebug = console.debug.bind(console, logPrefix);
  else
    this._logDebug = function() {};

  this._logDebug('created');
};

SocketTunnel.Base.prototype = {
  getStatus: function () {
    return this._status;
  },

  close: function () {
    this._logDebug('closed');
    delete this._transportSocket;
    for (var channelId in this._channelSockets)
      if (this._channelSockets.hasOwnProperty(channelId))
        this._channelSockets[channelId].close();
  },

  _closeChannel: function (channelId, notify) {
    this._logDebug("Channel " + channelId + " closed");
    this._status.active--;
    if (notify)
      this._sendClose(channelId);
    if (this._channelSockets[channelId])
      delete this._channelSockets[channelId];
    else
      this._logError("Channel " + channelId + " does not exist (closing)");
  },

  _onTunnelMessage: function (buffer) {
    if (!this._transportSocket)
      return;
    this._status.recv_pckts++;

    this._processPacket(
        (new Uint32Array(buffer, SocketTunnel.CHANNEL_ID_OFFSET, 1))[0],
        (new Uint8Array(buffer, SocketTunnel.PACKET_TYPE_OFFSET, 1))[0],
        buffer.slice(SocketTunnel.PAYLOAD_OFFSET));
  },

  _send: function (channelId, type, opt_data) {
    if (!this._transportSocket)
      return;
    this._status.sent_pckts++;

    var bufferSize = SocketTunnel.PAYLOAD_OFFSET;
    if (opt_data) {
      bufferSize += opt_data.length;
      this._status.sent_bytes += opt_data.length;
    }

    var bytes = new Uint8Array(bufferSize);
    (new Uint32Array(bytes.buffer, SocketTunnel.CHANNEL_ID_OFFSET, 1))[0] = channelId;
    bytes[SocketTunnel.PACKET_TYPE_OFFSET] = type;
    if (opt_data)
      bytes.set(opt_data, SocketTunnel.PAYLOAD_OFFSET);

    this._transportSocket.send(bytes.buffer);
  },

  _sendClose: function (channelId) {
    this._logDebug('Channel ' + channelId + ' disconnecting');
    this._send(channelId, SocketTunnel.PacketType.CLOSE);
  },

  _sendData: function (channelId, data) {
    this._logDebug('Channel ' + channelId + ' sent ' + data.byteLength + ' bytes');
    this._status.sent_bytes += data.byteLength;
    this._send(channelId, SocketTunnel.PacketType.DATA, new Uint8Array(data));
  }
};

SocketTunnel.Client = function(transportSocket, name) {
  SocketTunnel.Base.call(this, transportSocket, "SocketTunnel.Client " + name + ":");

  this._pendingOpen = {};
};

SocketTunnel.Client.prototype = {
  connect: function (socketName, channelId, callback) {
    if (!this._transportSocket || this._channelSockets[channelId] || this._pendingOpen[channelId]) {
      var message = 'Channel ' + channelId + ' could not connect';
      if (!this._transportSocket)
        this._logDebug(message + ', transport socket not connected');
      else if (this._channelSockets[channelId])
        this._logError(message + ', already connected');
      else
        this._logError(message + ', already connecting');
      callback();
      return;
    }
    this._pendingOpen[channelId] = callback;

    this._logDebug('Channel ' + channelId + ' connecting');
    this._send(channelId, SocketTunnel.PacketType.OPEN, ByteArray.fromString(socketName));
  },
  
  close: function() {
    SocketTunnel.Base.prototype.close.call(this);
    
    for (var channelId in this._pendingOpen)
      if (this._pendingOpen.hasOwnProperty(channelId))
        this._pendingOpen[channelId]();
  },

  _processPacket: function(channelId, packetType, payload) {
    var logPrefix = "Channel " + channelId;
    var logError = this._logError.bind(null, logPrefix);
    var logDebug = this._logDebug.bind(null, logPrefix);

    var channelSocket = this._channelSockets[channelId];

    var openCallback = this._pendingOpen[channelId];
    if (openCallback)
      delete this._pendingOpen[channelId];

    switch (packetType) {
      case SocketTunnel.PacketType.OPEN:
        if (channelSocket) {
          logError('already exists (OPEN)');
        } else if (openCallback) {
          this._status.connected++;
          this._status.active++;
          logDebug('connected');
          channelSocket = new SocketTunnel.Client.ChannelSocket();
          channelSocket.oncloseinternal = this._closeChannel.bind(this, channelId, true);
          channelSocket.send = this._sendData.bind(this, channelId);
          this._channelSockets[channelId] = channelSocket;
          openCallback(channelSocket);
        } else {
          logError('callback does not exist (OPEN');
        }
        break;
  
      case SocketTunnel.PacketType.REFUSE:
        this._status.refused++;
        if (openCallback) {
          logDebug('connection refused');
          openCallback();
        } else {
          logError('callback does not exist (REFUSE)');
        }
        break;
  
      case SocketTunnel.PacketType.CLOSE:
        if (channelSocket) {
          logDebug('closed by server');
          channelSocket.oncloseinternal = this._closeChannel.bind(this, channelId, false);
          channelSocket.close();
        } else {
          logError('does not exist (CLOSE');
        }
        break;
  
      case SocketTunnel.PacketType.DATA:
        if (channelSocket) {
          logDebug('received ' + payload.byteLength + ' bytes');
          this._status.recv_bytes += payload.byteLength;
          channelSocket.receive(payload);
        } else {
          logError('does not exist (DATA)');
        }
        break;
  
      default:
        logError('received unknown packet type ' + packetType);
    }
  },
  
  __proto__: SocketTunnel.Base.prototype
};

SocketTunnel.Client.ChannelSocket = function() {};

SocketTunnel.Client.ChannelSocket.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._closing = true;
    if (this.onclose)
      this.onclose();
    if (this.oncloseinternal)
      this.oncloseinternal();
  },

  receive: function(data) {
    if (this.onmessage)
      this.onmessage(data);
  }
};


SocketTunnel.Server = function(transportSocket, localSocketFactory, name) {
  SocketTunnel.Base.call(this, transportSocket, "SocketTunnel.Server " + name + ":");
  
  this._localSocketFactory = localSocketFactory;
};

SocketTunnel.Server.prototype = {
  _processPacket: function(channelId, packetType, payload) {
    var logPrefix = "Channel " + channelId;
    var logError = this._logError.bind(null, logPrefix);
    var logDebug = this._logDebug.bind(null, logPrefix);

    var channelSocket = this._channelSockets[channelId];

    switch (packetType) {
      case SocketTunnel.PacketType.OPEN:
        if (channelSocket) {
          logError("already exists");
          return;
        }
        var socketName = ByteArray.toString(new Uint8Array(payload));
        this._localSocketFactory(socketName, function(socket) {
          if (socket) {
            logDebug('connected');
            this._status.connected++;
            this._status.active++;
            this._channelSockets[channelId] = socket;
            socket.onclose = this._closeChannel.bind(this, channelId, true);
            socket.onmessage = this._sendData.bind(this, channelId);
            this._send(channelId, SocketTunnel.PacketType.OPEN);
          } else {
            logError('failed to connect to ' + socketName);
            this._status.refused++;
            this._send(channelId, SocketTunnel.PacketType.REFUSE);
          }
        }.bind(this));
        break;

      case SocketTunnel.PacketType.CLOSE:
        if (channelSocket) {
          logDebug('closed by client');
          channelSocket.onclose = this._closeChannel.bind(this, channelId, false);
          channelSocket.close();
        } else {
          logError("does not exist (CLOSE)");
        }
        break;

      case SocketTunnel.PacketType.DATA:
        if (channelSocket) {
          logDebug('received ' + payload.byteLength + ' bytes');
          this._status.recv_bytes += payload.byteLength;
          channelSocket.send(payload);
        } else {
          logError("does not exist (DATA)");
        }
        break;

      default:
        logError('received unknown packet type ' + packetType);
    }
  },

  __proto__: SocketTunnel.Base.prototype
};
