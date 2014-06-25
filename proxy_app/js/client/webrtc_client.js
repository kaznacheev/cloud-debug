function WebRTCSocket(name) {
  this._logPrefix = name + ' RTC socket:';
  console.info(this._logPrefix, 'Created');
}

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
    console.info(this._logPrefix, 'Destroyed');

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
    console.debug(this._logPrefix, 'Data channel sent ' + data.byteLength + ' bytes');
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

  _onIceCandidate: function(event)
  {
    if (this._closing)
      return;
    if (event.candidate)
      console.debug(this._logPrefix, 'Sent ICE candidate to peer', event.candidate.candidate);
    else
      console.debug(this._logPrefix, 'Received the last ICE candidate.');
    this._sendSignaling(event.candidate);
  },

  _sendSignaling: function(messageObject) {
    if (this.onoutboundsignaling)
      this.onoutboundsignaling(messageObject);
  },

  _onIceConnectionState: function(event) {
    console.info(this._logPrefix, 'ICE connection state', event.currentTarget.iceConnectionState);
  },

  _onError: function(context, error) {
    console.error(this._logPrefix, context + ' error', error.toString());
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onDataChannelOpen: function() {
    console.info(this._logPrefix, 'Data channel open');
    if (this._closing) {
      this._dataChannel.close();
      return;
    }
    if (this.onopen)
      this.onopen();
  },

  _onDataChannelClose: function() {
    console.info(this._logPrefix, 'Data channel closed');
    this._dataChannel = null;
    this.close();
  },

  _onDataChannelError: function(error) {
    console.error(this._logPrefix, 'Data channel error', error.toString());
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onDataChannelMessage: function(event) {
    console.debug(this._logPrefix, 'Data channel received ' + event.data.byteLength + ' bytes');
    if (this.onmessage)
      this.onmessage(event.data);
  },

  _success: function(message) {
    return console.debug.bind(console, this._logPrefix, message + ' OK');
  },

  _failure: function(message) {
    return console.error.bind(console, this._logPrefix, message + ' FAILED');
  }
};

function WebRTCClientSocket() {
  WebRTCSocket.call(this, 'Client');
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
      console.error(this._socket._logPrefix, "Cannot parse signaling messages: ", message, e);
      return;
    }
    try {
      for (var i = 0; i != messageObjects.length; ++i) {
        var messageObject = messageObjects[i];
        console.debug(this._socket._logPrefix, 'Incoming signaling:', JSON.stringify(messageObject));
        if (messageObject.type == "close") {
          this._socket.close();
          return;
        } else if (messageObject.type == "answer") {
          this._socket.setRemoteDescription(messageObject);
        } else if ("candidate" in messageObject) {
          this._socket.addIceCandidate(messageObject);
        } else {
          console.error(this._socket._logPrefix, "Unexpected signaling message", JSON.stringify(messageObject));
        }
      }
    } catch (e) {
      console.error(this._socket._logPrefix, "Error while processing: ", message, e.stack);
    }
  },

  _onSignalingError: function() {
    console.warn(this._socket._logPrefix, 'signaling not processed by the server');
    this._socket.close();
  }
};