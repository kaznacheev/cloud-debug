var TestDevice = {};

TestDevice.SOCKET_LIST = "chrome_devtools_remote_9222";

TestDevice.start = function() {
  TestDevice._localSockets = {};

  TestDevice._signalingHandler = new WebRTCServerSocket.SignalingHandler();
  TestDevice._tunnelHandler = new TunnelHandler(TestDevice._signalingHandler);
  
  Device.start(
      TestDevice.handleCommand,
      TestDevice.getDeviceState,
      function() { console.log('Initialized test device'); },
      function() { console.error('Cannot initialize test device'); });
};

TestDevice.stop = function() {
  Device.stop();
  TestDevice._signalingHandler.stop();
};

TestDevice.getDeviceState = function() {
  var state = {
    "sockets": TestDevice.SOCKET_LIST
  };
  if (TestDevice._signalingHandler.hasPendingSignaling())
    state.hasPendingSignaling = "true";
  return state;
};

TestDevice.handleCommand = function(name, parameters, patchResultsFunc) {
  if (name != "base._connect") {
    console.error("Unknown device command: " + name);
    return;
  }

  TestDevice._signalingHandler.processIncoming(
      parameters._message,
      function(messageObject) {
        patchResultsFunc({
          '_response': JSON.stringify(messageObject)
        });
      });
};

function TunnelHandler(serverSignalingHandler) {
  serverSignalingHandler.onaccept = this._onTunnelCreated.bind(this);
  serverSignalingHandler.onclose = this._onTunnelClosed.bind(this);

  this._localSockets = {};
}

TunnelHandler.debug = false;

TunnelHandler.prototype = {
  _onTunnelCreated: function(tunnel) {
    this._tunnel = tunnel;
    this._tunnel.onmessage = this._onTunnelMessage.bind(this);
  },
  
  _onTunnelClosed: function() {
    delete this._tunnel;
    TCP.Socket.getByOwner(this).forEach(function(socket) {
      socket.close();
    });
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
        var port;
        try {
          port = parseInt(socketName.match('\\d+$')[0]);
        } catch (e) {
          logError('failed to connect, invalid socket name: ' + socketName);
          this._sendToTunnel(clientId, DeviceConnector.Connection.OPEN_FAIL);
          return;
        }
        TCP.Socket.connect("127.0.0.1", port, this, function(socket) {
          if (socket) {
            logDebug('connected');
            this._sendToTunnel(clientId, DeviceConnector.Connection.OPEN);
            this._localSockets[clientId] = socket;
            socket.onclose = this._onLocalSocketClosedItself.bind(this, clientId);
            socket.onmessage = this._onLocalSocketMessage.bind(this, clientId);
          } else {
            logError('failed to connect');
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
