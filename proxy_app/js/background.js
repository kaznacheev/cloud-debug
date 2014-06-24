/**
 * Listens for the app launching then creates the window
 *
 * @see http://developer.chrome.com/apps/app.window.html
 */
chrome.app.runtime.onLaunched.addListener(function() {
  chrome.app.window.create('main.html', {
  	id: "mainwin",
    bounds: {
      width: 500,
      height: 640
    }
  });
});
