var GCD = {};

GCD.PRODUCTION_URL = "https://www.googleapis.com/clouddevices/v1/";

GCD.STAGING_URL = "https://www-googleapis-staging.sandbox.google.com/clouddevices/v1/";

GCD.createRequestUrl = function(path) {
  if (window.useGCDStaging)
    return GCD.STAGING_URL + path;
  else
    return GCD.PRODUCTION_URL + path;
};

GCD.Device = {};

Logger.install(GCD.Device, "GCD.Device");

GCD.Device.SCOPE = "https://www.googleapis.com/auth/clouddevices";

GCD.Device.DEFAULT_NAME = "DevTools Bridge";

GCD.Device.STATE_KEY = "DEVICE_STATE";

GCD.Device.createDraft = function(name) {
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

GCD.Device.start = function(commandHandler, deviceStateGetter, successCallback, errorCallback) {
  GCD.User.requestDevices(function(response) {
    chrome.storage.local.get(function (items) {
      function started() {
        successCallback();
        GCD.Device._stopped = false;
        GCD.Device._status = {};
        GCD.Device.poll(commandHandler, deviceStateGetter);
      }

      var deviceList = response.devices || [];

      try {
        GCD.Device.STATE = JSON.parse(items.DEVICE_STATE);
        var registeredDevice = deviceList.filter(function (device) {
          return device.id == GCD.Device.STATE.id;
        })[0];

        if (registeredDevice) {
          GCD.Device.log("Read cached credentials for device '" + registeredDevice.displayName + "' #" + GCD.Device.STATE.id);
          GCD.Device._displayName = registeredDevice.displayName;
          started();
          return;
        }
        GCD.Device.warn("Cached device credentials are obsolete");
      } catch (e) {
      }

      delete GCD.Device.STATE;
      chrome.storage.local.remove(GCD.Device.STATE_KEY);

      var deviceNumbers = deviceList.map(function (device) {
        var match = device.displayName.match(GCD.Device.DEFAULT_NAME + ' (\\d+)$');
        return match ? Number(match[1]) : 1;
      });

      var deviceName = GCD.Device.DEFAULT_NAME;
      if (deviceNumbers.length) {
        var deviceNumber = Math.max.apply(null, deviceNumbers) + 1;
        deviceName += ' ' + deviceNumber;
      }

      GCD.Device.register(
          deviceName,
          function (ticket, credentials) {
            GCD.Device.log("Registered device '" + ticket.deviceDraft.displayName + "' #" + ticket.deviceDraft.id);
            GCD.Device._displayName = ticket.deviceDraft.displayName;
            GCD.Device.STATE = {
              id: ticket.deviceDraft.id,
              access_token: credentials.access_token,
              refresh_token: credentials.refresh_token
            };
            var items = {};
            items[GCD.Device.STATE_KEY] = JSON.stringify(GCD.Device.STATE);
            chrome.storage.local.set(items);
            started();
          },
          errorCallback);
    });
  });
};

GCD.Device.stop = function() {
  GCD.Device._stopped = true;
  if (GCD.Device.TIMEOUT) {
    clearTimeout(GCD.Device.TIMEOUT);
    delete GCD.Device.TIMEOUT;
  }
  delete GCD.Device.STATE;
};

GCD.Device.getDisplayName = function() {
  return GCD.Device._displayName;
};

GCD.Device.getStatus = function() {
  return GCD.Device._status;
};

GCD.Device.register = function(deviceName, successCallback, errorCallback) {
  GCD.User.request(
      'POST',
      'registrationTickets',
      {userEmail: 'me'},
      patchTicket,
      errorCallback);

  function patchTicket(ticket) {
    GCD.User.request(
        'PATCH',
        'registrationTickets/' + ticket.id + '?key=' + Keys.API_KEY,
        {
          deviceDraft: GCD.Device.createDraft(deviceName),
          oauthClientId: Keys.OAUTH_CLIENT_ID
        },
        finalizeTicket,
        errorCallback);
  }

  function finalizeTicket(ticket) {
    GCD.User.request(
        'POST',
        'registrationTickets/' + ticket.id + '/finalize?key=' + Keys.API_KEY,
        " ",
        requestDeviceCredentials,
        errorCallback);
  }

  function requestDeviceCredentials(ticket) {
    XHR.requestOAuthTokens(
        Keys.OAUTH_CLIENT_ID,
        GCD.Device.SCOPE,
        ticket.robotAccountAuthorizationCode,
        successCallback.bind(null, ticket),
        errorCallback);
  }
};

GCD.Device.unregister = function() {
  chrome.storage.local.get(function(items){
    var deviceId;
    try {
      deviceId = JSON.parse(items.DEVICE_STATE).id;
    } catch(e) {
      GCD.Device.error('Failed to parse device state');
      return;
    }
    GCD.User.request(
        'DELETE',
        'devices/' + deviceId,
        null,
        function() {
          GCD.Device.log('Deleted device ' + deviceId);
          chrome.storage.local.remove(GCD.Device.STATE_KEY);
        },
        function(status) {
          GCD.Device.error('Could not deleted device ' + deviceId + ', status=' + status);
        });
  });
};

GCD.Device.poll = function(commandHandler, deviceStateGetter) {
  GCD.Device.request(
      'GET',
      'commands?state=queued&&deviceId=' + GCD.Device.STATE.id,
      null,
      GCD.Device.receivedCommands.bind(null, commandHandler, deviceStateGetter));

  var deviceState = deviceStateGetter();
  var deviceStateJson = JSON.stringify(deviceState);
  if (!GCD.Device._cachedDeviceStateJson || GCD.Device._cachedDeviceStateJson != deviceStateJson) {
    GCD.Device._cachedDeviceStateJson = deviceStateJson;
    GCD.Device.patchVendorState(deviceState, function() {
      GCD.Device.debug("Patched device state: " + deviceStateJson);
    });
  }
};

GCD.Device.receivedCommands = function(commandHandler, deviceStateGetter, commands) {
  if (GCD.Device._stopped)
    return;

  if ('commands' in commands) {
    if (commands.commands.length > 1) {
      GCD.Device.warn(commands.commands.length + " commands queued, skipping");
      commands.commands.forEach(function (command) {
        GCD.Device.respondToCommand(command.id);
      });
    } else {
      var command = commands.commands[0];
      GCD.Device.debug("Received command: " + command.name);
      try {
        GCD.Device.respondToCommand(command.id, commandHandler(command.name, command.parameters));
      } catch (e) {
        GCD.Device.error("Error processing command: " + command.name, e)
      }
    }
  }

  GCD.Device.TIMEOUT = setTimeout(GCD.Device.poll, 1000, commandHandler, deviceStateGetter);
};

GCD.Device.respondToCommand = function(id, results) {
  var patch = {
    state: 'done'
  };
  if (results)
    patch.results = results;

  function patchedCommand(command) {
    if (command.state != 'done')
      GCD.Device.error('Failed to patch command', command);
  }

  GCD.Device.request(
      'PATCH',
      'commands/' + id,
      patch,
      patchedCommand);
};

GCD.Device.refreshAccessToken = function(callback) {
  XHR.refreshAccessToken(
      Keys.OAUTH_CLIENT_ID,
      GCD.Device.STATE.refresh_token,
      function(response) {
        GCD.Device.STATE.access_token = response.access_token;
        var items = {};
        items[GCD.Device.STATE_KEY] = JSON.stringify(GCD.Device.STATE);
        chrome.storage.local.set(items);
        callback(GCD.Device.STATE.access_token);
      },
      function(status) {
        GCD.Device.error('Failed to refresh access token, status = ' + status);
        callback();
      });
};

GCD.Device.request = function(method, path, postData, successCallback) {
  var doRequest = XHR.requestWithToken.bind(
      null,
      method,
      GCD.createRequestUrl(path),
      postData,
      function(response) {
        GCD.Device._status.gcd = "OK";
        successCallback(response);
      });

  function reportError(status, response) {
    GCD.Device._status.gcd = "HTTP " + status;
    GCD.Device.error(method + ' error ' + status + ', path = ' + path +
        ', data = ' + JSON.stringify(postData) + ', response = ' + response);
  }

  function retryOnError(status, response) {
    if (status == XHR.HTTP_ERROR_UNAUTHORIZED || status == XHR.HTTP_ERROR_FORBIDDEN)
      GCD.Device.refreshAccessToken(doRequest.bind(null, reportError));
    else
      reportError(status, response);
  }

  doRequest(retryOnError, GCD.Device.STATE.access_token);
};

GCD.Device.patchVendorState = function(state, callback) {
  var value = [];
  for (var key in state) {
    if (!state.hasOwnProperty(key))
      continue;
    value.push({
      "name": key,
      "stringValue": state[key]
    });
  }

  var patch = {
    "state": {
      "base": {
        "vendorState": {
          "value": value
        }
      }
    }
  };

  GCD.Device.request('PATCH', 'devices/' + GCD.Device.STATE.id, patch, callback);
};

GCD.User = {};

Logger.install(GCD.User, "GCD.User");

GCD.User.request = function(
    method, path, postData, successCallback, errorCallback) {
  if (!errorCallback) {
    errorCallback = function (status, response) {
      GCD.User.error(method + ' error ' + status + ', path = ' + path +
          ', data = ' + JSON.stringify(postData) + ', response = ' + response);
    };
  }

  chrome.identity.getAuthToken(
      { 'interactive': true },
      function(token) {
        if (chrome.runtime.lastError) {
          GCD.User.error(chrome.runtime.lastError.message);
          errorCallback(XHR.HTTP_ERROR_UNAUTHORIZED);
          return;
        }
        XHR.requestWithToken(
            method,
            GCD.createRequestUrl(path),
            postData,
            successCallback,
            errorCallback,
            token);
      });
};

GCD.User.requestDevices = function(callback) {
  GCD.User.request('GET', 'devices', null, callback);
};

GCD.User.sendCommand = function(deviceId, name, parameters, callback) {
  GCD.User.request(
      'POST',
      'commands?expireInMs=10000',
      {
        deviceId: deviceId,
        name: name,
        parameters: parameters
      },
      callback);
};
