function AdbCommandHandler(deviceConnectionPool, socket) {
  this._deviceConnectionPool = deviceConnectionPool;

  this._clientSocket = socket;
  this._clientSocket.onmessage = this._onClientMessage.bind(this);

  this._processCommand = this._processHostCommand.bind(this);
}

AdbCommandHandler.create = function(deviceConnectionPool, socket) {
  return new AdbCommandHandler(deviceConnectionPool, socket);
};

AdbCommandHandler.LENGTH_MARKER_SIZE = 4;
AdbCommandHandler.RESULT_SIZE = 4;

AdbCommandHandler._parseLengthMarker = function(buffer) {
  return parseInt(ByteArray.toString(buffer.subarray(0, AdbCommandHandler.LENGTH_MARKER_SIZE)), 16);
};

AdbCommandHandler._formatLengthMarker = function(size) {
  return ((1 << (AdbCommandHandler.LENGTH_MARKER_SIZE * 4)) + size).toString(16).slice(1);
};

AdbCommandHandler._simulateProcNetUnix = function(sockets) {
  return "Num RefCount Protocol Flags Type St Inode Path\n" +
      sockets.map(function(socket) {
        return "00000000: 00000002 00000000 00010000 0001 01 00000 @" + socket;
      }).join("\r\n");
};

AdbCommandHandler._simulateDumpSys = function(size) {
  return "mStable=" + size + "\r\n";
};

AdbCommandHandler.prototype = {
  _onClientMessage: function(arrayBuffer) {
    this._byteBuffer = ByteArray.concat(this._byteBuffer, new Uint8Array(arrayBuffer));

    for(;;) {
      if (this._byteBuffer.length < AdbCommandHandler.LENGTH_MARKER_SIZE)
        return;

      var commandSize;
      try {
        commandSize = AdbCommandHandler._parseLengthMarker(this._byteBuffer);
      } catch (e) {
        this._replyFAIL();
        return;
      }

      var packetSize = AdbCommandHandler.LENGTH_MARKER_SIZE + commandSize;
      if (this._byteBuffer.length < packetSize)
        return;

      var command = ByteArray.toString(this._byteBuffer.subarray(AdbCommandHandler.LENGTH_MARKER_SIZE, packetSize));

      this._byteBuffer = this._byteBuffer.subarray(packetSize);

      this._processCommand(command);
    }
  },

  _processHostCommand: function(command) {
    var match;
    match = command.match("^host:(.+)$");
    if (match) {
      var hostCommand = match[1];
      if (hostCommand == "devices") {
        var lines = this._deviceConnectionPool.getDeviceIds().map(function (deviceId) {
          var deviceConnection = this._deviceConnectionPool.getDeviceConnection(deviceId);
          var state = deviceConnection.isConnected() ? "device" : "offline";
          return deviceId + "\t" + state;
        }.bind(this));
        this._replyOKAY(lines.join("\n")+ "\n"); // Empty payload seems to hang up the client.
        return;
      }

      match = hostCommand.match("^transport:(.+)$");
      if (match) {
        var deviceId = match[1];
        this._processCommand = this._processDeviceCommand.bind(this, deviceId);
        this._replyOKAY();
        return;
      }
    }
    this._replyFAIL();
  },

  _processDeviceCommand: function(deviceId, deviceCommand) {
    var deviceConnection = this._deviceConnectionPool.getDeviceConnection(deviceId);
    if (!deviceConnection) {
      this._replyFAIL();
      return;
    }

    var match = deviceCommand.match("^shell:(.+)$");
    if (match) {
      var shellCommand = match[1];
      this._processShellCommand(deviceConnection, shellCommand);
      return;
    }

    match = deviceCommand.match("^localabstract:(.+)$");
    if (match) {
      var deviceSocketName = match[1];
      this._createTunnel(deviceConnection, deviceSocketName);
      return;
    }

    this._replyFAIL();
  },

  _processShellCommand: function(deviceConnection, shellCommand) {
    switch(shellCommand) {
      case "getprop ro.product.model":
        var name = deviceConnection.getDeviceName();
        if (name)
          this._replyOKAY(name);
        else
          this._replyFAIL();
        break;

      case "dumpsys window policy":
        var size = deviceConnection.getScreenSize();
        if (size)
          this._replyOKAY(AdbCommandHandler._simulateDumpSys(size));
        else
          this._replyFAIL();
        break;

      case "ps":
        // TODO: Get package names from the device and generate realistic output.
        // Dummy output will work but older versions of Chrome would lack package info.
        this._replyOKAY("dummy");
        break;

      case "cat /proc/net/unix":
        this._replyOKAY(AdbCommandHandler._simulateProcNetUnix(deviceConnection.getSockets()));
        break;

      default:
        this._replyFAIL();
    }
  },

  _createTunnel: function(deviceConnection, deviceSocketName) {
    deviceConnection.createTunnel(deviceSocketName, this._clientSocket._id, function (tunnelSocket) {
      if (!tunnelSocket) {
        this._replyFAIL();
        return;
      }
      tunnelSocket.onmessage = this._clientSocket.send.bind(this._clientSocket);
      tunnelSocket.onclose = this._clientSocket.close.bind(this._clientSocket);
      this._clientSocket.onmessage = tunnelSocket.send.bind(tunnelSocket);
      this._clientSocket.onclose = tunnelSocket.close.bind(tunnelSocket);
      this._replyOKAY();
    }.bind(this));
  },

  _replyOKAY: function(message) {
    this._reply("OKAY", message);
  },

  _replyFAIL: function() {
    this._reply("FAIL");
  },

  _reply: function(status, message) {
    var packet = status;
    if (message && message.length)
      packet += AdbCommandHandler._formatLengthMarker(message.length) + message;
    this._clientSocket.send(ByteArray.fromString(packet).buffer);
  }
};

