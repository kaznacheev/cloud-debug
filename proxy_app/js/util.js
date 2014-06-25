function stringToUint8Array(string) {
  var array = new Uint8Array(string.length);
  for(var i = 0; i < string.length; i++) {
    array[i] = string.charCodeAt(i);
  }
  return array;
}

function Uint8ArrayToString(array) {
  var str = '';
  for(var s = 0; s < array.length; s++) {
    str += String.fromCharCode(array[s]);
  }
  return str;
}

