function TestDeviceConnector() {
  this._connection = new TestDeviceConnector.Connection();
}

TestDeviceConnector.DEVICE_ID = "Loopback";

TestDeviceConnector.SOCKET_NAME = "chrome_devtools_remote";

TestDeviceConnector.prototype = {
  stop: function() {
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

TestDeviceConnector.Connection = function() {};

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
    if (socketName == TestDeviceConnector.SOCKET_NAME)
      TCP.Socket.connect("127.0.0.1", 9222, this, callback);
    else
      callback();
  },

  __proto__: Object.prototype
};
