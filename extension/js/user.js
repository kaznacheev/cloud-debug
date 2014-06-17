var User = {};

User.getUserAccessToken = function(callback) {
  chrome.identity.getAuthToken({ 'interactive': true }, callback);
};

User.request = function(
    method, path, postData, successCallback, errorCallback) {
  XHR.requestAuthorized(
      User.getUserAccessToken,
      null,
      method,
      XHR.getCloudDevicesUrl(path),
      postData,
      successCallback,
      errorCallback);
};

User.requestDevices = function(callback) {
  User.request('GET', 'devices', null, callback);
};

User.sendCommand = function(deviceId, name, parameters, callback) {
  User.request(
      'POST',
      'commands',
      {
        deviceId: deviceId,
        name: name,
        parameters: parameters
      },
      callback);
};

User.queryBrowser = function(deviceId, socket, action, callback) {
  User.sendCommand(
      deviceId,
      'base._queryBrowser',
      {
        '_socket': socket,
        '_path': '/json/' + action
      },
      function (response) {
        var result = response.results;
        if (!result || !result._response)
          return;
        callback(JSON.parse(result._response));
      });
};