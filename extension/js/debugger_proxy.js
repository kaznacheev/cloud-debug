var DebuggerProxy = {};

DebuggerProxy.DEFAULT_SOCKET = "chrome_devtools_remote";

DebuggerProxy.FRONTEND_URL = "chrome-devtools://devtools/remote/serve_rev/@{REV}/devtools.html";

DebuggerProxy.CLOSE_SIGNAL = { type: 'close' };

DebuggerProxy._registry = {};

DebuggerProxy._pendingOutboundSignaling = {};

DebuggerProxy.start = function() {
  chrome.debugger.onDetach.addListener(DebuggerProxy.onDebuggerDetach);
  chrome.debugger.onEvent.addListener(DebuggerProxy.onDebuggerEvent);
};

DebuggerProxy.stop = function() {
  chrome.debugger.onDetach.removeListener(DebuggerProxy.onDebuggerDetach);
  chrome.debugger.onEvent.removeListener(DebuggerProxy.onDebuggerEvent);
};

DebuggerProxy.onDebuggerDetach = function(debuggee) {
  var connection = DebuggerProxy._registry[debuggee.targetId];
  if (connection)
    connection._close();
};

DebuggerProxy.onDebuggerEvent = function(debuggee, method, params) {
  var connection = DebuggerProxy._registry[debuggee.targetId];
  if (connection)
    connection._notify(method, params);
};

DebuggerProxy.processCommand = function(name, parameters, respondCallback) {
  console.log(name, parameters);

  if (name == "base._getBrowsers") {
    respondCallback({
      "_0": DebuggerProxy.DEFAULT_SOCKET
    });
    return;
  }

  function sendSimpleResponse(data) {
    respondCallback({
      "response": (typeof data == 'object' ? JSON.stringify(data) : data)
    });
  }

  if (name == "base._queryBrowser") {
    if (parameters._socket != DebuggerProxy.DEFAULT_SOCKET)
      throw "Unsupported socket: " + parameters._socket;

    if (parameters._path == "/json/version") {
      VersionInfo.request(sendSimpleResponse);
      return;
    }

    if (parameters._path == "/json" || parameters._path == "/json/list") {
      chrome.debugger.getTargets(DebuggerProxy.augmentTargetInfo.bind(null, sendSimpleResponse));
      return;
    }

    var match = parameters._path.match('/json/activate/(.+)');
    if (match) {
      DebuggerProxy.getTargetInfo(match[1], function(target) {
        chrome.tabs.update(target.tabId, {active: true});
        sendSimpleResponse('');
      });
      return;
    }

    match = parameters._path.match('/json/reload/(.+)');
    if (match) {
      DebuggerProxy.getTargetInfo(match[1], function(target) {
        chrome.tabs.reload(target.tabId);
        sendSimpleResponse('');
      });
      return;
    }

    match = parameters._path.match('/json/close/(.+)');
    if (match) {
      DebuggerProxy.getTargetInfo(match[1], function(target) {
        chrome.tabs.remove(target.tabId);
        sendSimpleResponse('');
      });
      return;
    }

    match = parameters._path.match('/json/new(\\?(.+)$)?');
    if (match) {
      var params = {};
      var url = match[2];
      if (url)
        params.url = decodeURIComponent(url);
      chrome.tabs.create(params);
      sendSimpleResponse('');
      return;
    }

    throw "Unsupported path: " + parameters._path;
  }

  if (name == "base._connect") {
    if (parameters._socket != DebuggerProxy.DEFAULT_SOCKET)
      throw "Unsupported socket " + parameters._socket;
    var id = parameters._path.split('/').pop();
    DebuggerProxy.processSignalingMessage(id, parameters._message, sendSimpleResponse);
    return;
  }

  throw "Unsupported command: " + name;
};

DebuggerProxy.getTargetInfo = function(targetId, callback) {
  chrome.debugger.getTargets(function(targets) {
    callback(targets.filter(function(target) {
      return target.id == targetId;
    })[0]);
  });
};

DebuggerProxy.augmentTargetInfo = function(respond, targets) {
  VersionInfo.request(function(versionInfo) {
    var frontendUrl = DebuggerProxy.FRONTEND_URL.replace("{REV}", versionInfo["WebKit-Revision"]);
    respond(targets.map(function(target) {
      if (!target.attached) {
        var debugPath = "webrtc/" + target.id;
        target.devtoolsFrontendUrl = frontendUrl + "?ws=" + debugPath;
        target.webSocketDebuggerUrl = "ws://" + debugPath;
      }
      return target;
    }));
  });
};

DebuggerProxy.processSignalingMessage = function(id, message, respond) {
  var serverError = console.error.bind(console, id);

  if (!message) {
    // Just polling
  } else {
    try {
      var messageList = JSON.parse(message);
      for (var i = 0; i != messageList.length; i++) {
        var connection = DebuggerProxy._registry[id];
        var messageObj = messageList[i];
        if (messageObj.type == DebuggerProxy.CLOSE_SIGNAL.type) {
          if (connection) {
            connection._close(true);
          } else {
            serverError("Cannot find the connection to close");
          }
        } else if (messageObj.type == "offer") {
          if (connection) {
            serverError("Connection already open");
            respond(JSON.stringify([DebuggerProxy.CLOSE_SIGNAL]));
            return;
          } else {
            new DebuggerProxy.Connection(id, messageObj);
          }
        } else if ('candidate' in messageObj) {
          if (connection)
            connection.addIceCandidate(messageObj);
          else
            serverError("Cannot find the connection to add ICE candidate");
        }
      }
    } catch (e) {
      serverError("Cannot parse message", message, e);
    }
  }

  if (id in DebuggerProxy._pendingOutboundSignaling) {
    respond(DebuggerProxy._pendingOutboundSignaling[id]);
    delete DebuggerProxy._pendingOutboundSignaling[id];
  } else {
    respond([]);
  }
};

