var Device = {};

Device.GCD_SCOPE = "https://www.googleapis.com/auth/clouddevices";

Device.DEFAULT_NAME = "DevTools Bridge";

Device.STATE_KEY = "DEVICE_STATE";

Device.createDraft = function(name) {
  return {
    'deviceKind': 'vendor',
    'systemName': name,
    'displayName': name,
    'channel': {'supportedType': 'xmpp'},
    'commandDefs': {
      'base': {
        '_connect': {
          'parameters': {
            '_message': {
              'type': 'string'
            }
          }
        }
      }
    }
  };
};

Device.start = function(commandHandler, successCallback, errorCallback) {
  User.requestDevices(function(response) {
    chrome.storage.local.get(function (items) {
      function started() {
        Device.requestCommands(commandHandler);
        successCallback();
      }

      var deviceList = response.devices || [];

      try {
        Device.STATE = JSON.parse(items.DEVICE_STATE);
        var registeredDevice = deviceList.filter(function (device) {
          return device.id == Device.STATE.id;
        })[0];

        if (registeredDevice) {
          console.log("Read cached credentials for device '" + registeredDevice.displayName + "' #" + Device.STATE.id);
          started();
          return;
        }
        console.error("Cached device credentials are obsolete");
      } catch (e) {
      }

      delete Device.STATE;
      chrome.storage.local.remove(Device.STATE_KEY);

      var deviceNumbers = deviceList.map(function (device) {
        var match = device.displayName.match(Device.DEFAULT_NAME + ' (\\d+)$');
        return match ? Number(match[1]) : 1;
      });

      var deviceName = Device.DEFAULT_NAME;
      if (deviceNumbers.length) {
        var deviceNumber = Math.max.apply(null, deviceNumbers) + 1;
        deviceName += ' ' + deviceNumber;
      }

      Device.register(
          deviceName,
          function (ticket, credentials) {
            console.log("Registered device '" + ticket.deviceDraft.displayName + "' #" + ticket.deviceDraft.id);
            Device.STATE = {
              id: ticket.deviceDraft.id,
              access_token: credentials.access_token,
              refresh_token: credentials.refresh_token
            };
            var items = {};
            items[Device.STATE_KEY] = JSON.stringify(Device.STATE);
            chrome.storage.local.set(items);
            started();
          },
          errorCallback);
    });
  });
};

Device.stop = function() {
  if (Device.TIMEOUT) {
    clearTimeout(Device.TIMEOUT);
    delete Device.TIMEOUT;
  }
  delete Device.STATE;
};

Device.register = function(deviceName, successCallback, errorCallback) {
  User.request(
      'POST',
      'registrationTickets',
      {userEmail: 'me'},
      patchTicket,
      errorCallback);

  function patchTicket(ticket) {
    User.request(
        'PATCH',
        'registrationTickets/' + ticket.id + '?key=' + Keys.API_KEY,
        {
          deviceDraft: Device.createDraft(deviceName),
          oauthClientId: Keys.OAUTH_CLIENT_ID
        },
        finalizeTicket,
        errorCallback);
  }

  function finalizeTicket(ticket) {
    User.request(
        'POST',
        'registrationTickets/' + ticket.id + '/finalize?key=' + Keys.API_KEY,
        " ",
        requestDeviceCredentials,
        errorCallback);
  }

  function requestDeviceCredentials(ticket) {
    XHR.requestOAuthTokens(
        Keys.OAUTH_CLIENT_ID,
        Device.GCD_SCOPE,
        ticket.robotAccountAuthorizationCode,
        successCallback.bind(null, ticket),
        errorCallback);
  }
};

Device.unregister = function() {
  chrome.storage.local.get(function(items){
    var deviceId;
    try {
      deviceId = JSON.parse(items.DEVICE_STATE).id;
    } catch(e) {
      console.error('Failed to parse device state');
      return;
    }
    User.request(
        'DELETE',
        'devices/' + deviceId,
        null,
        function() {
          console.log('Deleted device ' + deviceId);
          chrome.storage.local.remove(Device.STATE_KEY);
        },
        function(status) {
          console.error('Could not deleted device ' + deviceId + ', status=' + status);
        });
  });
};

Device.requestCommands = function(commandHandler) {
  Device.request(
      'GET',
      'commands?state=queued&&deviceId=' + Device.STATE.id,
      null,
      Device.receivedCommands.bind(null, commandHandler));
};

Device.receivedCommands = function(commandHandler, commands) {
  if ('commands' in commands) {
    commands.commands.forEach(function (command) {
      try {
        commandHandler(
            command.name,
            command.parameters,
            Device.respondToCommand.bind(null, command.id));
      } catch (e) {
        console.error("Error processing command: " + command.name, e)
      }
    });
  }

  Device.TIMEOUT = setTimeout(Device.requestCommands, 1000, commandHandler);
};

Device.respondToCommand = function(id, results) {
  var patch = {
    state: 'done'
  };
  if (results)
    patch.results = results;

  function patchedCommand(command) {
    if (command.state != 'done')
      console.error('Failed to patch command', command);
  }

  Device.request(
      'PATCH',
      'commands/' + id,
      patch,
      patchedCommand);
};

Device.refreshAccessToken = function(callback) {
  XHR.refreshAccessToken(
      Keys.OAUTH_CLIENT_ID,
      Device.STATE.refresh_token,
      function(response) {
        Device.STATE.access_token = response.access_token;
        var items = {};
        items[Device.STATE_KEY] = JSON.stringify(Device.STATE);
        chrome.storage.local.set(items);
        callback(Device.STATE.access_token);
      },
      function(status) {
        console.error('Failed to refresh access token, status = ' + status);
        callback();
      });
};

Device.request = function(method, path, postData, successCallback, errorCallback) {
  var doRequest = XHR.requestWithToken.bind(
      null,
      method,
      XHR.getCloudDevicesUrl(path),
      postData,
      successCallback);

  if (!errorCallback) {
    errorCallback = function (status) {
      console.error(method + ' error, path = ' + path + ', status = ' + status);
    };
  }

  function retryOnError(status) {
    if (status == XHR.HTTP_ERROR_UNAUTHORIZED || status == XHR.HTTP_ERROR_FORBIDDEN)
      Device.refreshAccessToken(doRequest.bind(null, errorCallback));
    else
      errorCallback(status);
  }

  doRequest(retryOnError, Device.STATE.access_token);
};

Device.patchVendorState = function(state, callback) {
  Device.request('PATCH', 'devices/' + Device.STATE.id, state, callback);
};