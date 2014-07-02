function DeviceConnector() {
  Logger.install(this, DeviceConnector);
  this._connections = {};

  XHR.simpleGet(
      DeviceConnector.ICE_CONFIG_URL,
      this._start.bind(this),
      this._start.bind(this, null));
}

DeviceConnector.debug = false;

DeviceConnector.ICE_CONFIG_URL = "http://computeengineondemand.appspot.com/turn?username=28230128&key=4080218913";

DeviceConnector.prototype = {
  _start: function(turnServerConfig) {
    this._iceServersConfig = {
      iceServers: [
        {urls: ["stun:stun.l.google.com:19302"]}
      ]
    };
    if (turnServerConfig) {
      this._iceServersConfig.iceServers.push({
        urls: turnServerConfig.uris,
        username: turnServerConfig.username,
        credential: turnServerConfig.password
      });
    }
    this.log('Started, ICE config:', JSON.stringify(this._iceServersConfig));
    this._active = true;
    this._queryDevices();
  },
  
  stop: function() {
    this.log('Stopped');
    delete this._active;
    if (this._timeout)
      clearTimeout(this._timeout);

    this.getDeviceIds().forEach(function(id) {
      this._connections[id].stop();
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
    GCD.User.requestDevices(this._receivedDevices.bind(this));
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
          this._connections[id] = new DeviceConnector.Connection(deviceResource, this._iceServersConfig);
        }
      }.bind(this));
    }

    oldDeviceIds.forEach(function(id) {
      if (newDeviceIds.indexOf(id) < 0) {
        this._connections[id].stop();
        delete this._connections[id];
      }
    }.bind(this));

    this._timeout = setTimeout(this._queryDevices.bind(this), 1000);
  }
};

DeviceConnector.Connection = function(resource, iceServersConfig) {
  this._id = resource.id;
  this._displayName = resource.displayName;
  this._iceServersConfig = iceServersConfig;

  Logger.install(this, "DeviceConnector.Connection", this._displayName);

  this.log('Added');

  this._sockets = [];

  this._status = {};

  this._parseVendorState(resource);
  this.connect();
};

DeviceConnector.Connection.RECONNECT_TIMEOUT = 3000;

DeviceConnector.Connection.prototype = {
  connect: function() {
    this._webrtcConnection = new WebRTCClientSocket(this._displayName);
    this._webrtcConnection.onopen = this._onConnectionOpen.bind(this);
    this._webrtcConnection.onclose = this._onConnectionClosed.bind(this);

    this._signalingHandler = new WebRTCClientSocket.SignalingHandler(
        this._webrtcConnection, this._exchangeSignaling.bind(this));

    this._webrtcConnection.connect(this._iceServersConfig);
  },

  stop: function() {
    this.log('Removed');
    if (!this._reconnectTime)
      this._webrtcConnection.close();
  },

  isConnected: function () {
    return this._tunnelClient;
  },

  getDeviceName: function () {
    return this._displayName;
  },

  getScreenSize: function () {
    return "(0,50)-(0,1200)"; // TODO: Get from device.
  },

  getSockets: function() {
    return this._sockets;
  },

  createTunnel: function(socketName, clientId, callback) {
    if (this._tunnelClient)
      this._tunnelClient.connect(socketName, clientId, callback);
    else
      callback();
  },

  update: function(resource) {
    if (this._reconnectTime && (this._reconnectTime < Date.now())) {
      delete this._reconnectTime;
      this.connect();
    }
    var vendorState = this._parseVendorState(resource);
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
    if (this._tunnelClient)
      mergeMap(result, this._tunnelClient.getStatus());
    mergeMap(result, this._status);
    return result;
  },

  _parseVendorState: function(resource) {
    var vendorState = {};
    try {
      resource.state.base.vendorState.value.forEach(function(item) {
        vendorState[item.name] = item.stringValue;
      });
    } catch(e) {
    }
    this._sockets = (vendorState.sockets || '').split(',');
    return vendorState;
  },

  _exchangeSignaling: function(message, successCallback, errorCallback) {
    var reportError = function(status) {
      this.error("GCD error: " + status);
      this._status.gcd = status;
      if (errorCallback)
        errorCallback(status);
    }.bind(this);

    GCD.User.sendCommand(
        this._id,
        "base._connect",
        {
          '_message': message
        },
        function(response) {
          if (response.state != "done") {
            reportError(response.state)
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
    this._tunnelClient = new SocketTunnel.Client(this._webrtcConnection, this._displayName);
  },

  _onConnectionClosed: function() {
    if (this._tunnelClient) {
      this._tunnelClient.close();
      delete this._tunnelClient;
    }
    this._reconnectTime = Date.now() + DeviceConnector.Connection.RECONNECT_TIMEOUT;
    this._signalingHandler.stop();
  }
};