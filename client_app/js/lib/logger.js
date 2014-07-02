var Logger = {};

Logger.LEVELS = ['debug', 'log', 'warn', 'error'];

Logger.debug = {};

Logger.install = function(object, context, opt_id) {
  if (!context)
    context = object;

  if (typeof context !== 'string')
    context = context.name;

  var contextString = context;
  if (opt_id != undefined)
    contextString += ' #' + opt_id;

  contextString = "[" + contextString + "]";

  function isEnabled(level) {
    return level != 'debug' || Logger.debug[context];
  }

  Logger.LEVELS.forEach(function(level) {
    if (isEnabled(level))
      object[level] = console[level].bind(console, contextString);
    else
      object[level] = function() {};
  });
};

Logger.create = function(context, opt_id) {
  var object = {};
  Logger.install(object, context, opt_id);
  return object;
};

Logger.append = function(logger, param) {
  var newLogger = {};
  Logger.LEVELS.forEach(function(level) {
    newLogger[level] = logger[level].bind(null, param)
  });
  return newLogger;
};