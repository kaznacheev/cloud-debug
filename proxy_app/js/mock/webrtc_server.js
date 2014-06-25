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
          console.debug("Server signaling: received", JSON.stringify(messageObj));

          if (messageObj.iceServers) {
            this._iceServersConfig = messageObj;
          } else if (messageObj.type == "offer") {
            if (this._webrtcConnection) {
              serverError("Connection already exists");
              respondFunc([WebRTCSocket.CLOSE_SIGNAL]);
              return;
            } else {
              this._webrtcConnection = new WebRTCServerSocket();
              this._webrtcConnection.onclose = this._onConnectionClosed.bind(this, true);
              this._webrtcConnection.onoutboundsignaling = this._enqueue.bind(this);
              this._webrtcConnection.connect(this._iceServersConfig, messageObj);
              delete this._iceServersConfig;
              this.onaccept(this._webrtcConnection);
            }
          } else if (messageObj.type == WebRTCSocket.CLOSE_SIGNAL.type) {
            if (this._webrtcConnection) {
              this._webrtcConnection.onclose = this._onConnectionClosed.bind(this, false);
              this._webrtcConnection.close();
              this._buffer = [];  // Erase obsolete messages.
            } else {
              serverError("Cannot find the connection to close");
            }
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
    if (messageObject)
      this._buffer.push(messageObject);
  },

  _onConnectionClosed: function(sendCloseSignal) {
    if (sendCloseSignal)
      this._enqueue(WebRTCServerSocket.CLOSE_SIGNAL);
    delete this._webrtcConnection;
    this.onclose();
  }
};