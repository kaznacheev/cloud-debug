var XHR = {};

XHR.HTTP_OK = 200;
XHR.HTTP_NO_RESPONSE = 204;
XHR.HTTP_ERROR_UNAUTHORIZED = 401;
XHR.HTTP_ERROR_FORBIDDEN = 403;

XHR.OAUTH_URL = "https://accounts.google.com/o/oauth2/token";

XHR.requestWithToken = function(method, url, postData, successCallback, errorCallback, token) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, url);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Authorization", "Bearer " + token);
  var requestTime = Date.now();
  xhr.onload = function() {
    var elapsed = (Date.now() - requestTime) / 1000;
    if (elapsed > 5)
      console.warn(method + ' request took ' + elapsed.toFixed(1) + 's');
    XHR._parseJSONResponse(xhr, successCallback, errorCallback);
  };
  if (postData && (typeof postData == 'object'))
    postData = JSON.stringify(postData);
  xhr.send(postData);
};

XHR.requestOAuthTokens = function(clientId, scope, authorizationCode, successCallback, errorCallback) {
  var data =
      "client_id=" + clientId +
      "&scope=" + scope +
      "&code=" + authorizationCode +
      "&redirect_uri=oob" +
      "&grant_type=authorization_code";
  XHR._requestOAuth(data, successCallback, errorCallback);
};

XHR.refreshAccessToken = function(clientId, refresh_token, successCallback, errorCallback) {
  var data =
      "client_id=" + clientId +
      "&refresh_token=" + refresh_token +
      "&grant_type=refresh_token";
  XHR._requestOAuth(data, successCallback, errorCallback);
};

XHR._requestOAuth = function(data, successCallback, errorCallback) {
  var xhr = new XMLHttpRequest();
  xhr.open("POST", XHR.OAUTH_URL);
  xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
  xhr.onload = XHR._parseJSONResponse.bind(null, xhr, successCallback, errorCallback);
  xhr.send(data);
};

XHR._parseJSONResponse = function(xhr, successCallback, errorCallback) {
  if (xhr.status == XHR.HTTP_NO_RESPONSE) {
    successCallback({});
    return;
  }

  var json;
  try {
    json = JSON.parse(xhr.response);
  } catch (e) {
    console.error('JSON parse error: ' + xhr.response);
  }

  if (xhr.status == XHR.HTTP_OK) {
    successCallback(json);
  } else if (errorCallback) {
    errorCallback(xhr.status);
  }
};
