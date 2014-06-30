var ByteArray = {
  fromString: function(string) {
    var array = new Uint8Array(string.length);
    for (var i = 0; i < string.length; i++) {
      array[i] = string.charCodeAt(i);
    }
    return array;
  },

  toString: function(array) {
    var str = '';
    for (var s = 0; s < array.length; s++) {
      str += String.fromCharCode(array[s]);
    }
    return str;
  },

  concat: function(left, right) {
    if (!left)
      left = new Uint8Array(0);
    var result = new Uint8Array(left.length + right.length);
    result.set(left, 0);
    result.set(right, left.length);
    return result;
  }
};