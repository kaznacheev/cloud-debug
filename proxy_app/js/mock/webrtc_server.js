function WebRTCServerConnection(offer, sendSignalingFunc) {
  this._logger = console;
  this._logger.info('Server connection created');

  this._sendSignalingMessage = sendSignalingFunc;

  this._peerConnection = new webkitRTCPeerConnection(null, {});
  this._peerConnection.onicecandidate = this._onIceCandidate.bind(this);
  this._peerConnection.ondatachannel = this._onDataChannel.bind(this);

  this._peerConnection.setRemoteDescription(
      new RTCSessionDescription(offer),
      this._success("setRemoteDescription"),
      this._failure("setRemoteDescription"));

  this._peerConnection.createAnswer(
      this._onAnswerSuccess.bind(this),
      this._failure("createAnswer"),
      {});
}

WebRTCServerConnection.CLOSE_SIGNAL = { type: 'close' };

WebRTCServerConnection.prototype = {
  close: function() {
    if (this._closing)
      return;
    this._closing = true;

    this._sendSignalingMessage(WebRTCServerConnection.CLOSE_SIGNAL);

    if (this.onclose)
      this.onclose();

    if (this._dataChannel)
      this._dataChannel.close();

    if (this._peerConnection)
      this._peerConnection.close();
  },

  send: function(data) {
    if (this._dataChannel)
      this._dataChannel.send(data);
  },

  addIceCandidate: function(messageObj) {
    this._peerConnection.addIceCandidate(
        new RTCIceCandidate(messageObj),
        this._success("addIceCandidate"),
        this._failure("addIceCandidate"));
  },

  _onAnswerSuccess: function(answer) {
    this._logger.info("createAnswer OK");
    if (this._closing)
      return;
    this._peerConnection.setLocalDescription(
        answer,
        this._success("setLocalDescription"),
        this._failure("setLocalDescription"));
    this._sendSignalingMessage(answer);
  },

  _onIceCandidate: function(event) {
    if (this._closing)
      return;
    if (event.candidate) {
      this._logger.info('Server sent ICE candidate to client', event.candidate.candidate);
      this._sendSignalingMessage(event.candidate);
    } else {
      this._logger.info('Server received the last ICE candidate.');
    }
  },

  _onDataChannel: function(event) {
    this._logger.info('Server data channel created');
    if (this._closing)
      return;
    var channel = event.channel;
    channel.onopen = this._onDataChannelOpen.bind(this, channel);
    channel.onclose = this._onDataChannelClose.bind(this);
    channel.onerror = this._onDataChannelError.bind(this);
    channel.onmessage = this._onDataChannelMessage.bind(this);
  },

  _onDataChannelOpen: function(channel)
  {
    this._logger.log('Server data channel open');
    if (this._closing) {
      channel.close();
      return;
    }
    this._dataChannel = channel;
  },

  _onDataChannelClose: function()
  {
    this._logger.log('Server data channel closed');
    this._dataChannel = null;
    this.close();
  },

  _onDataChannelError: function(error)
  {
    this._logger.error('Server data channel error', error.toString());
    this.close();
  },

  _onDataChannelMessage: function(event)
  {
    this._logger.info("Server data channel received", event.data);
    if (this.onmessage)
      this.onmessage(event.data);
  },

  _success: function(message) {
    return this._logger.info.bind(this._logger, message + ' OK');
  },

  _failure: function(message) {
    return this._logger.error.bind(this._logger, message + ' FAILED');
  },

  __proto__: Object.prototype
};
