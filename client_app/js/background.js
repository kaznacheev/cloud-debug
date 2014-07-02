var RUN_IN_BACKGROUND_KEY = "runInBackground";
var RUN_PROXY_KEY = "runProxyServer";
var RUN_DEVICE_KEY = "runTestDevice";
var CONNECT_LOCALHOST_KEY = "connectToLocalhost";
var SERVE_HTTP_KEY = "serveHttp";
var USE_GCD_STAGING_KEY = "useGCDStaging";

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
  if (key == RUN_DEVICE_KEY && deviceStarting)
    return false;

  if (!storeSetting(key, on))
    return;

  switch (key) {
    case RUN_PROXY_KEY:
      if (on) {
        createConnector();
        createProxyServer();
      } else {
        deleteProxyServer();
        deleteConnector();
      }
      break;

    case RUN_DEVICE_KEY:
      if (on)
        startProxyDevice();
      else
        stopProxyDevice();
      break;

    case CONNECT_LOCALHOST_KEY:
      if (window[RUN_PROXY_KEY]) {
        deleteProxyServer();
        deleteConnector();
        createConnector();
        createProxyServer();
      }
      break;

    case SERVE_HTTP_KEY:
      if (window[RUN_PROXY_KEY]) {
        deleteProxyServer();
        createProxyServer();
      }
      break;
  }

  return true;
}

var connector;

function createConnector() {
  if (window[CONNECT_LOCALHOST_KEY])
    connector = new TestDeviceConnector();
  else
    connector = new DeviceConnector();
}

function deleteConnector() {
  connector.stop();
  connector = null;
}

var server;

function createProxyServer() {
  var LOCAL_HOST = "127.0.0.1";
  if (window[SERVE_HTTP_KEY]) {
    server = new TCP.Server(LOCAL_HOST, 9222, HttpProxyHandler.create.bind(null, connector));
  } else {
    var ADB_PORT = 5037;
    server = new TCP.Server(LOCAL_HOST, ADB_PORT, AdbCommandHandler.create.bind(null, connector));
  }
}

function deleteProxyServer() {
  server.close();
  server = null;
}


function createSocket(socketName, channelId, callback) {
  var port;
  try {
    port = parseInt(socketName.match('\\d+$')[0]);
  } catch (e) {
    callback();
    return;
  }
  TCP.Socket.connect("127.0.0.1", port, ProxyDevice, callback);
}

var deviceStarting;

function startProxyDevice() {
  if (deviceStarting)
    return;
  deviceStarting = true;
  ProxyDevice.start(
      "chrome_devtools_remote_9222",
      createSocket,
      function(success) {
        deviceStarting = false;
        if (success)
          return;
        storeSetting(RUN_DEVICE_KEY, false);
        if (dashboardWindow && dashboardWindow.contentDocument) {
          dashboardWindow.contentDocument.getElementById(RUN_DEVICE_KEY).checked = false;
        }
      });
}

function stopProxyDevice() {
  ProxyDevice.stop();
}

chrome.app.runtime.onLaunched.addListener(function() {
  chrome.app.window.create('dashboard.html',
      {
        id: "dashboard",
        bounds: {
          width: 800,
          height: 240
        }
      },
      onWindowOpen);
});

var dashboardWindow;

function onWindowOpen(win) {
  dashboardWindow = win;

  win.onClosed.addListener(onWindowClosed);

  if (window[RUN_IN_BACKGROUND_KEY])
    return;

  if (window[RUN_PROXY_KEY]) {
    createConnector();
    createProxyServer();
  }

  if (window[RUN_DEVICE_KEY])
    startProxyDevice();
}

function onWindowClosed() {
  dashboardWindow = null;

  if (window[RUN_IN_BACKGROUND_KEY])
    return;

  if (window[RUN_PROXY_KEY]) {
    deleteProxyServer();
    deleteConnector();
  }

  if (window[RUN_DEVICE_KEY])
    stopProxyDevice();
}

chrome.storage.local.get(function(items) {
  window[RUN_IN_BACKGROUND_KEY] = items[RUN_IN_BACKGROUND_KEY];
  window[RUN_PROXY_KEY] = items[RUN_PROXY_KEY];
  window[RUN_DEVICE_KEY] = items[RUN_DEVICE_KEY];
  window[CONNECT_LOCALHOST_KEY] = items[CONNECT_LOCALHOST_KEY];
  window[SERVE_HTTP_KEY] = items[SERVE_HTTP_KEY];
  window[USE_GCD_STAGING_KEY] = items[USE_GCD_STAGING_KEY];

  if (!window[RUN_IN_BACKGROUND_KEY])
    return;

  if (window[RUN_PROXY_KEY]) {
    createConnector();
    createProxyServer();
  }

  if (window[RUN_DEVICE_KEY])
    startProxyDevice();
});
