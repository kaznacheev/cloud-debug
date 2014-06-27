function DeviceConnector(updateDashboard) {
  this._updateDashboard = updateDashboard;
  this._connections = {};

  var xhr = new XMLHttpRequest();
  xhr.open("GET", DeviceConnector.ICE_CONFIG_URL);
  xhr.onload = XHR._parseJSONResponse.bind(
      null,
      xhr,
      this._start.bind(this),
      this._start.bind(this, null));
  xhr.send();
}

DeviceConnector.debug = false;

DeviceConnector.ICE_CONFIG_URL = "http://computeengineondemand.appspot.com/turn?username=28230128&key=4080218913";

DeviceConnector.prototype = {
  _start: function(turnServerConfig) {
    this._iceServersConfig = {
      iceServers: [
        {urls: "stun:stun.l.google.com:19302"}
      ]
    };
    if (turnServerConfig) {
      this._iceServersConfig.iceServers.push({
        urls: turnServerConfig.uris,
        username: turnServerConfig.username,
        credential: turnServerConfig.password
      });
    }
    console.log('Started device connector, ICE config:', JSON.stringify(this._iceServersConfig));
    this._active = true;
    this._queryDevices();
  },
  
  stop: function() {
    console.log('Stopped device connector');
    delete this._active;
    if (this._timeout)
      clearTimeout(this._timeout);

    this.getDeviceIds().forEach(function(id) {
      this._connections[id].close();
    }.bind(this));
  },

  getDeviceIds: function () {
    var ids = [];
    for (var id in this._connections)
      if (this._connections.hasOwnProperty(id))
        ids.push(id);
    return ids;
  },

  getDeviceConnection: function (id) {
    return this._connections[id];
  },

  _queryDevices: function() {
    User.requestDevices(this._receivedDevices.bind(this));
  },

  _receivedDevices: function(response) {
    if (!this._active)
      return;

    var oldDeviceIds = this.getDeviceIds();
    var newDeviceIds = [];

    if (response.devices) {
      response.devices.forEach(function(deviceResource) {
        var id = deviceResource.id;
        newDeviceIds.push(id);
        if (this._connections[id]) {
          this._connections[id].update(deviceResource);
        } else {
          new DeviceConnector.Connection(this._connections, deviceResource, this._iceServersConfig);
        }
      }.bind(this));
    }

    oldDeviceIds.forEach(function(id) {
      if (newDeviceIds.indexOf(id) < 0) {
        this._connections[id].close();
      }
    }.bind(this));

    this._timeout = setTimeout(this._queryDevices.bind(this), 1000);
    this._updateDashboard();
  }
};

DeviceConnector.Connection = function(registry, resource, iceServersConfig) {
  this._registry = registry;
  this._id = resource.id;
  this._displayName = resource.displayName;

  var logPrefix = "Connection to " + this._displayName + ":";
  this._logInfo = console.info.bind(console, logPrefix);
  this._logError = console.error.bind(console, logPrefix);
  if (DeviceConnector.debug)
    this._logDebug = console.debug.bind(console, logPrefix);
  else
    this._logDebug = function() {};

  if (this._registry[this._id]) {
    this._logError('Connection already exists');
    return;
  }

  this._registry[this._id] = this;

  this._webrtcConnection = new WebRTCClientSocket('WebRTC connection to ' + this._displayName);
  this._webrtcConnection.onopen = this._onConnectionOpen.bind(this);
  this._webrtcConnection.onmessage = this._onConnectionMessage.bind(this);
  this._webrtcConnection.onclose = this.close.bind(this);
  
  this._signalingHandler = new WebRTCClientSocket.SignalingHandler(
      this._webrtcConnection, this._exchangeSignaling.bind(this));

  this._webrtcConnection.connect(iceServersConfig);
  
  this._pendingOpen = {};
  this._tunnels = {};

  this._sockets = [];

  this._status = {};

  this.update(resource);
};

DeviceConnector.Connection.OPEN = 1;
DeviceConnector.Connection.OPEN_FAIL = 2;
DeviceConnector.Connection.CLOSE = 3;
DeviceConnector.Connection.DATA = 4;

