/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

var curr_req = false;
var server_info = false;
var manifest = false;

var appInfo = {
    deviceId: null,
    deviceName: 'LG Smart TV',
    appName: 'Jellyfin for WebOS',
    appVersion: '0.0.0'
};

// Store authenticated user info for handoff
var authenticatedUser = null;
var authToken = null;

var deviceInfo;
webOS.deviceInfo(function (info) {
    deviceInfo = info;
});

//Adds .includes to string to do substring matching
if (!String.prototype.includes) {
  String.prototype.includes = function(search, start) {
    'use strict';

    if (search instanceof RegExp) {
      throw TypeError('first argument must not be a RegExp');
    }
    if (start === undefined) { start = 0; }
    return this.indexOf(search, start) !== -1;
  };
}


function isVisible(element) {
    return element.offsetWidth > 0 && element.offsetHeight > 0;
}

function findIndex(array, currentNode) {
    //This just implements the following function which is not available on some LG TVs
    //Array.from(allElements).findIndex(function (el) { return currentNode.isEqualNode(el); })
    for (var i = 0, item; item = array[i]; i++) {
        if (currentNode.isEqualNode(item))
            return i;
    }
}

function navigate(amount) {
    console.log("Navigating " + amount.toString() + "...")
    var element = document.activeElement;
    if (element === null) {
        navigationInit();
    } else if (!isVisible(element) || element.tagName == 'BODY') {
        navigationInit();
    } else {
        //Isolate the node that we're after
        var currentNode = element;

        //find all tab-able elements
        var allElements = document.querySelectorAll('input, button, a, area, object, select, textarea, [contenteditable]');

        //Find the current tab index.
        var currentIndex = findIndex(allElements, currentNode);

        //focus the following element
        if (allElements[currentIndex + amount])
            allElements[currentIndex + amount].focus();
    }
}


function upArrowPressed() {
    navigate(-1);
}

function downArrowPressed() {
    navigate(1);
}
function leftArrowPressed() {
    // Your stuff here
}

function rightArrowPressed() {
    // Your stuff here
}

function backPressed() {
    // Check if profile selection or overlays are visible
    var profileSelection = document.getElementById('profileSelection');
    var pinOverlay = document.getElementById('pinOverlay');
    var manualLoginOverlay = document.getElementById('manualLoginOverlay');
    var quickConnectOverlay = document.getElementById('quickConnectOverlay');

    if (quickConnectOverlay && quickConnectOverlay.style.display !== 'none') {
        profiles.hideQuickConnect();
        return;
    }

    if (pinOverlay && pinOverlay.style.display !== 'none') {
        profiles.hidePinEntry();
        return;
    }

    if (manualLoginOverlay && manualLoginOverlay.style.display !== 'none') {
        profiles.hideManualLogin();
        return;
    }

    if (profileSelection && profileSelection.style.display !== 'none') {
        profiles.goBack();
        return;
    }

    webOS.platformBack();
}

document.onkeydown = function (evt) {
    evt = evt || window.event;
    switch (evt.keyCode) {
        case 37:
            leftArrowPressed();
            break;
        case 39:
            rightArrowPressed();
            break;
        case 38:
            upArrowPressed();
            break;
        case 40:
            downArrowPressed();
            break;
        case 461: // Back
            backPressed();
            break;
    }
};

function handleCheckbox(elem, evt) {
    console.log(elem);
    if (evt === true) {
        return true; // webos should be capable of toggling the checkbox by itself
    } else {
        evt = evt || window.event; //keydown event
        if (evt.keyCode == 13 || evt.keyCode == 32) { //OK button or Space
            elem.checked = !elem.checked;
        }
    }
    return false;
}

// Similar to jellyfin-web
function generateDeviceId() {
    return btoa([navigator.userAgent, new Date().getTime()].join('|')).replace(/=/g, '1');
}

function getDeviceId() {
    // Use variable '_deviceId2' to mimic jellyfin-web

    var deviceId = storage.get('_deviceId2');

    if (!deviceId) {
        deviceId = generateDeviceId();
        storage.set('_deviceId2', deviceId);
    }

    return deviceId;
}

function navigationInit() {
    if (isVisible(document.querySelector('#connect'))) {
        document.querySelector('#connect').focus()
    } else if (isVisible(document.querySelector('#abort'))) {
        document.querySelector('#abort').focus()
    }
}

