function WebRTCSocket(name) {
  var logPrefix = name + ':';
  this._logInfo = console.info.bind(console, logPrefix);
  this._logError = console.error.bind(console, logPrefix);

  if (WebRTCSocket.debug)
    this._logDebug = console.debug.bind(console, logPrefix);
  else
    this._logDebug = function() {};

  this._logInfo('Created');

  this._status = {};
}

WebRTCSocket.debug = false;

WebRTCSocket.CLOSE_SIGNAL = { type: 'close' };

WebRTCSocket.prototype = {
  connect: function(serverConfig) {
    this._peerConnection = new webkitRTCPeerConnection(serverConfig, {});
    this._peerConnection.onicecandidate = this._onIceCandidate.bind(this);
    this._peerConnection.oniceconnectionstatechange = this._onIceConnectionState.bind(this);

    this._dataChannel = this._peerConnection.createDataChannel("devtools", {negotiated: true, id: 1});
    this._dataChannel.onopen = this._onDataChannelOpen.bind(this);
    this._dataChannel.onclose = this._onDataChannelClose.bind(this);
    this._dataChannel.onerror = this._onDataChannelError.bind(this);
    this._dataChannel.onmessage = this._onDataChannelMessage.bind(this);
  },

  close: function () {
    if (this._closing)
      return;
    this._closing = true;
    this._logInfo('Destroyed');

    if (this.onclose)
      this.onclose();

    if (this._dataChannel)
      this._dataChannel.close();

    if (this._peerConnection)
      this._peerConnection.close();
  },

  send: function(data) {
    if (!this._dataChannel)
      return;
    if (this._dataChannel.readyState != 'open') {
      this._logError('Data channel cannot send in state ' + this._dataChannel.readyState);
      return;
    }
    this._logDebug('Data channel sent ' + data.byteLength + ' bytes');
    this._status.sent += data.byteLength;
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
    if (this._peerConnection)
      this._status.ice = this._peerConnection.iceConnectionState;
    if (this._dataChannel)
      this._status.data =  this._dataChannel.readyState;
    return this._status;
  },

  _onIceCandidate: function(event)
  {
    if (this._closing)
      return;
    if (event.candidate)
      this._logDebug('Sent ICE candidate to peer', event.candidate.candidate);
    else
      this._logDebug('Received the last ICE candidate.');
    this._sendSignaling(event.candidate);
  },

  _sendSignaling: function(messageObject) {
    if (this.onoutboundsignaling)
      this.onoutboundsignaling(messageObject);
  },

  _onIceConnectionState: function(event) {
    this._logInfo('ICE connection state: ' + event.currentTarget.iceConnectionState);
    this._status.ice = this._peerConnection.iceConnectionState;
    if (this._peerConnection.iceConnectionState == 'disconnected')
      this._peerConnection = null;
  },

  _onError: function(context, error) {
    this._logError(context, error.toString());
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onDataChannelOpen: function() {
    this._logInfo('Data channel open');
    if (this._closing) {
      this._dataChannel.close();
      return;
    }
    this._status.sent = 0;
    this._status.received = 0;
    if (this.onopen)
      this.onopen();
  },

  _onDataChannelClose: function() {
    this._logInfo('Data channel closed');
    this._status.data = this._dataChannel.readyState;
    this._dataChannel = null;
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
    this._status.received += data.byteLength;
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
  sendCloseSignal: function()  {
    this._exchangeSignalingFunc(JSON.stringify([WebRTCSocket.CLOSE_SIGNAL]));
  },

  enqueue: function(messageObject) {
    if (this._buffer) {
      if (messageObject) {
        this._buffer.push(messageObject);
      } else {
        this._exchangeSignaling(JSON.stringify(this._buffer));
        delete this._buffer;
      }
    } else if (messageObject) {
      this._exchangeSignaling(JSON.stringify([messageObject]));
    }
  },

  poll: function() {
    if (!this._buffer)
      this._exchangeSignaling('');
  },

  _exchangeSignaling: function(message) {
    this._exchangeSignalingFunc(
        message,
        this._onSignalingResponse.bind(this),
        this._onSignalingError.bind(this));
  },

  _onSignalingResponse: function(message) {
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
        if (messageObject.type == "close") {
          this._socket.close();
          return;
        } else if (messageObject.type == "answer") {
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
    this._socket._logInfo('Signaling not processed by the server');
    this._socket.close();
  }
};