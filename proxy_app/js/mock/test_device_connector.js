function TestDeviceConnector(updateDashboardFunc) {
  this._connection = new TestDeviceConnector.Connection();
  this._interval = setInterval(updateDashboardFunc, 1000);
}

TestDeviceConnector.DEVICE_ID = "Loopback";

TestDeviceConnector.SOCKET_NAME = "chrome_devtools_remote";

TestDeviceConnector.prototype = {
  stop: function() {
    clearInterval(this._interval);
    TCP.Socket.getByOwner(this).forEach(function(socket) {
      socket.close();
    });
  },

  getDeviceIds: function () {
    return [TestDeviceConnector.DEVICE_ID];
  },

  getDeviceConnection: function (id) {
    if (id == TestDeviceConnector.DEVICE_ID)
      return this._connection;
    else
      return null;
  }
};

TestDeviceConnector.Connection = function() {
  this._status = {
    data: 'open',
    connected: 0,
    refused: 0
  };
};

TestDeviceConnector.Connection.prototype = {
  isConnected: function() {
    return true;
  },

  getDeviceName: function() {
    return "Cloud Device";
  },

  getScreenSize: function() {
    return "(0,50)-(0,1200)";
  },

  getSockets: function() {
    return [TestDeviceConnector.SOCKET_NAME];
  },

  connect: function(socketName, clientId, callback) {
    var respond = function(socket) {
      if (socket)
        this._status.connected++;
      else
        this._status.refused++;
      callback(socket);
    }.bind(this);

    if (socketName == TestDeviceConnector.SOCKET_NAME)
      TCP.Socket.connect("127.0.0.1", 9222, this, respond);
    else
      respond();
  },

  getStatus: function() {
    return this._status;
  },

  __proto__: Object.prototype
};