DeviceConnector.Connection.CLIENT_ID_OFFSET = 0;
DeviceConnector.Connection.CLIENT_ID_SIZE = 4;

DeviceConnector.Connection.PACKET_TYPE_OFFSET = DeviceConnector.Connection.CLIENT_ID_SIZE;
DeviceConnector.Connection.PACKET_TYPE_SIZE = 1;

DeviceConnector.Connection.PAYLOAD_OFFSET =
    DeviceConnector.Connection.CLIENT_ID_SIZE +
    DeviceConnector.Connection.PACKET_TYPE_SIZE;

DeviceConnector.Connection.buildPacket = function(clientId, type, opt_data) {
  var bufferSize = DeviceConnector.Connection.PAYLOAD_OFFSET;
  if (opt_data) {
    if (typeof opt_data === 'string')
      bufferSize += opt_data.length;
    else
      bufferSize += opt_data.byteLength;
  }

  var bytes = new Uint8Array(bufferSize);
  (new Uint32Array(bytes.buffer, DeviceConnector.Connection.CLIENT_ID_OFFSET, 1))[0] = clientId;
  bytes[DeviceConnector.Connection.PACKET_TYPE_OFFSET] = type;

  if (opt_data) {
    var payload;
    if (typeof opt_data == 'string')
      payload = stringToUint8Array(opt_data);
    else
      payload = new Uint8Array(opt_data);
    bytes.set(payload, DeviceConnector.Connection.PAYLOAD_OFFSET);
  }

  return bytes.buffer;
};

DeviceConnector.Connection.parseClientId = function(buffer) {
  return (new Uint32Array(buffer, DeviceConnector.Connection.CLIENT_ID_OFFSET, 1))[0];
};

DeviceConnector.Connection.parsePacketType = function(buffer) {
  return (new Uint8Array(buffer, DeviceConnector.Connection.PACKET_TYPE_OFFSET, 1))[0];
};

DeviceConnector.Connection.parsePacketPayload = function(buffer) {
  return buffer.slice(DeviceConnector.Connection.PAYLOAD_OFFSET);
};