function Init() {
    appInfo.deviceId = getDeviceId();

    webOS.fetchAppInfo(function (info) {
        if (info) {
            appInfo.appVersion = info.version;
        } else {
            console.error('Error occurs while getting appinfo.json.');
        }
    });

    navigationInit();

    if (storage.exists('connected_servers')) {
        connected_servers = storage.get('connected_servers')
        var first_server = connected_servers[Object.keys(connected_servers)[0]]
        document.querySelector('#baseurl').value = first_server.baseurl;
        document.querySelector('#auto_connect').checked = first_server.auto_connect;
        if (window.performance && window.performance.navigation.type == window.performance.navigation.TYPE_BACK_FORWARD) {
            console.log('Got here using the browser "Back" or "Forward" button, inhibiting auto connect.');
        } else {
            if (first_server.auto_connect) {
                console.log("Auto connecting...");
                handleServerSelect();
            }
        }
        renderServerList(connected_servers);
    }
}
// Just ensure that the string has no spaces, and begins with either http:// or https:// (case insensitively), and isn't empty after the ://
function validURL(str) {
    pattern = /^https?:\/\/\S+$/i;
    return !!pattern.test(str);
}

function normalizeUrl(url) {
    url = url.trimLeft ? url.trimLeft() : url.trimStart();
    if (url.indexOf("http://") != 0 && url.indexOf("https://") != 0) {
        // assume http
        url = "http://" + url;
    }
    // normalize multiple slashes as this trips WebOS in some cases
    var parts = url.split("://");
    for (var i = 1; i < parts.length; i++) {
        var part = parts[i];
        while (true) {
            var newpart = part.replace("//", "/");
            if (newpart.length == part.length) break;
            part = newpart;
        }
        parts[i] = part;
    }
    return parts.join("://");
}

function handleServerSelect() {
    var baseurl = normalizeUrl(document.querySelector('#baseurl').value);
    var auto_connect = document.querySelector('#auto_connect').checked;

    if (validURL(baseurl)) {

        displayConnecting();
        console.log(baseurl, auto_connect);

        if (curr_req) {
            console.log("There is an active request.");
            abort();
        }
        hideError();
        getServerInfo(baseurl, auto_connect);
    } else {
        console.log(baseurl);
        displayError("Please enter a valid URL, it needs a scheme (http:// or https://), a hostname or IP (ex. jellyfin.local or 192.168.0.2) and a port (ex. :8096 or :8920).");
    }
}

function displayError(error) {
    var errorElem = document.querySelector('#error')
    errorElem.style.display = '';
    errorElem.innerHTML = error;
}
function hideError() {
    var errorElem = document.querySelector('#error')
    errorElem.style.display = 'none';
    errorElem.innerHTML = '&nbsp;';
}

function displayConnecting() {
    document.querySelector('#serverInfoForm').style.display = 'none';
    document.querySelector('#busy').style.display = '';
    navigationInit();
}
function hideConnecting() {
    document.querySelector('#serverInfoForm').style.display = '';
    document.querySelector('#busy').style.display = 'none';
    navigationInit();
}
function getServerInfo(baseurl, auto_connect) {
    curr_req = ajax.request(normalizeUrl(baseurl + "/System/Info/Public"), {
        method: "GET",
        success: function (data) {
            handleSuccessServerInfo(data, baseurl, auto_connect);
        },
        error: handleFailure,
        abort: handleAbort,
        timeout: 5000
    });
}

function getManifest(baseurl) {
    curr_req = ajax.request(normalizeUrl(baseurl + "/web/manifest.json"), {
        method: "GET",
        success: function (data) {
            handleSuccessManifest(data, baseurl);
        },
        error: handleFailure,
        abort: handleAbort,
        timeout: 5000
    });
}

function getConnectedServers() {
    connected_servers = storage.get('connected_servers');
    if (!connected_servers) {
        connected_servers = {};
    }
    return connected_servers;
}


function handleSuccessServerInfo(data, baseurl, auto_connect) {
    curr_req = false;

    connected_servers = getConnectedServers();
    for (var server_id in connected_servers) {
        var server = connected_servers[server_id]
        if (server.baseurl == baseurl) {
            if (server.id != data.Id && server.id !== false) {
                //server has changed warn user.
                hideConnecting();
                displayError("The server ID has changed since the last connection, please check if you are reaching your own server. To connect anyway, click connect again.");
                delete connected_servers[server_id]
                connected_servers[data.Id] = ({ 'baseurl': baseurl, 'auto_connect': false, 'id': false })
                storage.set('connected_servers', connected_servers)  // Fixed: was 'connected_server' (typo)
                return false
            }
        }
    }


    server_info = data;

    connected_servers = lruStrategy(connected_servers, 4, { 'baseurl': baseurl, 'auto_connect': auto_connect, 'id': data.Id, 'Id': data.Id, 'Name': data.ServerName });

    storage.set('connected_servers', connected_servers);


    getManifest(baseurl);
    return true;
}

function lruStrategy(old_items,max_items,new_item) {
    var result = {}
    var id = new_item.id

    delete old_items[id] // LRU: re-insert entry (in front) each time it is used
    result[id] =  new_item
    var keys = Object.keys(old_items)
    for (var i=0; i<max_items-1; i++){
        var current_key=keys[i]
        result[current_key] = old_items[current_key]
    }
    return result
}

