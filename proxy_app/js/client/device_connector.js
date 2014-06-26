function DeviceConnector() {
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
    console.log('Started device connector with ICE config:', JSON.stringify(this._iceServersConfig));
    this._queryDevices();
  },
  
  stop: function() {
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
    var devicesResource = response.devices || [];

    var newDeviceIds = devicesResource.map(function(deviceResource) {
      return deviceResource.id;
    });

    var oldDeviceIds = this.getDeviceIds();

    newDeviceIds.forEach(function(id) {
      if (oldDeviceIds.indexOf(id) < 0) {
        new DeviceConnector.Connection(this._connections, id, this._iceServersConfig);
      }
    }.bind(this));

    oldDeviceIds.forEach(function(id) {
      if (newDeviceIds.indexOf(id) < 0) {
        this._connections[id].close();
      }
    }.bind(this));

    devicesResource.forEach(function(deviceResource) {
      this._connections[deviceResource.id].update(deviceResource);
    }.bind(this));

    this._timeout = setTimeout(this._queryDevices.bind(this), 1000);
  }
};

DeviceConnector.Connection = function(registry, id, iceServersConfig) {
  this._registry = registry;
  this._id = id;

  this._logInfo = console.info.bind(console, this._id);
  this._logError = console.error.bind(console, this._id);

  if (this._registry[this._id]) {
    this._logError('Connection already exists');
    return;
  }

  this._registry[this._id] = this;

  this._webrtcConnection = new WebRTCClientSocket('');
  this._webrtcConnection.onopen = this._onConnectionOpen.bind(this);
  this._webrtcConnection.onmessage = this._onConnectionMessage.bind(this);
  this._webrtcConnection.onclose = this.close.bind(this);
  
  this._signalingHandler = new WebRTCClientSocket.SignalingHandler(
      this._webrtcConnection, this._exchangeSignaling.bind(this));

  this._webrtcConnection.connect(iceServersConfig);
  
  this._pendingOpen = {};
  this._tunnels = {};

  this._sockets = [];
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
    return this._resource.displayName;
  },

  getScreenSize: function () {
    return "";
  },

  getSockets: function() {
    return this._sockets;
  },

  connect: function (socketName, clientId, callback) {
    if (!this._connected || this._tunnels[clientId] || this._pendingOpen[clientId]) {
      callback();
      return;
    }
    this._pendingOpen[clientId] = callback;
    this.sendOpen(clientId, socketName);
  },

  update: function(resource) {
    this._resource = resource;
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

  sendOpen: function(clientId, socketName) {
    this._send(clientId, DeviceConnector.Connection.OPEN, socketName);
  },

  sendClose: function(clientId) {
    this._send(clientId, DeviceConnector.Connection.CLOSE);
  },

  sendData: function(clientId, data) {
    this._send(clientId, DeviceConnector.Connection.DATA, data);
  },

  _exchangeSignaling: function(message, successCallback, errorCallback) {
    User.sendCommand(
        this._id,
        "base._connect",
        {
          '_message': message
        },
        function(response) {
          if (response.state == "done" && response.results) {
            if (successCallback)
              successCallback(response.results._response);
          } else if (errorCallback) {
            errorCallback();
          }
        },
        errorCallback);
  },

  _onConnectionOpen: function() {
    this._logInfo('Device connection open');
    this._connected = true;
  },

  _onConnectionMessage: function(buffer) {
    var clientId = DeviceConnector.Connection.parseClientId(buffer);
    var type = DeviceConnector.Connection.parsePacketType(buffer);

    var tunnel = this._tunnels[clientId];

    var openCallback = this._pendingOpen[clientId];
    if (openCallback)
      delete this._pendingOpen[clientId];

    switch (type) {
      case DeviceConnector.Connection.OPEN:
        if (openCallback)
          openCallback(new DeviceConnector.Connection.Tunnel(this, clientId));
        else
          this._logError('OPEN: cannot find open callback for ' + clientId);
        break;
      
      case DeviceConnector.Connection.OPEN_FAIL:
        if (openCallback)
          openCallback();
        else
          this._logError('OPEN_FAIL: cannot find open callback for ' + clientId);
        break;

      case DeviceConnector.Connection.CLOSE:
        if (tunnel)
          tunnel.close();
        else
          this._logError('CLOSE: cannot find tunnel for ' + clientId);
        break;
        
      case DeviceConnector.Connection.DATA:
        if (tunnel)
          tunnel.receive(DeviceConnector.Connection.parsePacketPayload(buffer));
        else
          this._logError('DATA: cannot find tunnel for ' + clientId);
        break;
        
      default:
        this._logError('Unknown packet type ' + type + ' for ' + clientId);
    }
  },
  
  _send: function(clientId, type, opt_data) {
    this._webrtcConnection.send(DeviceConnector.Connection.buildPacket(clientId, type, opt_data));
  }
};

DeviceConnector.Connection.Tunnel = function(connection, clientId) {
  this._connection = connection;
  this._clientId = clientId;

  if (this._connection._tunnels[this._clientId]) {
    this._logError("Tunnel already exists for client " + this._clientId);
    return;
  }
  this._connection._tunnels[this._clientId] = this;
};

DeviceConnector.Connection.Tunnel.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._closing = true;
    if (!this._connection._tunnels[this._clientId]) {
      this._logError("Tunnel does not exist for client " + this._clientId);
      return;
    }
    if (this.onclose)
      this.onclose();
    this._connection.sendClose(this._clientId);
    delete this._connection._tunnels[this._clientId];
  },
  
  send: function(data) {
    this._connection.sendData(this._clientId, data);
  },
  
  receive: function(data) {
    if (this.onmessage)
      this.onmessage(data);
  }
};

