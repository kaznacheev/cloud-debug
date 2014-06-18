FRONTEND_PROXY_URL = 'http://localhost:8002/';

function load() {
  var match = location.search && location.search.match('deviceId=(.+)&socket=(.+)&target=(.+)&frontend=(.+)');
  if (!match) {
    document.body.textContent = 'Malformed URL';
    return;
  }
  var deviceId = match[1];
  var socket = match[2];
  var target = match[3];
  var frontendUrl = decodeURIComponent(match[4]);

  var connection = new WebRTCConnection(deviceId, socket, target);
  connection.onopen = openFrontend.bind(null, connection, frontendUrl);
}

function openFrontend(connection, frontendUrl) {
  var frontendPath = frontendUrl.match('serve_rev/@(.*)$')[1];
  frontendUrl = FRONTEND_PROXY_URL + frontendPath;

  var iframe = document.querySelector('iframe');
  iframe.setAttribute('src', frontendUrl);

  window.addEventListener('beforeunload', function() {
    connection.sendRTCSignalingMessage({type: 'close'});
    connection.close();
  });

  connection.onmessage = function(message) {
    iframe.contentWindow.postMessage(message, '*');
  };

  window.addEventListener('message', function(event) {
    connection.sendMessage(event.data);
  });
}

function WebRTCConnection(deviceId, socket, path)
{
  this._deviceId = deviceId;
  this._socket = socket;
  this._path = path;
  var servers = null;
  this._peerConnection = new webkitRTCPeerConnection(servers, {});
  this._peerConnection.onicecandidate = this._onIceCandidate.bind(this);

  var dataChannel = this._peerConnection.createDataChannel("devtools");
  dataChannel.onopen = this._onDataChannelOpen.bind(this, dataChannel);
  dataChannel.onclose = this._onDataChannelClose.bind(this);
  dataChannel.onerror = this._onDataChannelError.bind(this);
  dataChannel.onmessage = this._onDataChannelMessage.bind(this);

  this._peerConnection.createOffer(this._onOfferSuccess.bind(this), this._onOfferError.bind(this));

  this._bufferedMessages = [];

  this._timeout = setInterval(this.sendRTCSignalingMessage.bind(this, ''), 2000);
}

WebRTCConnection.prototype = {
  _close: function()
  {
    if (this._closing)
      return;
    this._closing = true;

    clearInterval(this._timeout);

    if (this._dataChannel) {
      this._dataChannel.close();
      this._dataChannel = null;
    }
    if (this._peerConnection) {
      this._peerConnection.close();
      this._peerConnection = null;
    }
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
    this._close();
  },

  _onIceCandidate: function(event)
  {
    if (this._closing)
      return;
    if (event.candidate) {
      this._sendSignalingMessage(event.candidate);
    } else {
      // End of ICE candidates
      this.sendRTCSignalingMessage(JSON.stringify(this._bufferedMessages));
      delete this._bufferedMessages;
    }
  },

  _onDataChannelOpen: function(channel)
  {
    console.info("Data channel open");
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
    this._dataChannel = null;
    if (this.onclose)
      this.onclose();
    this._close();
  },

  _onDataChannelError: function()
  {
    if (this.onerror)
      this.onerror();
    if (this.onclose)
      this.onclose();
    this._close();
  },

  _onDataChannelMessage: function(event)
  {
    var data = /** @type {string} */ (event.data);
    if (this.onmessage)
      this.onmessage(data);
  },

  sendMessage: function(message)
  {
    if (!this._dataChannel)
      return;
    this._dataChannel.send(message);
  },

  _sendSignalingMessage: function(messageObject)
  {
    if (this._bufferedMessages)
      this._bufferedMessages.push(messageObject);
    else
      this.sendRTCSignalingMessage(JSON.stringify([messageObject]));
  },

  sendRTCSignalingMessage: function(message) {
    if (this._closing)
      return;
    chrome.extension.getBackgroundPage().User.sendCommand(
        this._deviceId,
        "base._connect",
        {
          '_socket': this._socket,
          '_path': this._path,
          '_message': message
        },
        function(response) {
          this._processSignalingMessages(response.results._response);
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
      console.error("Invalid signaling message: ", message, e);
      return;
    }
    messageList.forEach(this._processSignalingMessage.bind(this));
  },

  _processSignalingMessage: function(messageObject)
  {
    console.log('Incoming signaling:', JSON.stringify(messageObject));

    if (messageObject.type == "close") {
      this._close();
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


document.addEventListener('DOMContentLoaded', load);