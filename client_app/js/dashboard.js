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
          var on = event.target.checked;
          if (!background.changeSetting(key, on))
            event.target.checked = !on;
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
  setupSettingCheckbox('serveHttp');
  setupSettingCheckbox('useGCDStaging');

  createRowCells(document.getElementById('header'), true);

  setInterval(
      function() {
        chrome.runtime.getBackgroundPage(function(background) {
          updateDashboard(background.connector, background.device);
        });
      },
      1000);
};

function createChild(parent, className, opt_content) {
  var child = document.createElement('div');
  child.className = className;
  if (opt_content)
    child.textContent = opt_content;
  parent.appendChild(child);
  return child;
}

function createRowCells(row, isHeader) {
  function createCell(name) {
    createChild(row, name.toLowerCase().replace(/ /g, '_'), isHeader && name);
  }
  createCell('Name');
  createCell('GCD');
  createCell('ICE');
  createCell('Data');
  createCell('Connected');
  createCell('Refused');
  createCell('Active');
  createCell('Sent pckts');
  createCell('Recv pckts');
  createCell('Sent bytes');
  createCell('Recv bytes');
  createCell('Buffered');
}

function formatQuantity(number) {
  if (typeof number != 'number')
    return "n/a";

  if (number < 1024)
    return number;

  var kNumber = number / 1024;
  if (kNumber < 1024)
    return kNumber.toFixed(kNumber < 100 ? 1 : 0) + 'K';

  var mNumber = kNumber / 1024;
  return mNumber.toFixed(mNumber < 10 ? 2 : 1) + 'M';
}

function updateDashboard(connector, mockDevice) {
  var deviceIds = connector ? connector.getDeviceIds() : [];

  var MOCK_DEVICE_ID = "mock";
  var newRowIds = deviceIds.concat(mockDevice ? [MOCK_DEVICE_ID] : []);

  var devicesDiv = document.getElementById('devices');
  var deviceRows = devicesDiv.querySelectorAll('.device');
  Array.prototype.forEach.call(deviceRows, function(row) {
    if (newRowIds.indexOf(row.id) < 0)
      row.remove();
  });

  if (mockDevice)
    updateDashboardRow(devicesDiv, MOCK_DEVICE_ID, "Mock [" + mockDevice.getDisplayName() + "]", mockDevice.getStatus(), true);

  deviceIds.forEach(function(id) {
    var connection = connector.getDeviceConnection(id);
    updateDashboardRow(devicesDiv, id, connection.getDeviceName(), connection.getStatus());
  });
}

function updateDashboardRow(devicesDiv, id, name, status, opt_firstRow) {
  var row = document.getElementById(id);
  if (!row) {
    row = document.createElement('div');
    row.id = id;
    row.classList.add('device');
    row.classList.add('table-row');

    if (opt_firstRow && devicesDiv.firstElementChild)
      devicesDiv.insertBefore(row, devicesDiv.firstElementChild);
    else
      devicesDiv.appendChild(row);

    createRowCells(row);
    row.firstElementChild.title = id;
    row.firstElementChild.textContent = name;
  }

  for (var key in status)
    if (status.hasOwnProperty(key)) {
      var cell = row.querySelector('.' + key);
      if (cell) {
        var value = status[key];
        if (key.match(/^(sent|recv|buffered)/))
          value = formatQuantity(value);
        cell.textContent = value;
      } else {
        console.error('Cannot find cell: ' + key);
      }
    }
}