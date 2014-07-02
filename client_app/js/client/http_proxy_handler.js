function HttpProxyHandler() {}

HttpProxyHandler.create = function(deviceConnectionPool, clientSocket) {
  var clientId = clientSocket.getId();

  Logger.install(HttpProxyHandler, HttpProxyHandler, clientId);

  var ids = deviceConnectionPool.getDeviceIds();
  if (ids.length == 0) {
    HttpProxyHandler.debug('No device connections');
    clientSocket.close();
    return;
  }

  var connection = deviceConnectionPool.getDeviceConnection(ids[0]);
  var sockets = connection.getSockets();
  if (sockets.length == 0) {
    HttpProxyHandler.debug('No sockets');
    clientSocket.close();
    return;
  }

  var pendingBytes = new Uint8Array(0);
  clientSocket.onmessage = function(arrayBuffer) {
    pendingBytes = ByteArray.concat(pendingBytes, new Uint8Array(arrayBuffer));
  };

  connection.createTunnel(sockets[0], clientId, function(tunnelSocket) {
    if (!tunnelSocket) {
      HttpProxyHandler.debug('Connection refused');
      clientSocket.close();
      return;
    }
    tunnelSocket.onmessage = clientSocket.send.bind(clientSocket);
    tunnelSocket.onclose = clientSocket.close.bind(clientSocket);
    clientSocket.onmessage = tunnelSocket.send.bind(tunnelSocket);
    clientSocket.onclose = tunnelSocket.close.bind(tunnelSocket);

    tunnelSocket.send(pendingBytes.buffer);
    HttpProxyHandler.debug('Connected (' + pendingBytes.length + ' bytes pending)');
  });
};
