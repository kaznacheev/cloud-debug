var VersionInfo = {};

VersionInfo.DEBUGGER_PROTOCOL = "1.1";

VersionInfo.WEBKIT_RESOLVE_URL = "http://omahaproxy.appspot.com/webkit.json?version=";

VersionInfo.request = function(callback) {
  if (VersionInfo.CACHED) {
    callback(VersionInfo.CACHED);
    return;
  }

  var userAgent = navigator.userAgent;
  var chromeMatch = userAgent.match('Chrome/(\\d+.\\d+.\\d+.\\d+)');
  if (!chromeMatch) {
    callback();
    return;
  }
  var chromeVersion = chromeMatch[0];

  try {
    var cached = JSON.parse(localStorage.VERSION_INFO);
    if (cached['Browser'] == chromeVersion) {
      callback(cached);
      return;
    }
  } catch (e) {
    delete localStorage.VERSION_INFO;
  }

  var webkitMatch = userAgent.match('AppleWebKit/(\\d+.\\d+)');
  var webkitVersion = webkitMatch[1] || '';

  function respond(omaha_response) {
    var webkitRevision = omaha_response.webkit_revision;
    var version = {
      "Browser": chromeVersion,
      "Protocol-Version": VersionInfo.DEBUGGER_PROTOCOL,
      "User-Agent": userAgent,
      "WebKit-Revision": webkitRevision,
      "WebKit-Version": webkitVersion + ' (@' + webkitRevision + ')'
    };
    VersionInfo.CACHED = version;
    localStorage.VERSION_INFO = JSON.stringify(version);
    callback(version);
  }

  var xhr = new XMLHttpRequest();
  xhr.open("GET", VersionInfo.WEBKIT_RESOLVE_URL + chromeMatch[1]);
  xhr.onload = XHR.parseJSONResponse.bind(
      null, xhr, respond, respond.bind(null, {webkit_revision: 'unknown'}));
  xhr.send();
};
