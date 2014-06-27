var RUN_IN_BACKGROUND_KEY = "runInBackground";
var RUN_PROXY_KEY = "runProxyServer";
var RUN_DEVICE_KEY = "runTestDevice";
var CONNECT_LOCALHOST_KEY = "connectToLocalhost";

function storeSetting(key, on) {
  if (!!window[key] == !!on)
    return false;

  window[key] = !!on;
  if (on) {
    var items = {};
    items[key] = true;
    chrome.storage.local.set(items);
  } else {
    chrome.storage.local.remove(key);
  }
  return true;
}

function changeSetting(key, on) {
  if (!storeSetting(key, on))
    return;

  switch (key) {
    case RUN_PROXY_KEY:
      if (on)
        createProxyServer();
      else
        deleteProxyServer();
      break;

    case RUN_DEVICE_KEY:
      if (on)
        TestDevice.start();
      else
        TestDevice.stop();
      break;

    case CONNECT_LOCALHOST_KEY:
      if (window[RUN_PROXY_KEY]) {
        deleteProxyServer();
        createProxyServer();
      }
      break;
  }
}

var server;
var connector;

function createProxyServer() {
  if (window[CONNECT_LOCALHOST_KEY])
    connector = new TestDeviceConnector();
  else
    connector = new DeviceConnector();

  var LOCAL_HOST = "127.0.0.1";
  var ADB_PORT = 5037;
  server = new TCP.Server(LOCAL_HOST, ADB_PORT, AdbCommandHandler, connector);
}

function deleteProxyServer() {
  server.close();
  server = null;
  connector.stop();
  connector = null;
}

chrome.app.runtime.onLaunched.addListener(function() {
  chrome.app.window.create('dashboard.html',
      {
        id: "dashboard",
        bounds: {
          width: 720,
          height: 240
        }
      },
      onWindowOpen);
});

function onWindowOpen(win) {
  win.onClosed.addListener(onWindowClosed);

  if (window[RUN_IN_BACKGROUND_KEY])
    return;

  if (window[RUN_PROXY_KEY])
    createProxyServer();

  if (window[RUN_DEVICE_KEY])
    TestDevice.start();
}

function onWindowClosed() {
  if (window[RUN_IN_BACKGROUND_KEY])
    return;

  if (window[RUN_PROXY_KEY])
    deleteProxyServer();

  if (window[RUN_DEVICE_KEY])
    TestDevice.stop();
}

chrome.storage.local.get(function(items) {
  window[RUN_IN_BACKGROUND_KEY] = items[RUN_IN_BACKGROUND_KEY];
  window[RUN_PROXY_KEY] = items[RUN_PROXY_KEY];
  window[RUN_DEVICE_KEY] = items[RUN_DEVICE_KEY];
  window[CONNECT_LOCALHOST_KEY] = items[CONNECT_LOCALHOST_KEY];

  if (!window[RUN_IN_BACKGROUND_KEY])
    return;

  if (window[RUN_PROXY_KEY])
    createProxyServer();

  if (window[RUN_DEVICE_KEY])
    TestDevice.start();
});
