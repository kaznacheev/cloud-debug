onload = function() {
  var connector;
  var proxyServer;

  function createProxyServer(connector) {
    var LOCAL_HOST = "127.0.0.1";
    var ADB_PORT = 5037;
    return new TCP.Server(LOCAL_HOST, ADB_PORT, AdbCommandHandler, connector);
  }

  function setClickHandler(id, handler) {
    document.getElementById(id).addEventListener('click', handler);
  }

  setClickHandler('client-start', function() {
    if (connector)
      return;
    connector = new DeviceConnector();
    proxyServer = createProxyServer(connector);
  });

  setClickHandler('client-start-loopback', function() {
    if (connector)
      return;
    connector = new TestDeviceConnector();
    proxyServer = createProxyServer(connector);
  });

  setClickHandler('client-stop', function() {
    if (!connector)
      return;
    connector.stop();
    connector = null;
    proxyServer.close();
    proxyServer = null;
  });

  setClickHandler('server-start', TestDevice.start);

  setClickHandler('server-stop', TestDevice.stop);
};
