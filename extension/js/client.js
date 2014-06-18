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

      var deviceTitleDiv = Client.createChild(deviceDiv);
      deviceTitleDiv.classList.add('device-title');

      var deviceName = Client.createChild(deviceTitleDiv, 'span', device.displayName);
      deviceName.classList.add('device-name');

      var deviceId = Client.createChild(deviceTitleDiv, 'span', device.id);
      deviceId.classList.add('device-id');

      var browsersDiv = Client.createChild(deviceDiv, 'div', 'Loading...');
      browsersDiv.classList.add('device-browsers');

      User.sendCommand(device.id, 'base._getBrowsers', {}, Client.receivedBrowsers.bind(null, browsersDiv, device.id));
    });
  } else {
    document.body.textContent = 'No registered devices';
  }
};

Client.receivedBrowsers = function(browsersDiv, deviceId, response) {
  var results = response.results;
  if (!results)
    return;

  for (var key in results) {
    if (!results.hasOwnProperty(key))
      continue;
    var socket = results[key];
    User.queryBrowser(deviceId, socket, 'version',
        Client.receivedVersion.bind(null, browsersDiv, deviceId, socket));
  }
};

Client.receivedVersion = function(browsersDiv, deviceId, socket, version) {
  if (browsersDiv.firstChild.tagName != 'DIV')
    browsersDiv.textContent = '';

  var browserDiv = Client.createChild(browsersDiv);
  browserDiv.classList.add('browser');

  var browserTitleDiv = Client.createChild(browserDiv, 'div', version['Browser']);
  browserTitleDiv.classList.add('browser-title');

  var openDiv = Client.createChild(browserDiv);
  openDiv.classList.add('browser-open');
  var urlInput = Client.createChild(openDiv, 'input');
  urlInput.type = 'text';
  var openButton = Client.createChild(openDiv, 'button', 'Open');
  openButton.addEventListener('click', Client.openUrl.bind(null, deviceId, socket, urlInput));

  var targetsDiv = Client.createChild(browserDiv, 'div', 'Loading...');
  User.queryBrowser(
      deviceId, socket, 'list',
      Client.receivedTargets.bind(null, targetsDiv, deviceId, socket));
};

Client.openUrl = function(deviceId, socket, urlInput) {
  var url = urlInput.value;
  if (!url.match('^http'))
    url = 'http://' + url;

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
  targetsDiv.textContent = '';
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
    var bucketDiv = Client.createChild(targetsDiv);
    bucketDiv.classList.add('target-bucket');

    var bucketNameDiv = Client.createChild(bucketDiv, 'div', 'Type: ' + type);
    bucketNameDiv.classList.add('target-bucket-name');

    buckets[type].forEach(function (target) {
      var targetDiv = Client.createChild(bucketDiv);
      targetDiv.classList.add('target');

      var favIcon = Client.createChild(targetDiv, 'img');
      if (target.faviconUrl)
        favIcon.src = target.faviconUrl;

      var titleSpan = Client.createChild(targetDiv, 'span', target.title);
      titleSpan.title = target.url;

      var actionsDiv = Client.createChild(targetDiv);
      actionsDiv.classList.add('target-actions');

      function createActionLink(text, handler) {
        var span = Client.createChild(actionsDiv, 'span', text);
        span.addEventListener('click', function(e) {
          e.preventDefault();
          handler();
        });
        return span;
      }

      if (!target.attached)
        createActionLink('inspect', Client.inspect.bind(null, deviceId, socket, target));

      function addJsonAction(action) {
        createActionLink(action, User.queryBrowser.bind(null, deviceId, socket, action + '/' + target.id));
      }

      addJsonAction('activate');
      addJsonAction('reload');
      addJsonAction('close');
    });
  }
};

Client.inspect = function(deviceId, socket, target) {
    chrome.tabs.create({
      url: 'frontend.html?deviceId=' + deviceId + '&socket=' + socket + '&target=' + target.id + '&frontend=' + encodeURIComponent(target.devtoolsFrontendUrl)
    });
};

document.addEventListener('DOMContentLoaded', Client.load);