function handleSuccessManifest(data, baseurl) {
    if(data.start_url.includes("/web")){
        var hosturl = normalizeUrl(baseurl + "/" + data.start_url);
    } else {
        var hosturl = normalizeUrl(baseurl + "/web/" + data.start_url);
    }

    curr_req = false;

    // Try to find existing server entry by baseurl
    var serverInfo = null;
    for (var server_id in connected_servers) {
        var info = connected_servers[server_id];
        if (info && info.baseurl == baseurl) {
            // update hosturl/address and use this entry
            info.hosturl = hosturl;
            info.Address = info.Address || baseurl;
            storage.set('connected_servers', connected_servers);
            console.log("handleSuccessManifest modified server");
            console.log(info);
            serverInfo = info;
            break;
        }
    }

    if (!serverInfo) {
        var resolvedId = (server_info && server_info.Id) ? server_info.Id : baseurl;
        var hostPart = baseurl.replace(/^https?:\/\//i, '').split('/')[0].slice(0, 8);
        // Build a minimal serverInfo object to use for profile selection
        serverInfo = {
            id: resolvedId, // fallback id = baseurl when real id is not available
            Id: resolvedId,
            baseurl: baseurl,
            hosturl: hosturl,
            Name: (server_info && server_info.ServerName) || data.shortname || baseurl,
            Address: hostPart
        };

        // Save into connected_servers using fallback id
        connected_servers = connected_servers || {};
        connected_servers[serverInfo.id] = serverInfo;
        storage.set('connected_servers', connected_servers);
        console.log("handleSuccessManifest added server");
        console.log(serverInfo);
    }

    // Start profile selection flow instead of direct handoff
    // Always show profile selection on startup
    startProfileSelection(serverInfo, { forceShowSelection: true });
}

/**
 * Start the profile selection flow
 */
function startProfileSelection(serverInfo, options) {
    // Update server name display
    var serverNameElem = document.getElementById('profileServerName');
    if (serverNameElem) {
        serverNameElem.textContent = serverInfo.Name || serverInfo.Address || serverInfo.baseurl;
    }

    options = options || {};

    profiles.init(serverInfo, function (user, token) {
        authenticatedUser = user;
        authToken = token;

        // After authentication, the server ID may have been updated to the real ServerId
        // Update connected_servers with the correct ID for future use
        if (profiles.currentServer && profiles.currentServer.id) {
            var oldId = serverInfo.id;
            var newId = profiles.currentServer.id;
            
            if (oldId !== newId) {
                console.log('Server ID updated from', oldId, 'to', newId);
                // Remove old entry and add with new ID
                if (connected_servers && connected_servers[oldId]) {
                    var serverData = connected_servers[oldId];
                    delete connected_servers[oldId];
                    serverData.id = newId;
                    serverData.Id = newId;
                    connected_servers[newId] = serverData;
                    storage.set('connected_servers', connected_servers);
                }
                // Also update serverInfo reference
                serverInfo.id = newId;
                serverInfo.Id = newId;
            }
        }

        // Proceed to handoff with auth info
        getTextToInject(function (bundle) {
            handoff(serverInfo.hosturl, bundle);
        }, function (error) {
            console.error(error);
            displayError(error);
            hideConnecting();
            curr_req = false;
        });
    }, options);
}

function handleAbort() {
    console.log("Aborted.")
    hideConnecting();
    curr_req = false;
}

function handleFailure(data) {
    console.log("Failure:", data)
    console.log("Could not connect to server...")
    if (data.error == 'timeout') {
        displayError("The request timed out.")
    } else if (data.error == 'abort') {
        displayError("The request was aborted.")
    } else if (typeof data.error === 'string') {
        displayError(data.error);
    } else if (typeof data.error === 'number' && data.error > 0) {
        displayError("Got HTTP error " + data.error.toString() + " from server, are you connecting to a Jellyfin Server?")
    } else {
        displayError("Unknown error occured, are you connecting to a Jellyfin Server?")
    }

    hideConnecting();
    storage.remove('connected_server');
    curr_req = false;
}

function abort() {
    if (curr_req) {
        curr_req.abort()
    } else {
        hideConnecting();
    }
    console.log("Aborting...");
}

function loadUrl(url, success, failure) {
    var xhr = new XMLHttpRequest();

    xhr.open('GET', url);

    xhr.onload = function () {
        success(xhr.responseText);
    };

    xhr.onerror = function () {
        failure("Failed to load '" + url + "'");
    }

    xhr.send();
}

function getTextToInject(success, failure) {
    var bundle = {};

    var urls = ['js/webOS.js', 'css/webOS.css'];

    // imitate promises as they're borked in at least WebOS 2
    var looper = function (idx) {
        if (idx >= urls.length) {
            success(bundle);
        } else {
            var url = urls[idx];
            var ext = url.split('.').pop();
            loadUrl(url, function (data) {
                bundle[ext] = (bundle[ext] || '') + data;
                looper(idx + 1);
            }, failure);
        }
    };
    looper(0);
}

function injectScriptText(document, text) {
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.innerHTML = text;
    document.head.appendChild(script);
}

function injectStyleText(document, text) {
    var style = document.createElement('style');
    style.innerHTML = text;
    document.body.appendChild(style);
}

var handoffTimer = null;
var handoffLoadHandler = null;

function escapeJsString(str) {
    if (!str) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function handoff(url, bundle) {
    console.log("Handoff called with: ", url);

    stopDiscovery();
    document.querySelector('.container').style.display = 'none';
    document.getElementById('profileSelection').style.display = 'none';

    var contentFrame = document.querySelector('#contentFrame');

    if (handoffTimer) {
        clearInterval(handoffTimer);
        handoffTimer = null;
    }
    if (handoffLoadHandler) {
        contentFrame.removeEventListener('load', handoffLoadHandler);
        handoffLoadHandler = null;
    }

    // Inject a script as early as possible to set/preserve target credentials
    function injectEarlyScript(doc) {
        if (!doc || doc.__jfEarlyInjected) return;
        if (contentFrame.style.display === 'none') return;
        if (doc.location && doc.location.href === 'about:blank') return;

        try {
            var target = doc.head || doc.documentElement;
            if (target) {
                var clearScriptText = getCredentialClearScript();
                doc.__jfEarlyInjected = true;
                if (clearScriptText) {
                    var script = doc.createElement('script');
                    script.type = 'text/javascript';
                    script.textContent = clearScriptText;
                    target.insertBefore(script, target.firstChild);
                    console.log("Jellyfin WebOS: Injected early credential sync script");
                }
            }
        } catch (e) {
            console.warn("Jellyfin WebOS: Could not inject early script", e);
        }
    }

    function armUnload(win) {
        if (!win) return;
        try {
            if (!win.__jfUnloadArmed) {
                win.__jfUnloadArmed = true;
                win.addEventListener('unload', onUnload);
            }
        } catch (e) {
            console.warn("Jellyfin WebOS: Could not arm unload listener", e);
        }
    }

    function runInjection(doc) {
        if (!doc || doc.__jfInjected) return;
        if (contentFrame.style.display === 'none') return;
        if (doc.location && doc.location.href === 'about:blank') return;
        if (!doc.head || !doc.body) return;

        doc.__jfInjected = true;

        injectScriptText(doc, 'window.AppInfo = ' + JSON.stringify(appInfo) + ';');
        injectScriptText(doc, 'window.DeviceInfo = ' + JSON.stringify(deviceInfo) + ';');

        // Inject auth credentials if available
        if (authenticatedUser && authToken) {
            var authInfo = {
                user: authenticatedUser,
                token: authToken
            };
            injectScriptText(doc, 'window.JellyfinCredentials = ' + JSON.stringify(authInfo) + ';');

            var credentialScript = getCredentialInjectionScript();
            injectScriptText(doc, credentialScript);
        }

        // Always inject Switch User UI and Sign Out interception on every load
        injectScriptText(doc, getSwitchUserInjectionScript());

        if (bundle.js) {
            injectScriptText(doc, bundle.js);
        }

        if (bundle.css) {
            injectStyleText(doc, bundle.css);
        }
    }

    function onLoad() {
        if (handoffTimer) {
            clearInterval(handoffTimer);
            handoffTimer = null;
        }
        var doc = contentFrame.contentDocument;
        var win = contentFrame.contentWindow;
        if (doc) {
            doc.removeEventListener('DOMContentLoaded', onLoad);
        }
        armUnload(win);
        runInjection(doc);
    }

    function onUnload() {
        if (handoffTimer) {
            clearInterval(handoffTimer);
            handoffTimer = null;
        }

        handoffTimer = setInterval(function () {
            var contentDocument = contentFrame.contentDocument;
            var contentWin = contentFrame.contentWindow;
            if (!contentDocument) return;

            armUnload(contentWin);

            switch (contentDocument.readyState) {
                case 'loading':
                    injectEarlyScript(contentDocument);
                    clearInterval(handoffTimer);
                    handoffTimer = null;
                    contentDocument.addEventListener('DOMContentLoaded', onLoad);
                    break;

                case 'interactive':
                case 'complete':
                    injectEarlyScript(contentDocument);
                    if (contentDocument.body) {
                        clearInterval(handoffTimer);
                        handoffTimer = null;
                        onLoad();
                    }
                    break;
            }
        }, 0);
    }

    handoffLoadHandler = onLoad;
    contentFrame.addEventListener('load', handoffLoadHandler);
    armUnload(contentFrame.contentWindow);

    contentFrame.style.display = '';
    contentFrame.src = url;
}

/**
 * Generate the script that synchronizes target credentials BEFORE jellyfin-web reads them.
 * When authenticatedUser is null, does not clear anything.
 * When target credentials exist, checks if localStorage already matches; if not, writes target credentials directly.
 */
function getCredentialClearScript() {
    if (!authenticatedUser || !authToken) {
        return '';
    }

    var targetUserId = authenticatedUser.Id || '';
    var targetToken = authToken || '';
    var serverId = (profiles.currentServer && (profiles.currentServer.id || profiles.currentServer.Id)) ? (profiles.currentServer.id || profiles.currentServer.Id) : '';
    var serverAddress = (profiles.currentServer && profiles.currentServer.baseurl) ? profiles.currentServer.baseurl : '';
    var serverName = (profiles.currentServer && profiles.currentServer.Name) ? profiles.currentServer.Name : serverAddress;

    if (!serverId || !targetUserId || !targetToken) {
        return '';
    }

    return '(function() {' +
        '    var serverId = "' + escapeJsString(serverId) + '";' +
        '    var serverAddress = "' + escapeJsString(serverAddress) + '";' +
        '    var serverName = "' + escapeJsString(serverName) + '";' +
        '    var targetUserId = "' + escapeJsString(targetUserId) + '";' +
        '    var targetToken = "' + escapeJsString(targetToken) + '";' +
        '    var credentialKey = "jellyfin_credentials";' +
        '    try {' +
        '        var existingCreds = JSON.parse(localStorage.getItem(credentialKey) || "{}");' +
        '        if (!existingCreds.Servers) { existingCreds.Servers = []; }' +
        '        var first = existingCreds.Servers[0];' +
        '        if (first && first.Id === serverId && first.UserId === targetUserId && first.AccessToken === targetToken && localStorage.getItem("enableAutoLogin") === "true") {' +
        '            window.__jfCredsMatchedAtStart = true;' +
        '            return;' +
        '        }' +
        '        var serverEntry = null;' +
        '        var serverIndex = -1;' +
        '        for (var i = 0; i < existingCreds.Servers.length; i++) {' +
        '            if (existingCreds.Servers[i].Id === serverId) {' +
        '                serverEntry = existingCreds.Servers[i];' +
        '                serverIndex = i;' +
        '                break;' +
        '            }' +
        '        }' +
        '        if (!serverEntry) {' +
        '            serverEntry = {' +
        '                Id: serverId,' +
        '                Name: serverName,' +
        '                ManualAddress: serverAddress,' +
        '                LocalAddress: serverAddress,' +
        '                LastConnectionMode: 2' +
        '            };' +
        '            existingCreds.Servers.push(serverEntry);' +
        '            serverIndex = existingCreds.Servers.length - 1;' +
        '        }' +
        '        serverEntry.AccessToken = targetToken;' +
        '        serverEntry.UserId = targetUserId;' +
        '        serverEntry.DateLastAccessed = new Date().getTime();' +
        '        if (serverIndex > 0) {' +
        '            existingCreds.Servers.splice(serverIndex, 1);' +
        '            existingCreds.Servers.unshift(serverEntry);' +
        '        }' +
        '        localStorage.setItem("enableAutoLogin", "true");' +
        '        localStorage.setItem(credentialKey, JSON.stringify(existingCreds));' +
        '        window.__jfCredsOverwrittenEarly = true;' +
        '    } catch (e) {' +
        '        console.warn("Jellyfin WebOS: Error syncing early credentials", e);' +
        '    }' +
        '})();';
}

/**
 * Generate the script that injects credentials into Jellyfin-web's credential manager
 * and triggers at most one reload if stored credentials did not already match.
 */
function getCredentialInjectionScript() {
    var targetUserId = (authenticatedUser && authenticatedUser.Id) ? authenticatedUser.Id : '';
    var targetUserName = (authenticatedUser && authenticatedUser.Name) ? authenticatedUser.Name : '';
    var targetToken = authToken || '';
    var serverId = (profiles.currentServer && (profiles.currentServer.id || profiles.currentServer.Id)) ? (profiles.currentServer.id || profiles.currentServer.Id) : '';
    var serverAddress = (profiles.currentServer && profiles.currentServer.baseurl) ? profiles.currentServer.baseurl : '';
    var serverName = (profiles.currentServer && profiles.currentServer.Name) ? profiles.currentServer.Name : serverAddress;

    return '(function() {' +
        '    if (!window.JellyfinCredentials) {' +
        '        return;' +
        '    }' +
        '    var creds = window.JellyfinCredentials;' +
        '    var serverId = "' + escapeJsString(serverId) + '";' +
        '    var serverAddress = "' + escapeJsString(serverAddress) + '";' +
        '    var serverName = "' + escapeJsString(serverName) + '";' +
        '    var targetUserId = "' + escapeJsString(targetUserId) + '";' +
        '    var targetUserName = "' + escapeJsString(targetUserName) + '";' +
        '    var targetToken = "' + escapeJsString(targetToken) + '";' +
        '    if (!serverId || !targetUserId || !creds.token) {' +
        '        return;' +
        '    }' +
        '    var reloadKey = "jf_webos_injected_" + targetUserId;' +
        '    var keysToRemove = [];' +
        '    for (var k = 0; k < sessionStorage.length; k++) {' +
        '        var key = sessionStorage.key(k);' +
        '        if (key && key.indexOf("jf_webos_injected_") === 0 && key !== reloadKey) {' +
        '            keysToRemove.push(key);' +
        '        }' +
        '    }' +
        '    for (var r = 0; r < keysToRemove.length; r++) {' +
        '        sessionStorage.removeItem(keysToRemove[r]);' +
        '    }' +
        '    var credentialKey = "jellyfin_credentials";' +
        '    var existingCreds = {};' +
        '    try {' +
        '        existingCreds = JSON.parse(localStorage.getItem(credentialKey) || "{}");' +
        '    } catch (e) {}' +
        '    if (!existingCreds.Servers) {' +
        '        existingCreds.Servers = [];' +
        '    }' +
        '    var firstServer = existingCreds.Servers[0];' +
        '    var matchedNow = !!(firstServer && firstServer.Id === serverId && firstServer.UserId === targetUserId && firstServer.AccessToken === creds.token && localStorage.getItem("enableAutoLogin") === "true");' +
        '    var matchedBeforeLoad = !!(window.__jfCredsMatchedAtStart || (matchedNow && !window.__jfCredsOverwrittenEarly));' +
        '    if (!matchedNow) {' +
        '        var serverEntry = null;' +
        '        var serverIndex = -1;' +
        '        for (var i = 0; i < existingCreds.Servers.length; i++) {' +
        '            if (existingCreds.Servers[i].Id === serverId) {' +
        '                serverEntry = existingCreds.Servers[i];' +
        '                serverIndex = i;' +
        '                break;' +
        '            }' +
        '        }' +
        '        if (!serverEntry) {' +
        '            serverEntry = {' +
        '                Id: serverId,' +
        '                Name: serverName,' +
        '                ManualAddress: serverAddress,' +
        '                LocalAddress: serverAddress,' +
        '                LastConnectionMode: 2' +
        '            };' +
        '            existingCreds.Servers.push(serverEntry);' +
        '            serverIndex = existingCreds.Servers.length - 1;' +
        '        }' +
        '        serverEntry.AccessToken = creds.token;' +
        '        serverEntry.UserId = targetUserId;' +
        '        serverEntry.DateLastAccessed = new Date().getTime();' +
        '        if (serverIndex > 0) {' +
        '            existingCreds.Servers.splice(serverIndex, 1);' +
        '            existingCreds.Servers.unshift(serverEntry);' +
        '        }' +
        '        localStorage.setItem("enableAutoLogin", "true");' +
        '        localStorage.setItem(credentialKey, JSON.stringify(existingCreds));' +
        '    }' +
        '    if (matchedBeforeLoad) {' +
        '        if (sessionStorage.getItem(reloadKey) === "true") {' +
        '            sessionStorage.removeItem(reloadKey);' +
        '        }' +
        '        console.log("Jellyfin WebOS: Credentials matched for user", targetUserName);' +
        '        return;' +
        '    }' +
        '    if (sessionStorage.getItem(reloadKey) === "true") {' +
        '        sessionStorage.removeItem(reloadKey);' +
        '        return;' +
        '    }' +
        '    sessionStorage.setItem(reloadKey, "true");' +
        '    location.reload();' +
        '})();';
}

/**
 * Generate the script that persistently injects "Switch user" buttons into the Jellyfin UI
 * and intercepts "Sign out" actions to open the WebOS profile picker.
 */
function getSwitchUserInjectionScript() {
    return '(function() {' +
        '    if (window.__jfSwitchUserInitialized) return;' +
        '    window.__jfSwitchUserInitialized = true;' +
        '    var triggerShowProfiles = function(evt) {' +
        '        if (evt) {' +
        '            try { evt.preventDefault(); evt.stopPropagation(); } catch (e) {}' +
        '        }' +
        '        try { window.parent.postMessage({ type: "showProfiles" }, "*"); } catch (e) {}' +
        '    };' +
        '    var bindActivate = function(btn) {' +
        '        btn.onclick = function(e) { triggerShowProfiles(e); };' +
        '        btn.onkeydown = function(e) {' +
        '            var code = e ? (e.keyCode || e.which) : 0;' +
        '            if (code === 13 || code === 32) { triggerShowProfiles(e); }' +
        '        };' +
        '    };' +
        '    var switchIconSvg = "<svg viewBox=\'0 0 24 24\' width=\'24\' height=\'24\' fill=\'currentColor\' aria-hidden=\'true\' style=\'pointer-events:none;display:block;\'><path d=\'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z\'/></svg>";' +
        '    var ensureButtons = function() {' +
        '        try {' +
        '            if (!document.getElementById("jf-switch-user-header-btn")) {' +
        '                var headerRight = document.querySelector(".headerRight");' +
        '                var skinHeader = headerRight || document.querySelector(".skinHeader");' +
        '                if (skinHeader) {' +
        '                    var hBtn = document.createElement("button");' +
        '                    hBtn.type = "button";' +
        '                    hBtn.id = "jf-switch-user-header-btn";' +
        '                    hBtn.className = "headerButton headerButtonRight paper-icon-button-light jf-switch-user";' +
        '                    hBtn.tabIndex = 0;' +
        '                    hBtn.title = "Switch user";' +
        '                    hBtn.setAttribute("aria-label", "Switch user");' +
        '                    hBtn.innerHTML = switchIconSvg;' +
        '                    bindActivate(hBtn);' +
        '                    var userBtn = headerRight ? headerRight.querySelector(".headerUserButton") : null;' +
        '                    if (headerRight && userBtn && userBtn.parentNode === headerRight) {' +
        '                        headerRight.insertBefore(hBtn, userBtn);' +
        '                    } else {' +
        '                        skinHeader.appendChild(hBtn);' +
        '                    }' +
        '                }' +
        '            }' +
        '            if (!document.getElementById("jf-switch-user-prefs-btn")) {' +
        '                var prefs = document.querySelector("#myPreferencesMenuPage, .myPreferencesMenuPage");' +
        '                if (prefs) {' +
        '                    var logoutEl = prefs.querySelector(".btnLogout");' +
        '                    if (!logoutEl) {' +
        '                        var candidates = prefs.querySelectorAll("button, a, .listItem");' +
        '                        for (var i = 0; i < candidates.length; i++) {' +
        '                            var txt = (candidates[i].innerText || candidates[i].textContent || "").trim().toLowerCase();' +
        '                            if (txt === "sign out" || txt === "log out" || txt === "logout" || txt.indexOf("sign out") !== -1) {' +
        '                                logoutEl = candidates[i];' +
        '                                break;' +
        '                            }' +
        '                        }' +
        '                    }' +
        '                    if (logoutEl && logoutEl.parentNode) {' +
        '                        var pBtn = document.createElement("button");' +
        '                        pBtn.type = "button";' +
        '                        pBtn.id = "jf-switch-user-prefs-btn";' +
        '                        pBtn.className = "listItem listItem-border headerButton paper-icon-button-light jf-switch-user-prefs";' +
        '                        pBtn.tabIndex = 0;' +
        '                        pBtn.innerHTML = "<span style=\'display:inline-flex;align-items:center;margin-right:12px;\'>" + switchIconSvg + "</span><span>Switch user</span>";' +
        '                        pBtn.style.cssText = "display:flex;align-items:center;width:100%;padding:12px 16px;margin-top:4px;background:transparent;color:inherit;border:none;cursor:pointer;text-align:left;font-size:inherit;";' +
        '                        bindActivate(pBtn);' +
        '                        logoutEl.parentNode.insertBefore(pBtn, logoutEl.nextSibling);' +
        '                    }' +
        '                }' +
        '            }' +
        '        } catch (e) {' +
        '            console.warn("Jellyfin WebOS: ensureButtons error", e);' +
        '        }' +
        '    };' +
        '    document.addEventListener("click", function(e) {' +
        '        var el = e.target;' +
        '        while (el && el !== document.body) {' +
        '            if (el.id === "jf-switch-user-header-btn" || el.id === "jf-switch-user-prefs-btn") {' +
        '                return;' +
        '            }' +
        '            var cls = (typeof el.className === "string") ? el.className : "";' +
        '            if (cls.indexOf("btnLogout") !== -1) {' +
        '                triggerShowProfiles(e);' +
        '                return;' +
        '            }' +
        '            var tag = el.tagName ? el.tagName.toUpperCase() : "";' +
        '            if (tag === "BUTTON" || tag === "A" || cls.indexOf("listItem") !== -1) {' +
        '                var t = (el.innerText || el.textContent || "").trim().toLowerCase();' +
        '                if (t === "sign out" || t === "log out" || t === "logout") {' +
        '                    triggerShowProfiles(e);' +
        '                    return;' +
        '                }' +
        '            }' +
        '            el = el.parentNode;' +
        '        }' +
        '    }, true);' +
        '    ensureButtons();' +
        '    setInterval(ensureButtons, 1000);' +
        '    if (typeof MutationObserver !== "undefined") {' +
        '        try {' +
        '            var obs = new MutationObserver(function() { ensureButtons(); });' +
        '            var root = document.body || document.documentElement;' +
        '            if (root) { obs.observe(root, { childList: true, subtree: true }); }' +
        '        } catch (e) {}' +
        '    }' +
        '})();';
}

window.addEventListener('message', function (msg) {
    msg = msg.data;
    if (!msg || !msg.type) {
        return;
    }

    console.log('Wrapper received message type:', msg.type);

    var contentFrame = document.querySelector('#contentFrame');

    switch (msg.type) {
        case 'showProfiles':
            // Clear any currently active auth so we re-open profile selection
            authenticatedUser = null;
            authToken = null;

            stopDiscovery();
            document.querySelector('.container').style.display = '';
            hideConnecting();

            contentFrame.style.display = 'none';
            contentFrame.src = '';

            // If the iframe provided a serverId, use it; otherwise use profiles.currentServer or first connected_servers entry
            var serverToShow = null;
            var allServers = getConnectedServers();
            if (msg.serverId && allServers && allServers[msg.serverId]) {
                serverToShow = allServers[msg.serverId];
            } else if (profiles && profiles.currentServer) {
                serverToShow = profiles.currentServer;
            } else if (allServers) {
                var serverKeys = Object.keys(allServers);
                if (serverKeys.length > 0) {
                    serverToShow = allServers[serverKeys[0]];
                }
            }

            if (serverToShow) {
                // Always show profile selection when switching users
                startProfileSelection(serverToShow, { forceShowSelection: true });
            } else {
                // fallback: show discovery/server list so user can pick
                startDiscovery();
            }
            break;
        case 'selectServer':
            // Clear auth state when returning to server selection
            authenticatedUser = null;
            authToken = null;

            startDiscovery();
            document.querySelector('.container').style.display = '';
            hideConnecting();
            contentFrame.style.display = 'none';
            contentFrame.src = '';
            break;
        case 'AppHost.exit':
            webOS.platformBack();
            break;
    }
});

/* Server auto-discovery */

var discovered_servers = {};
var connected_servers = {};

function renderServerList(server_list) {
    for (var server_id in server_list) {
        var server = server_list[server_id];
        renderSingleServer(server_id, server);
    }
}

function renderSingleServer(server_id, server) {
    var server_list = document.getElementById("serverlist");
    var server_card = document.getElementById("server_" + server.Id);

    if (!server_card) {
        server_card = document.createElement("li");
        server_card.id = "server_" + server_id;
        server_card.className = "server_card";
        server_list.appendChild(server_card);
    }
    server_card.innerHTML = "";

    // Server name
    var title = document.createElement("div");
    title.className = "server_card_title";
    title.innerText = server.Name;
    server_card.appendChild(title);

    // Server URL
    var server_url = document.createElement("div");
    server_url.className = "server_card_url";
    server_url.innerText = server.Address;
    server_card.appendChild(server_url);

    // Button
    var btn = document.createElement("button");
    btn.innerText = "Connect";
    btn.type = "button";
    btn.value = server.Address;
    btn.onclick = function () {
        var urlfield = document.getElementById("baseurl");
        urlfield.value = this.value;
        handleServerSelect();
    };
    server_card.appendChild(btn);
}


var servers_verifying = {};

function verifyThenAdd(server) {
    if (servers_verifying[server.Id]) {
        return;
    }
    servers_verifying[server.Id] = server;

    curr_req = ajax.request(normalizeUrl(server.Address + "/System/Info/Public"), {
        method: "GET",
        success: function (data) {
            console.log("success");
            console.log(server);
            console.log(data);

            // TODO: Do we want to autodiscover only Jellyfin servers, or anything that responds to "who is JellyfinServer?"
            if (data.ProductName == "Jellyfin Server") {
                server.system_info_public = data;
                if (!discovered_servers[server.Id]) {
                    discovered_servers[server.Id] = server;
                    renderServerList(discovered_servers);
                }
            }
            servers_verifying[server.Id] = true;
        },
        error: function (data) {
            console.log("error");
            console.log(server);
            console.log(data);
            servers_verifying[server.Id] = false;
        },
        abort: function () {
            console.log("abort");
            console.log(server);
            servers_verifying[server.Id] = false;
        },
        timeout: 5000
    });
}


var discover = null;

function startDiscovery() {
    if (discover) {
        return;
    }
    console.log("Starting server autodiscovery...");
    discover = webOS.service.request("luna://org.jellyfin.webos.service", {
        method: "discover",
        parameters: {
            uniqueToken: 'fooo'
        },
        subscribe: true,
        resubscribe: true,
        onSuccess: function (args) {
            console.log('OK:', JSON.stringify(args));

            if (args.results) {
                for (var server_id in args.results) {
                    verifyThenAdd(args.results[server_id]);
                }
            }
        },
        onFailure: function (args) {
            console.log('ERR:', JSON.stringify(args));
        }
    });
}

function stopDiscovery() {
    if (discover) {
        try {
            discover.cancel();
        } catch (err) {
            console.warn(err);
        }
        discover = null;
    }
}

startDiscovery();
