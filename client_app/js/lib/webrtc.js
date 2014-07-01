function WebRTCSocket(name) {
  var logPrefix = name + ':';
  this._logInfo = console.info.bind(console, logPrefix);
  this._logError = console.error.bind(console, logPrefix);

  if (WebRTCSocket.debug)
    this._logDebug = console.debug.bind(console, logPrefix);
  else
    this._logDebug = function() {};

  this._logInfo('Created');
}

WebRTCSocket.debug = false;

WebRTCSocket.DEFAULT_CONNECT_TIMEOUT = 10000;

WebRTCSocket.prototype = {
  connect: function(serverConfig, opt_timeout) {
    this._peerConnection = new webkitRTCPeerConnection(serverConfig, {});
    this._peerConnection.onicecandidate = this._onIceCandidate.bind(this);
    this._peerConnection.oniceconnectionstatechange = this._onIceConnectionState.bind(this);

    this._dataChannel = this._peerConnection.createDataChannel("devtools", {negotiated: true, id: 1});
    this._dataChannel.onopen = this._onDataChannelOpen.bind(this);
    this._dataChannel.onclose = this._onDataChannelClose.bind(this);
    this._dataChannel.onerror = this._onDataChannelError.bind(this);
    this._dataChannel.onmessage = this._onDataChannelMessage.bind(this);

    this._connectTimestamp = Date.now();
    this._connectTimeout = setTimeout(
        this._onConnectTimeout.bind(this),
        opt_timeout || WebRTCSocket.DEFAULT_CONNECT_TIMEOUT);
  },

  close: function () {
    if (this._closing)
      return;
    this._closing = true;
    this._logInfo('Destroyed');

    if (this.onclose)
      this.onclose();

    this._clearConnectTimeout();
    this._dataChannel.close();
    this._peerConnection.close();
  },

  send: function(data) {
    if (this._dataChannel.readyState != 'open') {
      this._logError('Data channel cannot send in state ' + this._dataChannel.readyState);
      return;
    }
    this._logDebug('Data channel sent ' + data.byteLength + ' bytes');
    this._dataChannel.send(data);
  },

  setRemoteDescription: function(description) {
    if (this._closing)
      return;
    this._peerConnection.setRemoteDescription(
        new RTCSessionDescription(description),
        this._success("setRemoteDescription"),
        this._failure("setRemoteDescription"));
  },

  setLocalDescription: function(description) {
    if (this._closing)
      return;
    this._peerConnection.setLocalDescription(
        description,
        this._success("setLocalDescription"),
        this._failure("setLocalDescription"));
    this._sendSignaling(description);
  },

  addIceCandidate: function(messageObj) {
    if (this._closing)
      return;
    this._peerConnection.addIceCandidate(
        new RTCIceCandidate(messageObj),
        this._success("addIceCandidate"),
        this._failure("addIceCandidate"));
  },

  getStatus: function() {
    return {
        ice: this._peerConnection.iceConnectionState,
        data: this._dataChannel.readyState
    };
  },

  _onIceCandidate: function(event)
  {
    if (this._closing)
      return;
    if (event.candidate) {
      this._logDebug('Sent ICE candidate to peer', event.candidate.candidate);
      this._sendSignaling(event.candidate);
    } else {
      this._logDebug('Received the last ICE candidate.');
    }
  },

  _sendSignaling: function(messageObject) {
    if (this.onoutboundsignaling)
      this.onoutboundsignaling(messageObject);
  },

  _onIceConnectionState: function(event) {
    this._logInfo('ICE connection state: ' + this._peerConnection.iceConnectionState);
    switch(this._peerConnection.iceConnectionState) {
      case 'closed':
      case 'failed':
      case 'disconnected':
        this.close();
        break;
    }
  },

  _onError: function(context, error) {
    this._logError(context, error.toString());
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onConnectTimeout: function() {
    this._logInfo('Connect timed out');
    this._connectTimeout = null;
    this.close();
  },

  _clearConnectTimeout: function() {
    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
    }
  },

  _onDataChannelOpen: function() {
    this._logInfo('Data channel open (' + ((Date.now() - this._connectTimestamp) / 1000).toFixed(1) + 's)');
    this._clearConnectTimeout();
    if (this._closing) {
      this._dataChannel.close();
      return;
    }
    if (this.onopen)
      this.onopen();
  },

  _onDataChannelClose: function() {
    this._logInfo('Data channel closed');
    this.close();
  },

  _onDataChannelError: function(error) {
    this._logError('Data channel error', error.toString());
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onDataChannelMessage: function(event) {
    var data = event.data;
    this._logDebug('Data channel received ' + data.byteLength + ' bytes');
    if (this.onmessage)
      this.onmessage(data);
  },

  _success: function(message) {
    return this._logDebug.bind(null, message + ' OK');
  },

  _failure: function(message) {
    return this._logError.bind(null, message + ' FAILED');
  }
};

function WebRTCClientSocket(name) {
  WebRTCSocket.call(this, name);
}

WebRTCClientSocket.prototype = {
  connect: function(serverConfig) {
    WebRTCSocket.prototype.connect.call(this, serverConfig);

    if (serverConfig)
      this._sendSignaling(serverConfig);

    this._peerConnection.createOffer(
        this.setLocalDescription.bind(this),
        this._onError.bind(this, "createOffer"));
  },

  __proto__: WebRTCSocket.prototype
};


WebRTCClientSocket.SignalingHandler = function(socket, exchangeSignalingFunc) {
  this._socket = socket;
  this._socket.onoutboundsignaling = this.enqueue.bind(this);

  this._exchangeSignalingFunc = exchangeSignalingFunc;
  this._buffer = [];
};

WebRTCClientSocket.SignalingHandler.prototype = {
  stop: function() {
    if (this._delayedPollTimeout) {
      clearTimeout(this._delayedPollTimeout);
      this._delayedPollTimeout = null;
    }
  },

  enqueue: function(messageObject) {
    this._buffer.push(messageObject);

    if (!this._delayedPollTimeout)
      this._delayedPollTimeout = setTimeout(function() {
        this._delayedPollTimeout = null;
        if (this._buffer.length)
          this.poll();
      }.bind(this),
      300);
  },

  poll: function() {
    if (this._exchangeInProgress) {
      this._socket._logDebug('Queued ' + this._buffer.length + ' signaling messages');
      return;
    }
    this._exchangeInProgress = true;

    this._socket._logDebug('Sent ' + this._buffer.length + ' signaling messages');
    this._exchangeSignalingFunc(
        JSON.stringify(this._buffer),
        this._onSignalingResponse.bind(this),
        this._onSignalingError.bind(this));
    this._buffer = [];
  },

  _onSignalingResponse: function(message) {
    this._exchangeInProgress = false;
    var messageObjects;
    try {
      messageObjects = JSON.parse(message);
    } catch (e) {
      this._socket._logError("Cannot parse signaling messages: ", message, e);
      return;
    }
    try {
      for (var i = 0; i != messageObjects.length; ++i) {
        var messageObject = messageObjects[i];
        this._socket._logDebug('Incoming signaling:', JSON.stringify(messageObject));
        if (messageObject.type == "answer") {
          this._socket.setRemoteDescription(messageObject);
        } else if ("candidate" in messageObject) {
          this._socket.addIceCandidate(messageObject);
        } else {
          this._socket._logError("Unexpected signaling message", JSON.stringify(messageObject));
        }
      }
    } catch (e) {
      this._socket._logError("Error while processing: ", message, e.stack);
    }
  },

  _onSignalingError: function() {
    this._exchangeInProgress = false;
    this._socket._logInfo('Signaling not processed by the server');
    this._socket.close();
  }
};

function WebRTCServerSocket() {
  WebRTCSocket.call(this, 'Server');
}

WebRTCServerSocket.prototype = {
  connect: function(serverConfig, offer) {
    WebRTCSocket.prototype.connect.call(this, serverConfig);

    this.setRemoteDescription(offer);

    this._peerConnection.createAnswer(
        this.setLocalDescription.bind(this),
        this._onError.bind(this, "createAnswer"),
        {});
  },

  __proto__: WebRTCSocket.prototype
};

WebRTCServerSocket.SignalingHandler = function() {
  this._buffer = [];
};

WebRTCServerSocket.SignalingHandler.prototype = {
  stop: function() {
    if (this._webrtcConnection)
      this._webrtcConnection.close();
    this._buffer = [];
  },

  hasPendingSignaling: function() {
    return !!this._buffer.length;
  },

  processIncoming: function(message, respondFunc) {
    var serverError = console.error.bind(console, "Server signaling:");

    if (!message) {
      // Just polling
    } else {
      var messageObjects;
      try {
        messageObjects = JSON.parse(message);
      } catch (e) {
        serverError("Cannot parse message", message, e);
        respondFunc([]);
        return;
      }
      try {
        for (var i = 0; i != messageObjects.length; i++) {
          var messageObj = messageObjects[i];
          if (WebRTCSocket.debug)
            console.debug("Server signaling: received", JSON.stringify(messageObj));

          if (messageObj.iceServers) {
            if (this._webrtcConnection) {
              serverError("Connection already exists");
              respondFunc([]);
              return;
            }
            this._iceServersConfig = messageObj;
          } else if (messageObj.type == "offer") {
            if (this._webrtcConnection) {
              serverError("Connection already exists");
              respondFunc([]);
              return;
            }
            this._webrtcConnection = new WebRTCServerSocket();
            this._webrtcConnection.onclose = this._onConnectionClosed.bind(this);
            this._webrtcConnection.onoutboundsignaling = this._enqueue.bind(this);
            this._webrtcConnection.connect(this._iceServersConfig, messageObj);
            delete this._iceServersConfig;
            this.onaccept(this._webrtcConnection);
          } else if ('candidate' in messageObj) {
            if (this._webrtcConnection)
              this._webrtcConnection.addIceCandidate(messageObj);
            else
              serverError("Cannot find the connection to add ICE candidate");
          } else {
            serverError("Unknown signaling message: " + JSON.stringify(messageObj));
          }
        }
      } catch (e) {
        serverError("Exception while processing", message, e.stack);
        respondFunc([]);
        return;
      }
    }
    respondFunc(this._buffer);
    this._buffer = [];
  },

  _enqueue: function(messageObject) {
    this._buffer.push(messageObject);
  },

  _onConnectionClosed: function() {
    delete this._webrtcConnection;
    this._buffer = [];
  }
};