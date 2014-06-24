var User = {};

User.request = function(
    method, path, postData, successCallback, errorCallback) {
  if (!errorCallback) {
    errorCallback = function (status) {
      console.error(method + ' error, path = ' + path + ', status = ' + status);
    };
  }

  chrome.identity.getAuthToken(
      { 'interactive': true },
      XHR.requestWithToken.bind(
          null,
          method,
          XHR.getCloudDevicesUrl(path), 
          postData,
          successCallback,
          errorCallback));
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
