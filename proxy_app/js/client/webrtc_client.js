function WebRTCClientConnection(serverConfig, signalingFunc)
{
//  serverConfig = null;
  this._signalingFunc = signalingFunc;
  this._peerConnection = new webkitRTCPeerConnection(serverConfig, {});
  this._peerConnection.onicecandidate = this._onIceCandidate.bind(this);

  var dataChannel = this._peerConnection.createDataChannel("devtools");
  dataChannel.onopen = this._onDataChannelOpen.bind(this, dataChannel);
  dataChannel.onclose = this._onDataChannelClose.bind(this);
  dataChannel.onerror = this._onDataChannelError.bind(this);
  dataChannel.onmessage = this._onDataChannelMessage.bind(this);

  this._peerConnection.createOffer(this._onOfferSuccess.bind(this), this._onOfferError.bind(this));

  this._bufferedSignaling = [];

  this._interval = setInterval(this._doSendSignalingMessage.bind(this, ''), 1000);
}

WebRTCClientConnection.prototype = {
  close: function()
  {
    if (this._closing)
      return;
    this._closing = true;

    if (this.onclose)
      this.onclose();
    
    clearInterval(this._interval);

    if (this._dataChannel) {
      this._dataChannel.close();
      this._dataChannel = null;
    }
    if (this._peerConnection) {
      this._peerConnection.close();
      this._peerConnection = null;
    }
  },

  send: function(message)
  {
    if (!this._dataChannel)
      return;
    this._dataChannel.send(message);
  },

  _onOfferSuccess: function(offer)
  {
    if (this._closing)
      return;
    this._peerConnection.setLocalDescription(offer);
    this._sendSignalingMessage(offer);
  },

  _onOfferError: function(error)
  {
    console.error("createOffer error", error);
    this.close();
  },

  _onIceCandidate: function(event)
  {
    if (this._closing)
      return;
    if (event.candidate) {
      this._sendSignalingMessage(event.candidate);
    } else {
      // End of ICE candidates
      this._doSendSignalingMessage(JSON.stringify(this._bufferedSignaling));
      delete this._bufferedSignaling;
    }
  },

  _onDataChannelOpen: function(channel)
  {
    console.info("Client data channel open");
    if (this._closing) {
      channel.close();
      return;
    }
    this._dataChannel = channel;
    if (this.onopen)
      this.onopen();
  },

  _onDataChannelClose: function()
  {
    console.info("Client data channel close");
    this._dataChannel = null;
    this.close();
  },

  _onDataChannelError: function()
  {
    console.info("Client data channel error");
    if (this.onerror)
      this.onerror();
    this.close();
  },

  _onDataChannelMessage: function(event)
  {
    var data = /** @type {string} */ (event.data);
    if (this.onmessage)
      this.onmessage(data);
  },

  _sendSignalingMessage: function(messageObject)
  {
    if (this._bufferedSignaling)
      this._bufferedSignaling.push(messageObject);
    else
      this._doSendSignalingMessage(JSON.stringify([messageObject]));
  },

  _doSendSignalingMessage: function(message) {
    if (this._closing)
      return;
    this._signalingFunc(
        message,
        function(response) {
          this._processSignalingMessages(response);
        }.bind(this));
  },

  _processSignalingMessages: function(message)
  {
    if (this._closing)
      return;
    if (!message)
      return;
    var messageList;
    try {
      messageList = JSON.parse(message);
    } catch (e) {
      console.error("Client cannot parse signaling messages: ", message, e);
      return;
    }
    messageList.forEach(this._processSignalingMessage.bind(this));
  },

  _processSignalingMessage: function(messageObject)
  {
    console.log('Client received signaling:', JSON.stringify(messageObject));

    if (messageObject.type == "close") {
      this.close();
    } else if (messageObject.type == "answer") {
      this._peerConnection.setRemoteDescription(new RTCSessionDescription(messageObject));
    } else if ("candidate" in messageObject) {
      this._peerConnection.addIceCandidate(new RTCIceCandidate(messageObject));
    } else {
      console.error("Unexpected signaling message", JSON.stringify(messageObject));
    }
  },

  __proto__: Object.prototype
};
