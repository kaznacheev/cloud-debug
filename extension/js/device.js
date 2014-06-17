var Device = {};

Device.GCD_SCOPE = "https://www.googleapis.com/auth/clouddevices";

Device.DEFAULT_NAME = "DevTools Cloud Extender";

Device.createDraft = function(name) {
  return {
    'deviceKind': 'vendor',
    'systemName': name,
    'displayName': name,
    'channel': {'supportedType': 'xmpp'},
    'commandDefs': {
      'base': {
        '_getBrowsers': {
          'parameters': {}
        },
        '_queryBrowser': {
          'parameters': {
            '_socket': {
              'type': 'string'
            },
            '_path': {
              'type': 'string'
            }
          }
        },
        '_connect': {
          'parameters': {
            '_socket': {
              'type': 'string'
            },
            '_path': {
              'type': 'string'
            },
            '_message': {
              'type': 'string'
            }
          }
        }
      }
    }
  };
};

Device.start = function(successCallback, errorCallback) {
  function started() {
    DebuggerProxy.start();
    Device.requestCommands();
    successCallback();
  }
  
  User.requestDevices(function(response) {
    var deviceList = response.devices || [];
    try {
      Device.STATE = JSON.parse(localStorage.DEVICE_STATE);
      var registeredDevice = deviceList.filter(function (device) {
        return device.id == Device.STATE.id;
      })[0];

      if (registeredDevice) {
        console.log('Read cached credentials for device ' + Device.STATE.id);
        started();
        return;
      }
      console.error("Cached device credentials are obsolete");
    } catch (e) {
    }

    delete Device.STATE;
    delete localStorage.DEVICE_STATE;

    var deviceNumbers = deviceList.map(function(device) {
      var match = device.systemName.match('\\d+$');
      return match ? Number(match[0]) : 0;
    });

    var deviceName = Device.DEFAULT_NAME;
    if (deviceNumbers.length) {
      var deviceNumber = Math.max.apply(null, deviceNumbers) + 1;
      deviceName += ' ' + deviceNumber;
    }

    Device.register(
        deviceName,
        function(ticket, credentials) {
          console.log("Registered device " + ticket.deviceDraft.id);
          Device.STATE = {
            id: ticket.deviceDraft.id,
            access_token: credentials.access_token,
            refresh_token: credentials.refresh_token
          };
          localStorage.DEVICE_STATE = JSON.stringify(Device.STATE);
          started();
        },
        errorCallback);
  });
};

Device.stop = function(opt_unregister) {
  if (Device.TIMEOUT) {
    clearTimeout(Device.TIMEOUT);
    delete Device.TIMEOUT;
  }
  DebuggerProxy.stop();
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
  var deviceId;
  try {
    deviceId = JSON.parse(localStorage.DEVICE_STATE).id;
  } catch(e) {
    return;
  }
  User.request(
      'DELETE',
      'devices/' + deviceId,
      null,
      function() {
        console.log('Deleted device ' + deviceId);
        delete localStorage.DEVICE_STATE;
      });
};

Device.requestCommands = function() {
  Device.request(
      'GET',
      'commands?state=queued&&deviceId=' + Device.STATE.id,
      null,
      Device.receivedCommands);
};

Device.receivedCommands = function(commands) {
console.log('receivedCommands', commands);
  if ('commands' in commands)
    commands.commands.forEach(function(command) {
      try {
        console.log('Processing command ', command.name, command.parameters);
        DebuggerProxy.processCommand(
            command.name, 
            command.parameters, 
            Device.respondToCommand.bind(null, command.id));
      } catch (e) {
        console.error("Error processing command: " + command.name, e)
      }
    });

  Device.TIMEOUT = setTimeout(Device.requestCommands, 1000);
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

Device.getAccessToken = function(callback) {
  callback(Device.STATE.access_token);
};

Device.refreshAccessToken = function(callback) {
  XHR.refreshAccessToken(
      Keys.OAUTH_CLIENT_ID,
      Device.STATE.refresh_token,
      function(response) {
        Device.STATE.access_token = response.access_token;
        localStorage.DEVICE_STATE = JSON.stringify(Device.STATE);
        callback(Device.STATE.access_token);
      },
      function(status) {
        console.error('Failed to refresh access token, status = ' + status);
        callback();
      });
};

Device.request = function(method, path, postData, successCallback) {
  XHR.requestAuthorized(
      Device.getAccessToken,
      Device.refreshAccessToken,
      method,
      XHR.getCloudDevicesUrl(path),
      postData,
      successCallback,
      function(status) {
        console.error(method + ' error, path = ' + path + ', status = ' + status);
      });
};
