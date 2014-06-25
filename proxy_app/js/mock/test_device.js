var TestDevice = {};

TestDevice.start = function() {
  TestDevice._tunnels = {};

  TestDevice._signalingHandler = new WebRTCServerSocket.SignalingHandler();
  TestDevice._signalingHandler.onaccept = TestDevice._onClientConnectionAccept;
  TestDevice._signalingHandler.onclose = TestDevice._onClientConnectionClose;

  Device.start(
      TestDevice.handleCommand,
      TestDevice.getDeviceState,
      TestDevice.onStart,
      function() { console.error('Cannot initialize test device'); });
};

TestDevice.SOCKET_LIST = "chrome_devtools_remote";

TestDevice.onStart = function() {
  console.log('Initialized test device');
};

TestDevice.getDeviceState = function() {
  var state = {
    "sockets": TestDevice.SOCKET_LIST
  };
  if (TestDevice._signalingHandler.hasPendingSignaling())
    state.hasPendingSignaling = "true";
  return state;
};

TestDevice.stop = function() {
  Device.stop();
  TestDevice._signalingHandler.stop();
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

TestDevice._onClientConnectionAccept = function(connection) {
  TestDevice._clientConnection = connection;
  TestDevice._clientConnection.onmessage = TestDevice._onClientConnectionMessage;
};

TestDevice._onClientConnectionClose = function() {
  TestDevice._clientConnection = null;
  console.info('Closing server side tunnels');
  TCP.Socket.getByOwner(this).forEach(function(tunnel) {
    tunnel.close();
  });
};

TestDevice._onClientConnectionMessage = function(buffer) {
  var clientId = DeviceConnector.Connection.parseClientId(buffer);
  var type = DeviceConnector.Connection.parsePacketType(buffer);

  var tunnel = TestDevice._tunnels[clientId];

  switch (type) {
    case DeviceConnector.Connection.OPEN:
      if (tunnel) {
        console.error("Open: server side socket already exists for " + clientId);
        return;
      }
      TCP.Socket.connect("127.0.0.1", 9222, this, function(socket) {
        if (socket) {
          TestDevice.send(clientId, DeviceConnector.Connection.OPEN);
          TestDevice._tunnels[clientId] = socket;
          socket.onclose = TestDevice._onTunnelClosed.bind(null, clientId, true);
          socket.onmessage = TestDevice._onTunnelMessage.bind(null, clientId);
          console.debug('Created server side socket for ' + clientId);
        } else {
          TestDevice.send(clientId, DeviceConnector.Connection.OPEN_FAIL);
        }
      });
      break;

    case DeviceConnector.Connection.CLOSE:
      if (tunnel) {
        tunnel.onclose = TestDevice._onTunnelClosed.bind(null, clientId, false);
        tunnel.close();
      } else {
        console.error("Close: server side socket does not exist for " + clientId);
      }
      break;

    case DeviceConnector.Connection.DATA:
      console.debug("Forwarded " + buffer.byteLength + " bytes to from " + clientId);
      if (tunnel)
        tunnel.send(DeviceConnector.Connection.parsePacketPayload(buffer));
      else
        console.error('Data: cannot find tunnel for ' + clientId);
      break;

    default:
      console.error('Unknown packet type ' + type + ' from ' + clientId);
  }

};

TestDevice._onTunnelClosed = function(clientId, notifyClient) {
  console.debug('Closed server side socket for ' + clientId +
      ' by ' + (notifyClient ? 'device' : 'client'));
  if (notifyClient)
    TestDevice.send(clientId, DeviceConnector.Connection.CLOSE);
  delete TestDevice._tunnels[clientId];
};

TestDevice._onTunnelMessage = function(clientId, data) {
  TestDevice.send(clientId, DeviceConnector.Connection.DATA, data);
};

TestDevice.send = function(clientId, type, opt_payload) {
  TestDevice._clientConnection.send(DeviceConnector.Connection.buildPacket(clientId, type, opt_payload));
};
