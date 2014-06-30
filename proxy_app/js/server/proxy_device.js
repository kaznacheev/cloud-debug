var ProxyDevice = {};

ProxyDevice.start = function(socketList, localSocketFactory, callback) {
  ProxyDevice._socketList = socketList;

  GCD.Device.start(
      ProxyDevice.handleCommand,
      ProxyDevice.getDeviceState,
      function() {
        ProxyDevice._signalingHandler = new WebRTCServerSocket.SignalingHandler();
        ProxyDevice._signalingHandler.onaccept = ProxyDevice.openTunnel.bind(null, localSocketFactory);
        ProxyDevice._signalingHandler.onclose = ProxyDevice.closeTunnel;
        console.log("Started proxy device");
        callback(true);
      },
      function() {
        console.error("Could not start proxy device");
        callback(false);
      });
};

ProxyDevice.stop = function() {
  console.log("Stopped proxy device");
  GCD.Device.stop();
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

ProxyDevice.openTunnel = function(localSocketFactory, connection) {
  ProxyDevice._tunnelServer = new SocketTunnel.Server(connection, localSocketFactory, "Tunnel Server");
};

ProxyDevice.closeTunnel = function() {
  ProxyDevice._tunnelServer.close();
  delete ProxyDevice._tunnelServer;
};
