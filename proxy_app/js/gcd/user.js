var User = {};

User.request = function(
    method, path, postData, successCallback, errorCallback) {
  if (!errorCallback) {
    errorCallback = function (status) {
      console.error(method + ' error ' + status + ' path = ' + path + ', data = ' + JSON.stringify(postData));
    };
  }

  chrome.identity.getAuthToken(
      { 'interactive': true },
      function(token) {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          return;
        }
        XHR.requestWithToken(
            method,
            XHR.getCloudDevicesUrl(path),
            postData,
            successCallback,
            errorCallback,
            token);
      });
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