DebuggerProxy._sendSignalingMessage = function(id, message) {
  var queue = DebuggerProxy._pendingOutboundSignaling[id];
  if (!queue) {
    queue = [];
    DebuggerProxy._pendingOutboundSignaling[id] = queue;
  }
  queue.push(message);
};

DebuggerProxy.Connection = function(id, offer) {
  this._logger = console;
  this._logger.info('Created DebuggerProxy', id);

  DebuggerProxy._registry[id] = this;

  this._id = id;
  this._offer = offer;

  var debuggee = {targetId: id};
  chrome.debugger.attach(
      debuggee,
      VersionInfo.DEBUGGER_PROTOCOL,
      this._onDebuggerAttached.bind(this, debuggee));

  this._pendingActions = [];
};

DebuggerProxy.Connection.prototype = {
  _close: function(opt_outside) {
    if (this._closing)
      return;
    this._closing = true;

    delete DebuggerProxy._registry[this._id];

    this._logger.info('Closing DebuggerProxy ' + this._id, opt_outside ? ' (external)' : '');
    if (!opt_outside)
      this._sendSignalingMessage(DebuggerProxy.CLOSE_SIGNAL);

    if (this._dataChannel)
      this._dataChannel.close();

    if (this._peerConnection)
      this._peerConnection.close();

    if (this._debuggee)
      chrome.debugger.detach(this._debuggee, function() {});
  },

  addIceCandidate: function(messageObj) {
    var candidate = new RTCIceCandidate(messageObj);
    if (this._peerConnection)
      this._doAddIceCandidate(candidate);
    else
      this._pendingActions.push(this._doAddIceCandidate.bind(this, candidate));
  },

  _doAddIceCandidate: function(candidate) {
    this._peerConnection.addIceCandidate(
        candidate,
        this._success("addIceCandidate"),
        this._failure("addIceCandidate"));
  },

  _sendSignalingMessage: function(message) {
    DebuggerProxy._sendSignalingMessage(this._id, message);
  },

  _onDebuggerAttached: function(debuggee) {
    if (chrome.runtime.lastError) {
      this._logger.error(chrome.runtime.lastError.message);
      this._close();
      return;
    }

    this._logger.log('Debugger attached');

    if (this._closing) {
      chrome.debugger.detach(debuggee, function() {});
      return;
    }

    this._debuggee = debuggee;

    this._peerConnection = new webkitRTCPeerConnection(null, {});
    this._peerConnection.onicecandidate = this._onIceCandidate.bind(this);
    this._peerConnection.ondatachannel = this._onDataChannel.bind(this);

    this._peerConnection.setRemoteDescription(
        new RTCSessionDescription(this._offer),
        this._success("setRemoteDescription"),
        this._failure("setRemoteDescription"));
    this._peerConnection.createAnswer(
        this._onAnswerSuccess.bind(this),
        this._failure("createAnswer"),
        {});

    this._pendingActions.forEach(function(action) { action(); });
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
      this._logger.info('Sent ICE candidate to client', event.candidate.candidate);
      this._sendSignalingMessage(event.candidate);
    } else {
      this._logger.info('End of ICE candidates.');
    }
  },

  _onDataChannel: function(event) {
    this._logger.info('Data channel created');
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
    this._logger.log('Data channel open');
    if (this._closing) {
      channel.close();
      return;
    }
    this._dataChannel = channel;
  },

  _onDataChannelClose: function()
  {
    this._logger.log('Data channel closed');
    this._dataChannel = null;
    this._close();
  },

  _onDataChannelError: function(error)
  {
    this._logger.error('Data channel error', error.toString());
    this._close();
  },

  _onDataChannelMessage: function(event)
  {
    this._logger.info("Data channel received", event.data);
    if (this._debuggee) {
      var messageObj = JSON.parse(event.data);
      chrome.debugger.sendCommand(
          this._debuggee,
          messageObj.method,
          messageObj.params,
          this._onDebuggerCommandResponse.bind(this, messageObj.id));
    }
  },

  _onDebuggerCommandResponse: function(id, result)
  {
    if (this._dataChannel)
      this._dataChannel.send(JSON.stringify({id: id, result: result }));
  },

  _notify: function(method, params) {
    if (!this._dataChannel)
      return;
    var message = { method: method };
    if (params)
      message.params = params;
    this._dataChannel.send(JSON.stringify(message));
  },

  _success: function(message) {
    return this._logger.info.bind(this._logger, message + ' OK');
  },
  
  _failure: function(message) {
    return this._logger.error.bind(this._logger, message + ' FAILED');
  },

  __proto__: Object.prototype
};
