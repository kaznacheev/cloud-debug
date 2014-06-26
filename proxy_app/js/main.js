onload = function() {
  function setupSettingCheckbox(key) {
    var checkbox = document.getElementById(key);

    chrome.runtime.getBackgroundPage(function(background) {
      if (background[key])
        checkbox.checked = true;
    });

    checkbox.addEventListener('click', function(event) {
      chrome.runtime.getBackgroundPage(function(background) {
        try {
          background.changeSetting(key, event.target.checked);
        } catch (e) {
          console.error(e.stack);
        }
      });
    });
  }

  setupSettingCheckbox('runInBackground');
  setupSettingCheckbox('runProxyServer');
  setupSettingCheckbox('runTestDevice');
  setupSettingCheckbox('connectToLocalhost');
};
