var HttpProxyHandler = {};

HttpProxyHandler._channelId = 0;

HttpProxyHandler.create = function(deviceConnectionPool, clientSocket) {
  var ids = deviceConnectionPool.getDeviceIds();
  if (ids.length == 0) {
    console.debug('No device connections');
    clientSocket.close();
    return;
  }

  var connection = deviceConnectionPool.getDeviceConnection(ids[0]);
  var sockets = connection.getSockets();
  if (sockets.length == 0) {
    console.debug('No sockets');
    clientSocket.close();
    return;
  }

  var pendingBytes = new Uint8Array(0);
  clientSocket.onmessage = function(arrayBuffer) {
    pendingBytes = ByteArray.concat(pendingBytes, new Uint8Array(arrayBuffer));
  };

  var channelId = ++HttpProxyHandler._channelId;
  connection.createTunnel(sockets[0], channelId, function(tunnelSocket) {
    if (!tunnelSocket) {
      console.debug('Could not connect ' + channelId);
      clientSocket.close();
      return;
    }
    tunnelSocket.onmessage = clientSocket.send.bind(clientSocket);
    tunnelSocket.onclose = clientSocket.close.bind(clientSocket);
    clientSocket.onmessage = tunnelSocket.send.bind(tunnelSocket);
    clientSocket.onclose = tunnelSocket.close.bind(tunnelSocket);

    tunnelSocket.send(pendingBytes.buffer);
    console.debug('Connected ' + channelId + ', pending size: ' + pendingBytes.length);
  });
};