DeviceConnector.Connection.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._logInfo('Device connection closed');
    this._closing = true;
    this._connected = false;

    if (!this._registry[this._id]) {
      this._logError('Connection does not exist');
      return;
    }
    delete this._registry[this._id];
    this._webrtcConnection.close();
    this._signalingHandler.sendCloseSignal();
  },

  isConnected: function () {
    return this._connected;
  },

  getDeviceName: function () {
    return this._displayName;
  },

  getScreenSize: function () {
    return "";
  },

  getSockets: function() {
    return this._sockets;
  },

  connect: function (socketName, clientId, callback) {
    if (!this._connected || this._tunnels[clientId] || this._pendingOpen[clientId]) {
      var message = 'Tunnel ' + clientId + ' failed to connect';
      if (!this._connected)
        this._logDebug(message + ', WebRTC not connected');
      else if (this._tunnels[clientId])
        this._logError(message + ', already connected');
      else
        this._logError(message + ', already connecting');
      callback();
      return;
    }
    this._pendingOpen[clientId] = callback;
    this._sendOpen(clientId, socketName);
  },

  update: function(resource) {
    var vendorState = {};
    try {
      resource.state.base.vendorState.value.forEach(function(item) {
        vendorState[item.name] = item.stringValue;
      });
    } catch(e) {
    }
    this._sockets = (vendorState.sockets || '').split(',');
    if (vendorState.hasPendingSignaling)
      this._signalingHandler.poll();
  },

  getStatus: function() {
    var result = {};
    function mergeMap(to, from) {
      for (var key in from)
        if (from.hasOwnProperty(key))
          to[key] = from[key];
    }
    mergeMap(result, this._webrtcConnection.getStatus());
    mergeMap(result, this._status);
    return result;
  },

  _sendOpen: function(clientId, socketName) {
    this._logDebug('Tunnel ' + clientId + ' connecting');
    this._send(clientId, DeviceConnector.Connection.OPEN, socketName);
  },

  _sendClose: function(clientId) {
    this._logDebug('Tunnel ' + clientId + ' disconnecting');
    this._send(clientId, DeviceConnector.Connection.CLOSE);
  },

  _sendData: function(clientId, data) {
    this._logDebug('Tunnel ' + clientId + ' sent ' + data.byteLength + ' bytes');
    this._send(clientId, DeviceConnector.Connection.DATA, data);
  },

  _exchangeSignaling: function(message, successCallback, errorCallback) {
    var reportError = function(status) {
      this._logError("GCD error " + status);
      this._status.gcd = status;
      if (errorCallback)
        errorCallback(status);
    }.bind(this);

    User.sendCommand(
        this._id,
        "base._connect",
        {
          '_message': message
        },
        function(response) {
          if (response.state != "done") {
            reportError("state=" + response.state)
          } else if (!response.results) {
            reportError("bad response")
          } else if (successCallback) {
            this._status.gcd = 'OK';
            successCallback(response.results._response);
          }
        }.bind(this),
        function(status) {
          reportError("HTTP " + status);
        });
  },

  _onConnectionOpen: function() {
    this._logInfo('Device connection open');
    this._connected = true;
    this._status.connected = 0;
    this._status.refused = 0;
  },

  _onConnectionMessage: function(buffer) {
    var clientId = DeviceConnector.Connection.parseClientId(buffer);
    var type = DeviceConnector.Connection.parsePacketType(buffer);

    var tunnel = this._tunnels[clientId];

    var openCallback = this._pendingOpen[clientId];
    if (openCallback)
      delete this._pendingOpen[clientId];

    var logPrefix = "Tunnel " + clientId;
    var logError = this._logError.bind(null, logPrefix);
    var logDebug = this._logDebug.bind(null, logPrefix);

    switch (type) {
      case DeviceConnector.Connection.OPEN:
        if (tunnel) {
          logError('already exists (OPEN)');
        } else  if (openCallback) {
          this._status.connected++;
          logDebug('created');
          tunnel = new DeviceConnector.Connection.Tunnel();
          tunnel.oncloseinternal = this._onTunnelClosedByClient.bind(this, clientId);
          tunnel.send = this._sendData.bind(this, clientId);
          this._tunnels[clientId] = tunnel;
          openCallback(tunnel);
        } else {
          logError('does not exist (OPEN');
        }
        break;
      
      case DeviceConnector.Connection.OPEN_FAIL:
        this._status.refused++;
        if (openCallback) {
          logDebug('failed to connect');
          openCallback();
        } else {
          logError('callback does not exist (OPEN_FAIL)');
        }
        break;

      case DeviceConnector.Connection.CLOSE:
        if (tunnel) {
          logDebug('closed by server');
          tunnel.oncloseinternal = this._onTunnelClosed.bind(this, clientId);
          tunnel.close();
        } else {
          logError('does not exist (CLOSE');
        }
        break;
        
      case DeviceConnector.Connection.DATA:
        if (tunnel) {
          logDebug('received ' + buffer.byteLength + ' bytes');
          tunnel.receive(DeviceConnector.Connection.parsePacketPayload(buffer));
        } else {
          logError('does not exist (DATA)');
        }
        break;
        
      default:
        logError('received unknown packet type ' + type);
    }
  },
  
  _send: function(clientId, type, opt_data) {
    this._webrtcConnection.send(DeviceConnector.Connection.buildPacket(clientId, type, opt_data));
  },

  _onTunnelClosed: function(clientId) {
    if (this._tunnels[clientId])
      delete this._tunnels[clientId];
    else
      this._logError("Tunnel " + clientId + " does not exist (closing)");
  },

  _onTunnelClosedByClient: function(clientId) {
    this._logDebug("Tunnel " + clientId + " closed by client");
    this._sendClose(clientId);
    this._onTunnelClosed(clientId);
  }
};

DeviceConnector.Connection.Tunnel = function() {};

DeviceConnector.Connection.Tunnel.prototype = {
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

