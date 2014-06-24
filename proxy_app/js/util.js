var stringToUint8Array = function(string) {
  var buffer = new ArrayBuffer(string.length);
  var view = new Uint8Array(buffer);
  for(var i = 0; i < string.length; i++) {
    view[i] = string.charCodeAt(i);
  }
  return view;
};

//var stringToArrayBuffer = function(string) {
//  var buffer = new ArrayBuffer(string.length);
//  var view = new Uint8Array(buffer);
//  for(var i = 0; i < string.length; i++) {
//    view[i] = string.charCodeAt(i);
//  }
//  return buffer;
//};

var arrayBufferToString = function(buffer, opt_offset, opt_length) {
  if (!opt_offset)
    opt_offset = 0;
  if (!opt_length)
    opt_length = buffer.byteLength - opt_offset;
  var str = '';
  var uArrayVal = new Uint8Array(buffer, opt_offset, opt_length);
  for(var s = 0; s < uArrayVal.length; s++) {
    str += String.fromCharCode(uArrayVal[s]);
  }
  return str;
};

