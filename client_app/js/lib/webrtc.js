function WebRTCSocket() {}

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
    
    this.log("Connecting");
  },

  close: function () {
    if (this._closing)
      return;
    this._closing = true;
    this.log('Closed');

    if (this.onclose)
      this.onclose();

    this._clearConnectTimeout();
    this._dataChannel.close();
    this._peerConnection.close();
  },

  send: function(data) {
    if (this._dataChannel.readyState != 'open') {
      this.error('Data channel cannot send in state ' + this._dataChannel.readyState);
      return;
    }
    this.debug('Data channel sent ' + data.byteLength + ' bytes');
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
      this.debug('Sent ICE candidate to peer', event.candidate.candidate);
      this._sendSignaling(event.candidate);
    } else {
      this.debug('Received the last ICE candidate.');
    }
  },

  _sendSignaling: function(messageObject) {
    if (this.onoutboundsignaling)
      this.onoutboundsignaling(messageObject);
  },

  _onIceConnectionState: function(event) {
    this.log('ICE connection state: ' + this._peerConnection.iceConnectionState);
    switch(this._peerConnection.iceConnectionState) {
      case 'closed':
      case 'failed':
      case 'disconnected':
        this.close();
        break;
    }
  },

  _onError: function(context, error) {
    this.error(context, error.toString());
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onConnectTimeout: function() {
    this.log('Connect timed out');
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
    this.log('Data channel open (' + ((Date.now() - this._connectTimestamp) / 1000).toFixed(1) + 's)');
    this._clearConnectTimeout();
    if (this._closing) {
      this._dataChannel.close();
      return;
    }
    if (this.onopen)
      this.onopen();
  },

  _onDataChannelClose: function() {
    this.log('Data channel closed');
    this.close();
  },

  _onDataChannelError: function(error) {
    this.error('Data channel error', error.toString());
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onDataChannelMessage: function(event) {
    var data = event.data;
    this.debug('Data channel received ' + data.byteLength + ' bytes');
    if (this.onmessage)
      this.onmessage(data);
  },

  _success: function(message) {
    return this.debug.bind(this, message + ' OK');
  },

  _failure: function(message) {
    return this.error.bind(this, message + ' FAILED');
  }
};

function WebRTCClientSocket(name) {
  WebRTCSocket.call(this);
  Logger.install(this, WebRTCClientSocket, name);
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
      this._socket.debug('Queued ' + this._buffer.length + ' signaling messages');
      return;
    }
    this._exchangeInProgress = true;

    this._socket.debug('Sent ' + this._buffer.length + ' signaling messages');
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
      this._socket.error("Cannot parse signaling messages: ", message, e);
      return;
    }
    try {
      for (var i = 0; i != messageObjects.length; ++i) {
        var messageObject = messageObjects[i];
        this._socket.debug('Incoming signaling:', JSON.stringify(messageObject));
        if (messageObject.type == "answer") {
          this._socket.setRemoteDescription(messageObject);
        } else if ("candidate" in messageObject) {
          this._socket.addIceCandidate(messageObject);
        } else {
          this._socket.error("Unexpected signaling message", JSON.stringify(messageObject));
        }
      }
    } catch (e) {
      this._socket.error("Error while processing: ", message, e.stack);
    }
  },

  _onSignalingError: function() {
    this._exchangeInProgress = false;
    this._socket.debug('Signaling not processed by the server');
    this._socket.close();
  }
};

function WebRTCServerSocket() {
  WebRTCSocket.call(this);
  Logger.install(this, WebRTCServerSocket);
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
  Logger.install(this, "WebRTCServerSocket.SignalingHandler");
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

  processIncoming: function(message) {
    var response = [];
    if (!message) {
      // Just polling
    } else {
      var messageObjects;
      try {
        messageObjects = JSON.parse(message);
      } catch (e) {
        this.error("Cannot parse message", message, e);
        return response;
      }
      try {
        for (var i = 0; i != messageObjects.length; i++) {
          var messageObj = messageObjects[i];
          this.debug("Incoming signaling:", JSON.stringify(messageObj));

          if (messageObj.iceServers) {
            if (this._webrtcConnection) {
              this.error("Connection already exists (ICE config)");
              return response;
            }
            this._iceServersConfig = messageObj;
          } else if (messageObj.type == "offer") {
            if (this._webrtcConnection) {
              this.error("Connection already exists (offer)");
              return response;
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
              this.error("Cannot find the connection to add ICE candidate");
          } else {
            this.error("Unknown message: " + JSON.stringify(messageObj));
          }
        }
      } catch (e) {
        this.error("Exception while processing", message, e.stack);
        return response;
      }
    }
    response = this._buffer;
    this._buffer = [];
    return response;
  },

  _enqueue: function(messageObject) {
    this._buffer.push(messageObject);
  },

  _onConnectionClosed: function() {
    delete this._webrtcConnection;
    this._buffer = [];
  }
};