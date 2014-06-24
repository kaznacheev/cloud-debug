var TestDevice = {};

TestDevice.start = function() {
  TestDevice._tunnels = {};

  Device.start(
      TestDevice._handleCommand,
      TestDevice.onStart,
      function() { console.error('Cannot initialize test device'); });
};

TestDevice.onStart = function() {
  console.log('Initialized test device');

//  var time = Date.now() / 1000;
//  var state = {
//    "timeMs": time,
//    "patches": [
//      {
//        "timeMs": time,
//        "patch": {
//          "version": "1.0",
//          "base": {
//            "vendorState": {
//              "value": [
//                {
//                  "name": "sockets",
//                  "stringValue": "chrome_devtools_remote"
//                }
//              ]
//            }
//          }
//        }
//      }
//    ]
//  };
  var patch = {
    "state": {
      "base": {
        "vendorState": {
          "value": [
            {
              "name": "sockets",
              "stringValue": "chrome_devtools_remote"
            }
          ]
        }
      }
    }
  };

  Device.patchVendorState(patch, function() {
    console.log('Patched device state');
  });
};

TestDevice.stop = function() {
  Device.stop();
  if (this._connection)
    this._connection.close();
};

TestDevice._pendingOutboundSignaling = [];

TestDevice._handleCommand = function(name, parameters, patchResultsFunc) {
  var serverError = console.error.bind(console);

  if (name != "base._connect") {
    serverError("Unknown device command: " + name);
    return;
  }

  function respond(messageObject) {
    patchResultsFunc({
      '_response': JSON.stringify(messageObject)
    });
  }

  function bufferOutboundSignaling(messageObject) {
    TestDevice._pendingOutboundSignaling.push(messageObject);
  }

  var message = parameters._message;
  if (!message) {
    // Just polling
  } else {
    var messageList;
    try {
      messageList = JSON.parse(message);
    } catch (e) {
      serverError("Cannot parse message", message, e);
      respond([]);
      return;
    }

    for (var i = 0; i != messageList.length; i++) {
      var messageObj = messageList[i];

      if (messageObj.type == "offer") {
        if (TestDevice._connection) {
          serverError("Connection already open");
          respond([WebRTCServerConnection.CLOSE_SIGNAL]);
          return;
        } else {
          TestDevice._connection = new WebRTCServerConnection(messageObj, bufferOutboundSignaling);
          TestDevice._connection.onmessage = TestDevice._onConnectionMessage;
          TestDevice._connection.onclose = TestDevice._onConnectionClose;
        }
      } else if (messageObj.type == WebRTCServerConnection.CLOSE_SIGNAL.type) {
        if (TestDevice._connection) {
          TestDevice._connection.close();
          TestDevice._pendingOutboundSignaling = [];  // Erase obsolete messages.
        } else {
          serverError("Cannot find the connection to close");
        }
      } else if ('candidate' in messageObj) {
        if (TestDevice._connection)
          TestDevice._connection.addIceCandidate(messageObj);
        else
          serverError("Cannot find the connection to add ICE candidate");
      }
    }
  }

  respond(TestDevice._pendingOutboundSignaling);
  TestDevice._pendingOutboundSignaling = [];
};

TestDevice._onConnectionClose = function() {
  delete TestDevice._connection;
  TCP.Socket.getByOwner(this).forEach(function(socket) {
    socket.close();
  });
};

TestDevice._onConnectionMessage = function(buffer) {
  var clientId = DeviceConnector.Connection.parseClientId(buffer);
  var type = DeviceConnector.Connection.parsePacketType(buffer);

  var tunnel = TestDevice._tunnels[clientId];

  switch (type) {
    case DeviceConnector.Connection.OPEN:
      if (tunnel) {
        console.error("Open: server side socket already exists for " + clientId);
        return;
      }
      TCP.Socket.connect("127.0.0.1", 9222, this, function(socket) {
        if (socket) {
          TestDevice.send(clientId, DeviceConnector.Connection.OPEN);
          TestDevice._tunnels[clientId] = socket;
          socket.onclose = TestDevice._onTunnelClosedByDevice.bind(null, clientId);
          socket.onmessage = TestDevice._onTunnelMessage.bind(null, clientId);
          console.log('Created server side socket for ' + clientId);
        } else {
          TestDevice.send(clientId, DeviceConnector.Connection.OPEN_FAIL);
        }
      });
      break;

    case DeviceConnector.Connection.CLOSE:
      if (tunnel) {
        tunnel.onclose = TestDevice._onTunnelClosedByClient.bind(null, clientId);
        tunnel.close();
      } else {
        console.error("Close: server side socket does not exist for " + clientId);
      }
      break;

    case DeviceConnector.Connection.DATA:
      console.log("Forwarded data from " + clientId, arrayBufferToString(DeviceConnector.Connection.parsePacketPayload(buffer)));
      if (tunnel)
        tunnel.send(DeviceConnector.Connection.parsePacketPayload(buffer));
      else
        console.error('Data: cannot find tunnel for ' + clientId);
      break;

    default:
      console.error('Unknown packet type ' + type + ' from ' + clientId);
  }

};

TestDevice._onTunnelClosedByDevice = function(clientId) {
  console.log('Server side socket for ' + clientId + ' closed by device');
  TestDevice.send(clientId, DeviceConnector.Connection.CLOSE);
  delete TestDevice._tunnels[clientId];
};

TestDevice._onTunnelClosedByClient = function(clientId) {
  console.log('Closed server side socket for ' + clientId);
  delete TestDevice._tunnels[clientId];
};

TestDevice._onTunnelMessage = function(clientId, data) {
  TestDevice.send(clientId, DeviceConnector.Connection.DATA, data);
};

TestDevice.send = function(clientId, type, opt_payload) {
  this._connection.send(DeviceConnector.Connection.buildPacket(clientId, type, opt_payload));
};
