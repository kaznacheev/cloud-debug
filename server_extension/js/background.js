// Simulate App v2 chrome.storage.local API which is required by gcd.js
chrome.storage = {
  local: {
    set: function(items) {
      for (var key in items)
        if (items.hasOwnProperty(key))
          localStorage[key] = items[key];
    },

    get: function(callback) {
      callback(localStorage)
    },

    remove: function(key) {
      delete localStorage[key];
    }
  }
};

var BrowserAction = {};

BrowserAction.toggle = function() {
  if (localStorage.CONNECTED)
    BrowserAction.disconnect();
  else
    BrowserAction.connect();
};

BrowserAction.connect = function() {
  chrome.browserAction.setIcon({path: "images/debuggerConnecting.png"});
  chrome.browserAction.setTitle({title: "Connecting..."});

  chrome.browserAction.onClicked.removeListener(BrowserAction.toggle);

  function restoreUI() {
    chrome.browserAction.onClicked.addListener(BrowserAction.toggle);
  }

  ProxyDevice.start(
    DebuggerSocket.DEFAULT_SOCKET,
    DebuggerSocket.connect,
    function(success) {
      restoreUI();
      if (success) {
        localStorage.CONNECTED = true;
        chrome.browserAction.setIcon({path: "images/debuggerPause.png"});
        chrome.browserAction.setTitle({title: "Disconnect Cloud Debug"});
      } else {
        BrowserAction.disconnect();
      }
    }
  );
};

BrowserAction.disconnect = function() {
  if (localStorage.CONNECTED) {
    delete localStorage.CONNECTED;
    ProxyDevice.stop();
  }
  chrome.browserAction.setIcon({path: "images/debuggerPlay.png"});
  chrome.browserAction.setTitle({title: "Connect Cloud Debug"});
};

chrome.browserAction.onClicked.addListener(BrowserAction.toggle);

if (localStorage.CONNECTED) {
  delete localStorage.CONNECTED;
  BrowserAction.connect();
}
