var Client = {};

Client.load = function() {
  User.requestDevices(Client.displayDevices)
};

Client.createChild = function(parent, tag, opt_content) {
  var child = document.createElement(tag || 'div');
  parent.appendChild(child);
  if (opt_content)
    child.textContent = opt_content;
  return child;
};

Client.displayDevices = function(response) {
  if (response.devices) {
    response.devices.forEach(function(device) {
      var deviceDiv = Client.createChild(document.body);
      var deviceTitleDiv = Client.createChild(deviceDiv, 'div', device.displayName + " #" + device.id);
      User.sendCommand(device.id, 'base._getBrowsers', {}, Client.receivedBrowsers.bind(null, deviceDiv, device.id));
    });
  } else {
    document.body.textContent = "No registered devices";
  }
};

Client.receivedBrowsers = function(deviceDiv, deviceId, response) {
  var results = response.results;
  if (!results)
    return;

  for (var key in results) {
    if (!results.hasOwnProperty(key))
      continue;
    var socket = results[key];
    User.queryBrowser(deviceId, socket, 'version',
        Client.receivedVersion.bind(null, deviceDiv, deviceId, socket));
  }
};

Client.receivedVersion = function(deviceDiv, deviceId, socket, version) {
  var browserDiv = Client.createChild(deviceDiv);

  var browserTitleDiv = Client.createChild(browserDiv, 'div', 'Chrome ' + version["Browser"]);

  var openDiv = Client.createChild(browserDiv);
  var urlInput = Client.createChild(openDiv, 'input');
  urlInput.type = 'text';
  var openButton = Client.createChild(openDiv, 'button', 'open');
  openButton.addEventListener('click', Client.openUrl.bind(null, deviceId, socket, urlInput));

  var targetsDiv = Client.createChild(browserDiv);
  User.queryBrowser(
      deviceId, socket, 'list',
      Client.receivedTargets.bind(null, targetsDiv, deviceId, socket));
};

Client.openUrl = function(deviceId, socket, urlInput) {
  var url = urlInput.value;
  if (!url.match('^http'))
    url = "http://" + url;

  User.sendCommand(
      deviceId,
      'base._queryBrowser',
      {
        '_socket': socket,
        '_path': '/json/new?' + url
      },
      function() {});
};

Client.receivedTargets = function(targetsDiv, deviceId, socket, targets) {
  var buckets = {};
  targets.forEach(function(target) {
    var bucket = buckets[target.type];
    if (bucket)
      bucket.push(target);
    else
      buckets[target.type] = [target];
  });

  for (var type in buckets) {
    if (!buckets.hasOwnProperty(type))
      continue;
    var bucketDiv = Client.createChild(targetsDiv, 'div', type);

    buckets[type].forEach(function (target) {
      var targetDiv = Client.createChild(bucketDiv);

      var favIcon = Client.createChild(targetDiv, 'img');
      if (target.faviconUrl)
        favIcon.src = target.faviconUrl;

      var titleSpan = Client.createChild(targetDiv, 'span', target.title);
      titleSpan.title = target.url;

      function addActionButton(action) {
        Client.createChild(targetDiv, 'button', action).
            addEventListener('click', User.queryBrowser.bind(null, deviceId, socket, action + '/' + target.id));
      }

      if (!target.attached) {
        var frontendUrl = target.devtoolsFrontendUrl + '?ws=' + target.id;
        Client.createChild(targetDiv, 'button', 'inspect').
            addEventListener('click', Client.inspect.bind(null, deviceId, socket, target.id, frontendUrl));
      }

      addActionButton('activate');
      addActionButton('reload');
      addActionButton('close');
    });
  }
};

Client.inspect = function(deviceId, socket, targetId, frontendUrl) {
    chrome.tabs.create({
      url: "frontend.html?deviceId=" + deviceId + "&socket=" + socket + "&path=" + targetId
    });
};

document.addEventListener("DOMContentLoaded", Client.load);