var ProxyDevice = {};

ProxyDevice.start = function(socketList, localSocketFactory, callback) {
  ProxyDevice._socketList = socketList;

  Device.start(
      ProxyDevice.handleCommand,
      ProxyDevice.getDeviceState,
      function() {
        var tunnelHandler = new TunnelHandler(localSocketFactory);
        ProxyDevice._signalingHandler = new WebRTCServerSocket.SignalingHandler();
        ProxyDevice._signalingHandler.onaccept = tunnelHandler.openTunnel.bind(tunnelHandler);
        ProxyDevice._signalingHandler.onclose = tunnelHandler.closeTunnel.bind(tunnelHandler);
        console.log("Started proxy device");
        callback(true);
      },
      function() {
        console.error("Could not start proxy device");
        callback(false);
      });
};

ProxyDevice.stop = function() {
  Device.stop();
  ProxyDevice._signalingHandler.stop();
  delete ProxyDevice._signalingHandler;
};

ProxyDevice.getDeviceState = function() {
  var state = {
    "sockets": ProxyDevice._socketList
  };
  if (ProxyDevice._signalingHandler.hasPendingSignaling())
    state.hasPendingSignaling = "true";
  return state;
};

ProxyDevice.handleCommand = function(name, parameters, patchResultsFunc) {
  if (name != "base._connect") {
    console.error("Unknown device command: " + name);
    return;
  }

  ProxyDevice._signalingHandler.processIncoming(
      parameters._message,
      function(messageObject) {
        patchResultsFunc({
          '_response': JSON.stringify(messageObject)
        });
      });
};

function TunnelHandler(localSocketFactory) {
  this._localSocketFactory = localSocketFactory;
  this._localSockets = {};
}

TunnelHandler.debug = false;

TunnelHandler.prototype = {
  openTunnel: function(tunnel) {
    this._tunnel = tunnel;
    this._tunnel.onmessage = this._onTunnelMessage.bind(this);
  },
  
  closeTunnel: function() {
    delete this._tunnel;
    for (var clientId in this._localSockets)
      if (this._localSockets.hasOwnProperty(clientId))
        this._localSockets[clientId].close();
  },
  
  _onTunnelMessage: function(buffer) {
    var clientId = DeviceConnector.Connection.parseClientId(buffer);

    var logPrefix = 'Local socket ' + clientId;
    var logError = console.error.bind(console, logPrefix);

    var logDebug;
    if (TunnelHandler.debug)
      logDebug = console.debug.bind(console, logPrefix);
    else
      logDebug = function() {};

    var type = DeviceConnector.Connection.parsePacketType(buffer);
  
    var localSocket = this._localSockets[clientId];
  
    switch (type) {
      case DeviceConnector.Connection.OPEN:
        if (localSocket) {
          logError("already exists");
          return;
        }
        var socketName = Uint8ArrayToString(new Uint8Array(DeviceConnector.Connection.parsePacketPayload(buffer)));
        this._localSocketFactory(socketName, function(socket) {
          if (socket) {
            logDebug('connected');
            this._sendToTunnel(clientId, DeviceConnector.Connection.OPEN);
            this._localSockets[clientId] = socket;
            socket.onclose = this._onLocalSocketClosedItself.bind(this, clientId);
            socket.onmessage = this._onLocalSocketMessage.bind(this, clientId);
          } else {
            logError('failed to connect to ' + socketName);
            this._sendToTunnel(clientId, DeviceConnector.Connection.OPEN_FAIL);
          }
        }.bind(this));
        break;
  
      case DeviceConnector.Connection.CLOSE:
        if (localSocket) {
          logDebug('closed by client');
          localSocket.onclose = this._onLocalSocketClosed.bind(this, clientId);
          localSocket.close();
        } else {
          logError("does not exist (CLOSE)");
        }
        break;
  
      case DeviceConnector.Connection.DATA:
        if (localSocket) {
          logDebug('received ' + buffer.byteLength + ' bytes from client');
          localSocket.send(DeviceConnector.Connection.parsePacketPayload(buffer));
        } else {
          logError("does not exist (DATA)");
        }
        break;
  
      default:
        logError(' received unknown packet type ' + type);
    }
  },

  _sendToTunnel: function(clientId, type, opt_payload) {
    if (!this._tunnel)
      return;
    this._tunnel.send(DeviceConnector.Connection.buildPacket(clientId, type, opt_payload));
  },

  _onLocalSocketClosed: function(clientId) {
    delete this._localSockets[clientId];
  },

  _onLocalSocketClosedItself: function(clientId) {
    this._sendToTunnel(clientId, DeviceConnector.Connection.CLOSE);
    this._onLocalSocketClosed(clientId);
  },

  _onLocalSocketMessage: function(clientId, data) {
    if (TunnelHandler.debug)
      console.debug('Local socket ' + clientId + ' sent ' + data.byteLength + ' bytes to client');
    this._sendToTunnel(clientId, DeviceConnector.Connection.DATA, data);
  }
};
