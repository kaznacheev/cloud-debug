function SocketTunnel() {}

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

SocketTunnel.Base = function(transportSocket, logId) {
  Logger.install(this, SocketTunnel, logId);
  
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

  this.log('Open');
};

SocketTunnel.Base.prototype = {
  getStatus: function () {
    return this._status;
  },

  close: function () {
    this.log('Closed');
    delete this._transportSocket;
    for (var channelId in this._channelSockets)
      if (this._channelSockets.hasOwnProperty(channelId))
        this._channelSockets[channelId].close();
  },

  _closeChannel: function (channelId, notify) {
    var logger = this._createChannelLogger(channelId);
    logger.debug("closed");
    this._status.active--;
    if (notify)
      this._sendClose(channelId);
    if (this._channelSockets[channelId])
      delete this._channelSockets[channelId];
    else
      logger.error("does not exist (closing)");
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
    this._createChannelLogger(channelId).debug('disconnecting');
    this._send(channelId, SocketTunnel.PacketType.CLOSE);
  },

  _sendData: function (channelId, data) {
    this._createChannelLogger(channelId).debug('sent ' + data.byteLength + ' bytes');
    this._status.sent_bytes += data.byteLength;
    this._send(channelId, SocketTunnel.PacketType.DATA, new Uint8Array(data));
  },

  _createChannelLogger: function(channelId) {
    return Logger.append(this, "Channel " + channelId);
  }
};

SocketTunnel.Client = function(transportSocket, name) {
  SocketTunnel.Base.call(this, transportSocket, name);

  this._pendingOpen = {};
};

SocketTunnel.Client.prototype = {
  connect: function (socketName, channelId, callback) {
    var logger = this._createChannelLogger(channelId);
    if (!this._transportSocket || this._channelSockets[channelId] || this._pendingOpen[channelId]) {
      if (!this._transportSocket)
        logger.debug('connection refused (transport socket not connected)');
      else if (this._channelSockets[channelId])
        logger.error('already connected');
      else
        logger.error('already connecting');
      callback();
      return;
    }
    this._pendingOpen[channelId] = callback;

    logger.debug('connecting');
    this._send(channelId, SocketTunnel.PacketType.OPEN, ByteArray.fromString(socketName));
  },
  
  close: function() {
    SocketTunnel.Base.prototype.close.call(this);
    
    for (var channelId in this._pendingOpen)
      if (this._pendingOpen.hasOwnProperty(channelId))
        this._pendingOpen[channelId]();
  },

  _processPacket: function(channelId, packetType, payload) {
    var logger = this._createChannelLogger(channelId);

    var channelSocket = this._channelSockets[channelId];

    var openCallback = this._pendingOpen[channelId];
    if (openCallback)
      delete this._pendingOpen[channelId];

    switch (packetType) {
      case SocketTunnel.PacketType.OPEN:
        if (channelSocket) {
          logger.error('already exists (OPEN)');
        } else if (openCallback) {
          this._status.connected++;
          this._status.active++;
          logger.debug('connected');
          channelSocket = new SocketTunnel.Client.ChannelSocket();
          channelSocket.oncloseinternal = this._closeChannel.bind(this, channelId, true);
          channelSocket.send = this._sendData.bind(this, channelId);
          this._channelSockets[channelId] = channelSocket;
          openCallback(channelSocket);
        } else {
          logger.error('callback does not exist (OPEN');
        }
        break;
  
      case SocketTunnel.PacketType.REFUSE:
        this._status.refused++;
        if (openCallback) {
          logger.debug('connection refused');
          openCallback();
        } else {
          logger.error('callback does not exist (REFUSE)');
        }
        break;
  
      case SocketTunnel.PacketType.CLOSE:
        if (channelSocket) {
          logger.debug('closed by server');
          channelSocket.oncloseinternal = this._closeChannel.bind(this, channelId, false);
          channelSocket.close();
        } else {
          logger.error('does not exist (CLOSE');
        }
        break;
  
      case SocketTunnel.PacketType.DATA:
        if (channelSocket) {
          logger.debug('received ' + payload.byteLength + ' bytes');
          this._status.recv_bytes += payload.byteLength;
          channelSocket.receive(payload);
        } else {
          logger.error('does not exist (DATA)');
        }
        break;
  
      default:
        logger.error('received unknown packet type ' + packetType);
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
  SocketTunnel.Base.call(this, transportSocket, "Server");
  
  this._localSocketFactory = localSocketFactory;
};

SocketTunnel.Server.prototype = {
  _processPacket: function(channelId, packetType, payload) {
    var logger = this._createChannelLogger(channelId);

    var channelSocket = this._channelSockets[channelId];

    switch (packetType) {
      case SocketTunnel.PacketType.OPEN:
        if (channelSocket) {
          logger.error("already exists");
          return;
        }
        var socketName = ByteArray.toString(new Uint8Array(payload));
        this._localSocketFactory(socketName, channelId, function(socket) {
          if (socket) {
            logger.debug('connected');
            this._status.connected++;
            this._status.active++;
            this._channelSockets[channelId] = socket;
            socket.onclose = this._closeChannel.bind(this, channelId, true);
            socket.onmessage = this._sendData.bind(this, channelId);
            this._send(channelId, SocketTunnel.PacketType.OPEN);
          } else {
            logger.error('failed to connect to ' + socketName);
            this._status.refused++;
            this._send(channelId, SocketTunnel.PacketType.REFUSE);
          }
        }.bind(this));
        break;

      case SocketTunnel.PacketType.CLOSE:
        if (channelSocket) {
          logger.debug('closed by client');
          channelSocket.onclose = this._closeChannel.bind(this, channelId, false);
          channelSocket.close();
        } else {
          logger.error("does not exist (CLOSE)");
        }
        break;

      case SocketTunnel.PacketType.DATA:
        if (channelSocket) {
          logger.debug('received ' + payload.byteLength + ' bytes');
          this._status.recv_bytes += payload.byteLength;
          channelSocket.send(payload);
        } else {
          logger.error("does not exist (DATA)");
        }
        break;

      default:
        logger.error('received unknown packet type ' + packetType);
    }
  },

  __proto__: SocketTunnel.Base.prototype
};
