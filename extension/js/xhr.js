var HTTP_OK = 200;
var HTTP_NO_RESPONSE = 204;
var HTTP_ERROR_UNAUTHORIZED = 401;
var HTTP_ERROR_FORBIDDEN = 403;

var XHR = {};

XHR.OAUTH_URL = "https://accounts.google.com/o/oauth2/token";

XHR.GCD_URL = "https://www-googleapis-staging.sandbox.google.com/clouddevices/v1/";

XHR.GCD_UI_URL = "https://gcd-staging.sandbox.google.com/clouddevices";

XHR.getCloudDevicesUrl = function(path) {
  return XHR.GCD_URL + path;
};

XHR.parseJSONResponse = function(xhr, successCallback, errorCallback) {
  if (xhr.status == HTTP_NO_RESPONSE) {
    successCallback({});
    return;
  }

  var json;
  try {
    json = JSON.parse(xhr.response);
  } catch (e) {
    console.error('JSON parse error: ' + xhr.response);
  }

  if (xhr.status == HTTP_OK) {
    successCallback(json);
  } else {
    errorCallback(xhr.status);
  }
};

XHR.requestAuthorized = function(getTokenFunc, refreshTokenFunc, method, url, postData, successCallback, errorCallback) {
  var doRequest = XHR._requestWithToken.bind(null, method, url, postData, successCallback);

  var onError;
  if (refreshTokenFunc)
      onError = function(status) {
      if (status == HTTP_ERROR_UNAUTHORIZED || status == HTTP_ERROR_FORBIDDEN)
        refreshTokenFunc(doRequest.bind(null, errorCallback));
      else
        errorCallback(status);
    };
  else
    onError = errorCallback;

  getTokenFunc(doRequest.bind(null, onError));
};

XHR._requestWithToken = function(method, url, postData, successCallback, errorCallback, token) {
if (token == undefined) {
  console.log(method, url);
  console.log(new Error().stack);
}
  var xhr = new XMLHttpRequest();
  xhr.open(method, url);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Authorization", "Bearer " + token);
  xhr.onload = XHR.parseJSONResponse.bind(null, xhr, successCallback, errorCallback);
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
  xhr.onload = XHR.parseJSONResponse.bind(null, xhr, successCallback, errorCallback);
  xhr.send(data);
};
