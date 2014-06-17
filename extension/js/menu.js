function load() {
  function createItem(text, handler) {
    var item = document.createElement('div');
    document.body.appendChild(item);
    item.innerHTML = text.replace(/ /g, "&nbsp");
    if (handler) {
      item.addEventListener('click', function () {
        handler();
        window.close();
      });
    } else {
      item.classList.add('disabled');
    }
    return item;
  }

  var connected = !!localStorage.CONNECTED;
  var registered = !!localStorage.DEVICE_STATE;
  createItem(connected ? "Disconnect" : "Connect", toggle);
  createItem("Test client...", testClient);
  createItem("Registered devices...", viewDevices);
  createItem("Unregister", registered ? unregister : null);
  createItem("Clear local storage", clearLocalStorage);
}

function background() {
  return chrome.extension.getBackgroundPage();
}

function toggle() {
  background().BrowserAction.toggle();
}

function testClient() {
  chrome.tabs.create({url: 'client.html'});
}

function viewDevices() {
  chrome.tabs.create({url: background().XHR.GCD_UI_URL});
}

function unregister() {
  if (localStorage.CONNECTED)
    background().BrowserAction.disconnect();
  background().Device.unregister();
}

function clearLocalStorage() {
  if (localStorage.CONNECTED)
    background().BrowserAction.disconnect();
  localStorage.clear();
}

document.addEventListener("DOMContentLoaded", load);