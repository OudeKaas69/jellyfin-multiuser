/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Profile selection and authentication management for Jellyfin WebOS
 */

var profiles = new PROFILES();

function PROFILES() {
    this.currentServer = null;
    this.users = [];
    this.selectedUser = null;
    this.onComplete = null;
    this.quickConnectSecret = null;
    this.quickConnectCode = null;
    this.quickConnectPollInterval = null;
    this.quickConnectEnabled = false;
}

/**
 * Storage keys for auth tokens
 */
PROFILES.prototype.getAuthStorageKey = function (serverId) {
    return 'jellyfin_auth_' + serverId;
};

/**
 * Get candidate server IDs for consistent lookup across id / Id / baseurl
 */
PROFILES.prototype.getCandidateServerIds = function (serverId) {
    var ids = [];
    function addId(val) {
        if (val && typeof val === 'string' && ids.indexOf(val) === -1) {
            ids.push(val);
        }
    }
    addId(serverId);
    if (this.currentServer) {
        addId(this.currentServer.id);
        addId(this.currentServer.Id);
        addId(this.currentServer.baseurl);
    }
    return ids;
};

/**
 * Get stored auth data for a server (merges across candidate server IDs)
 */
PROFILES.prototype.getStoredAuth = function (serverId) {
    var ids = this.getCandidateServerIds(serverId);
    var merged = {};
    // Iterate from fallback to primary so primary serverId overwrites older fallback entries
    for (var i = ids.length - 1; i >= 0; i--) {
        var key = this.getAuthStorageKey(ids[i]);
        var data = storage.get(key);
        if (data && typeof data === 'object') {
            var userIds = Object.keys(data);
            for (var j = 0; j < userIds.length; j++) {
                var uid = userIds[j];
                if (data[uid]) {
                    merged[uid] = data[uid];
                }
            }
        }
    }
    return merged;
};

/**
 * Store auth data for a user on a server
 */
PROFILES.prototype.storeAuth = function (serverId, userId, token, userName, primaryImageTag, hasPassword) {
    var targetServerId = serverId || (this.currentServer && (this.currentServer.id || this.currentServer.Id));
    if (!targetServerId || !userId) return;
    var key = this.getAuthStorageKey(targetServerId);
    var authData = this.getStoredAuth(targetServerId);
    var existing = authData[userId] || {};
    authData[userId] = {
        token: token,
        userName: userName || existing.userName,
        primaryImageTag: primaryImageTag !== undefined ? primaryImageTag : (existing.primaryImageTag || null),
        hasPassword: hasPassword !== undefined ? !!hasPassword : !!existing.hasPassword,
        timestamp: Date.now()
    };
    storage.set(key, authData);
};

/**
 * Remove auth data for a user
 */
PROFILES.prototype.removeAuth = function (serverId, userId) {
    var ids = this.getCandidateServerIds(serverId);
    for (var i = 0; i < ids.length; i++) {
        var key = this.getAuthStorageKey(ids[i]);
        var data = storage.get(key);
        if (data && typeof data === 'object' && data[userId]) {
            delete data[userId];
            storage.set(key, data);
        }
    }
};

/**
 * Merge public users with saved users from local storage
 */
PROFILES.prototype.getMergedUsers = function (publicUsers) {
    var list = Array.isArray(publicUsers) ? publicUsers.slice() : [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].Id) {
            seen[list[i].Id] = list[i];
        }
    }

    var serverId = this.currentServer ? (this.currentServer.id || this.currentServer.Id) : null;
    var storedAuth = this.getStoredAuth(serverId);
    var userIds = Object.keys(storedAuth);
    for (var j = 0; j < userIds.length; j++) {
        var uid = userIds[j];
        var entry = storedAuth[uid];
        if (!entry || !entry.userName) continue;
        if (!seen[uid]) {
            var savedUser = {
                Id: uid,
                Name: entry.userName,
                PrimaryImageTag: entry.primaryImageTag || null,
                HasPassword: false,
                _saved: true
            };
            list.push(savedUser);
            seen[uid] = savedUser;
        } else if (!seen[uid].PrimaryImageTag && entry.primaryImageTag) {
            seen[uid].PrimaryImageTag = entry.primaryImageTag;
        }
    }
    return list;
};

/**
 * Get auth token for a specific user
 */
PROFILES.prototype.getUserToken = function (serverId, userId) {
    var authData = this.getStoredAuth(serverId);
    if (authData[userId] && authData[userId].token) {
        return authData[userId].token;
    }
    return null;
};

/**
 * Fetch public users from server
 */
PROFILES.prototype.fetchUsers = function (baseurl, callback, errorCallback) {
    var self = this;
    ajax.request(normalizeUrl(baseurl + '/Users/Public'), {
        method: 'GET',
        success: function (data) {
            if (Array.isArray(data)) {
                self.users = data;
                callback(data);
            } else {
                errorCallback('Invalid response from server');
            }
        },
        error: function (err) {
            errorCallback(err);
        },
        timeout: 10000
    });
};

/**
 * Authenticate user with password/PIN
 */
PROFILES.prototype.authenticateUser = function (baseurl, userId, username, password, callback, errorCallback) {
    var self = this;
    var authHeader = 'MediaBrowser Client="Jellyfin WebOS", Device="' + appInfo.deviceName +
        '", DeviceId="' + appInfo.deviceId + '", Version="' + appInfo.appVersion + '"';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', normalizeUrl(baseurl + '/Users/AuthenticateByName'));
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-Emby-Authorization', authHeader);
    xhr.timeout = 10000;

    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                if (response.AccessToken) {
                    // Update server ID with the real ServerId from Jellyfin
                    // This is crucial for credential injection to work correctly
                    if (response.ServerId && self.currentServer) {
                        console.log('Updating server ID from', self.currentServer.id, 'to', response.ServerId);
                        self.currentServer.id = response.ServerId;
                        self.currentServer.Id = response.ServerId;
                    }
                    
                    self.storeAuth(
                        self.currentServer.id,
                        response.User.Id,
                        response.AccessToken,
                        response.User.Name,
                        response.User.PrimaryImageTag || null,
                        !!password || (response.User.HasPassword !== undefined ? response.User.HasPassword : false)
                    );
                    callback(response);
                } else {
                    errorCallback('No access token received');
                }
            } catch (e) {
                errorCallback('Invalid server response');
            }
        } else if (xhr.status === 401) {
            errorCallback('Invalid password');
        } else {
            errorCallback('Authentication failed: ' + xhr.status);
        }
    };

    xhr.onerror = function () {
        errorCallback('Network error');
    };

    xhr.ontimeout = function () {
        errorCallback('Request timed out');
    };

    xhr.send(JSON.stringify({
        Username: username,
        Pw: password || ''
    }));
};

/**
 * Validate an existing token
 */
PROFILES.prototype.validateToken = function (baseurl, userId, token, callback, errorCallback) {
    var authHeader = 'MediaBrowser Client="Jellyfin WebOS", Device="' + appInfo.deviceName +
        '", DeviceId="' + appInfo.deviceId + '", Version="' + appInfo.appVersion +
        '", Token="' + token + '"';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', normalizeUrl(baseurl + '/Users/' + userId));
    xhr.setRequestHeader('X-Emby-Authorization', authHeader);
    xhr.timeout = 10000;

    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                var user = JSON.parse(xhr.responseText);
                callback(user, token);
            } catch (e) {
                errorCallback('Invalid response');
            }
        } else {
            errorCallback('Token invalid');
        }
    };

    xhr.onerror = function () {
        errorCallback('Network error');
    };

    xhr.ontimeout = function () {
        errorCallback('Request timed out');
    };

    xhr.send();
};

/**
 * Check if profile selection is needed
 */
PROFILES.prototype.shouldShowProfileSelection = function () {
    // Show if there are multiple users or if the single user has a password
    if (this.users.length === 0) {
        return false;
    }
    if (this.users.length > 1) {
        return true;
    }
    // Single user - check if they have a password and no stored token
    var user = this.users[0];
    var storedToken = this.getUserToken(this.currentServer.id, user.Id);
    if (user.HasPassword && !storedToken) {
        return true;
    }
    return false;
};

/**
 * Initialize profile selection flow
 */
PROFILES.prototype.init = function (serverInfo, onComplete, options) {
    var self = this;
    if (serverInfo) {
        serverInfo.id = serverInfo.id || serverInfo.Id || serverInfo.baseurl;
        serverInfo.Id = serverInfo.Id || serverInfo.id;
    }
    this.currentServer = serverInfo;
    this.onComplete = onComplete;
    options = options || {};

    // Check if Quick Connect is enabled on server
    this.checkQuickConnectEnabled(serverInfo.baseurl, function (enabled) {
        self.quickConnectEnabled = enabled;
        var container = document.getElementById('profileSelection');
        var grid = document.getElementById('profileGrid');
        if (enabled && container && container.style.display === 'flex' && grid && !grid.querySelector('.profile-card-quickconnect')) {
            grid.appendChild(self.createQuickConnectCard());
            self.setupNavigation();
        }
    });

    this.fetchUsers(serverInfo.baseurl, function (users) {
        var mergedUsers = self.getMergedUsers(users);
        self.users = mergedUsers;

        if (mergedUsers.length === 0) {
            self.showProfileSelection();
            return;
        }

        // If caller requests forcing the profile selection (e.g. autoconnect should still show profiles),
        // bypass the automatic-auth path and show the selection UI.
        if (!options.forceShowSelection && !self.shouldShowProfileSelection()) {
            // Single user without password or with valid token
            var user = mergedUsers[0];
            var token = self.getUserToken(serverInfo.id, user.Id);
            if (token) {
                self.validateToken(serverInfo.baseurl, user.Id, token, function (validUser, validToken) {
                    self.storeAuth(
                        self.currentServer.id,
                        validUser.Id || user.Id,
                        validToken,
                        validUser.Name || user.Name,
                        validUser.PrimaryImageTag || user.PrimaryImageTag || null,
                        validUser.HasPassword
                    );
                    self.onComplete(validUser, validToken);
                }, function () {
                    // Token invalid, remove it and show selection
                    self.removeAuth(serverInfo.id, user.Id);
                    self.showProfileSelection();
                });
            } else if (!user.HasPassword && !user._saved) {
                // No password required, authenticate directly
                self.authenticateUser(serverInfo.baseurl, user.Id, user.Name, '', function (response) {
                    self.onComplete(response.User, response.AccessToken);
                }, function () {
                    // If forceShowSelection is true, show selection instead of auto-auth
                    self.showProfileSelection();
                });
            } else {
                self.showProfileSelection();
            }
        } else {
            self.showProfileSelection();
        }
    }, function (error) {
        console.error('Failed to fetch users:', error);
        self.users = self.getMergedUsers([]);
        self.showProfileSelection();
    });
};

/**
 * Show the profile selection UI
 */
PROFILES.prototype.showProfileSelection = function () {
    var self = this;
    var container = document.getElementById('profileSelection');
    var grid = document.getElementById('profileGrid');

    // Clear existing profiles
    grid.innerHTML = '';

    // Create profile cards
    this.users.forEach(function (user, index) {
        var card = self.createProfileCard(user, index);
        grid.appendChild(card);
    });

    // Add "Add User" card for manual login
    var addCard = this.createAddUserCard();
    grid.appendChild(addCard);

    // Add "Quick Connect" card if enabled
    if (this.quickConnectEnabled) {
        var quickConnectCard = this.createQuickConnectCard();
        grid.appendChild(quickConnectCard);
    }

    // Show the container
    this.hideLoading();
    document.querySelector('.container').style.display = 'none';
    document.getElementById('busy').style.display = 'none';
    container.style.display = 'flex';

    // Focus first profile
    var firstCard = grid.querySelector('.profile-card');
    if (firstCard) {
        firstCard.focus();
    }

    // Set up keyboard navigation
    this.setupNavigation();
};

/**
 * Create a profile card element
 */
PROFILES.prototype.createProfileCard = function (user, index) {
    var self = this;
    var card = document.createElement('div');
    card.className = 'profile-card';
    card.tabIndex = index;
    card.dataset.userId = user.Id;
    card.dataset.userName = user.Name;
    card.dataset.hasPassword = user.HasPassword ? 'true' : 'false';

    // Avatar
    var avatar = document.createElement('div');
    avatar.className = 'profile-avatar';

    if (user.PrimaryImageTag) {
        var img = document.createElement('img');
        img.src = normalizeUrl(this.currentServer.baseurl + '/Users/' + user.Id +
            '/Images/Primary?tag=' + user.PrimaryImageTag + '&quality=90&maxHeight=200');
        img.alt = user.Name;
        img.onerror = function () {
            this.style.display = 'none';
            avatar.classList.add('profile-avatar-placeholder');
            avatar.textContent = user.Name.charAt(0).toUpperCase();
        };
        avatar.appendChild(img);
    } else {
        avatar.classList.add('profile-avatar-placeholder');
        avatar.textContent = user.Name.charAt(0).toUpperCase();
    }

    card.appendChild(avatar);

    // Name
    var name = document.createElement('div');
    name.className = 'profile-name';
    name.textContent = user.Name;
    card.appendChild(name);

    // Lock icon for password-protected users
    if (user.HasPassword) {
        var lock = document.createElement('div');
        lock.className = 'profile-lock';
        lock.innerHTML = '&#128274;';
        card.appendChild(lock);
    }

    // Stored token indicator
    var storedToken = this.getUserToken(this.currentServer.id, user.Id);
    if (storedToken) {
        var remembered = document.createElement('div');
        remembered.className = 'profile-remembered';
        remembered.textContent = 'Remembered';
        card.appendChild(remembered);
    }

    // Click/Enter handler
    card.onclick = function () {
        self.selectProfile(user);
    };

    card.onkeydown = function (e) {
        if (e.keyCode === 13 || e.keyCode === 32) { // Enter or Space
            e.preventDefault();
            self.selectProfile(user);
        }
    };

    return card;
};

/**
 * Create "Add User" card for manual login
 */
PROFILES.prototype.createAddUserCard = function () {
    var self = this;
    var card = document.createElement('div');
    card.className = 'profile-card profile-card-add';
    card.tabIndex = this.users.length;

    var icon = document.createElement('div');
    icon.className = 'profile-avatar profile-avatar-placeholder';
    icon.textContent = '+';
    card.appendChild(icon);

    var name = document.createElement('div');
    name.className = 'profile-name';
    name.textContent = 'Add User';
    card.appendChild(name);

    card.onclick = function () {
        self.showManualLogin();
    };

    card.onkeydown = function (e) {
        if (e.keyCode === 13 || e.keyCode === 32) {
            e.preventDefault();
            self.showManualLogin();
        }
    };

    return card;
};

/**
 * Handle profile selection
 */
PROFILES.prototype.selectProfile = function (user) {
    var self = this;
    this.selectedUser = user;

    // Check for stored token first
    var storedToken = this.getUserToken(this.currentServer.id, user.Id);
    if (storedToken) {
        this.showLoading();
        this.validateToken(this.currentServer.baseurl, user.Id, storedToken, function (validUser, token) {
            self.hideLoading();
            self.storeAuth(
                self.currentServer.id,
                validUser.Id || user.Id,
                token,
                validUser.Name || user.Name,
                validUser.PrimaryImageTag || user.PrimaryImageTag || null,
                validUser.HasPassword
            );
            self.hideProfileSelection();
            self.onComplete(validUser, token);
        }, function () {
            self.hideLoading();
            // Token invalid, remove and prompt for password / manual login
            self.removeAuth(self.currentServer.id, user.Id);
            if (user._saved) {
                self.showManualLogin(user.Name);
            } else if (user.HasPassword) {
                self.showPinEntry(user);
            } else {
                self.authenticateWithoutPassword(user);
            }
        });
        return;
    }

    if (user._saved) {
        this.showManualLogin(user.Name);
    } else if (user.HasPassword) {
        this.showPinEntry(user);
    } else {
        this.authenticateWithoutPassword(user);
    }
};

/**
 * Authenticate user without password
 */
PROFILES.prototype.authenticateWithoutPassword = function (user) {
    var self = this;
    this.showLoading();

    this.authenticateUser(this.currentServer.baseurl, user.Id, user.Name, '', function (response) {
        self.hideProfileSelection();
        self.onComplete(response.User, response.AccessToken);
    }, function (error) {
        self.hideLoading();
        self.showError(error);
    });
};

/**
 * Show PIN/Password entry overlay
 */
PROFILES.prototype.showPinEntry = function (user) {
    var self = this;
    var overlay = document.getElementById('pinOverlay');
    var input = document.getElementById('pinInput');
    var userName = document.getElementById('pinUserName');
    var error = document.getElementById('pinError');

    userName.textContent = user.Name;
    input.value = '';
    error.style.display = 'none';
    overlay.style.display = 'flex';
    input.focus();

    // Store current handler references for cleanup
    this._pinKeyHandler = function (e) {
        if (e.keyCode === 13) { // Enter
            self.submitPin();
        } else if (e.keyCode === 461 || e.keyCode === 27) { // Back or Escape
            self.hidePinEntry();
        }
    };

    input.addEventListener('keydown', this._pinKeyHandler);
};

/**
 * Hide PIN entry overlay
 */
PROFILES.prototype.hidePinEntry = function () {
    var overlay = document.getElementById('pinOverlay');
    var input = document.getElementById('pinInput');

    overlay.style.display = 'none';
    input.value = '';

    if (this._pinKeyHandler) {
        input.removeEventListener('keydown', this._pinKeyHandler);
        this._pinKeyHandler = null;
    }

    // Refocus on the selected profile card
    var cards = document.querySelectorAll('.profile-card');
    if (cards.length > 0) {
        cards[0].focus();
    }
};

/**
 * Submit PIN/Password
 */
PROFILES.prototype.submitPin = function () {
    var self = this;
    var input = document.getElementById('pinInput');
    var error = document.getElementById('pinError');
    var password = input.value;

    if (!this.selectedUser) {
        return;
    }

    error.style.display = 'none';
    this.showLoading();

    this.authenticateUser(
        this.currentServer.baseurl,
        this.selectedUser.Id,
        this.selectedUser.Name,
        password,
        function (response) {
            self.hidePinEntry();
            self.hideProfileSelection();
            self.onComplete(response.User, response.AccessToken);
        },
        function (errMsg) {
            self.hideLoading();
            error.textContent = errMsg;
            error.style.display = 'block';
            input.value = '';
            input.focus();
        }
    );
};

/**
 * Show manual login form
 */
PROFILES.prototype.showManualLogin = function (prefillUsername) {
    var self = this;
    var overlay = document.getElementById('manualLoginOverlay');
    var usernameInput = document.getElementById('manualUsername');
    var passwordInput = document.getElementById('manualPassword');
    var error = document.getElementById('manualLoginError');

    if (this._manualLoginKeyHandler) {
        usernameInput.removeEventListener('keydown', this._manualLoginKeyHandler);
        passwordInput.removeEventListener('keydown', this._manualLoginKeyHandler);
        this._manualLoginKeyHandler = null;
    }

    usernameInput.value = typeof prefillUsername === 'string' ? prefillUsername : '';
    passwordInput.value = '';
    error.style.display = 'none';
    overlay.style.display = 'flex';
    if (usernameInput.value) {
        passwordInput.focus();
    } else {
        usernameInput.focus();
    }

    this._manualLoginKeyHandler = function (e) {
        if (e.keyCode === 13) { // Enter
            self.submitManualLogin();
        } else if (e.keyCode === 461 || e.keyCode === 27) { // Back or Escape
            self.hideManualLogin();
        }
    };

    usernameInput.addEventListener('keydown', this._manualLoginKeyHandler);
    passwordInput.addEventListener('keydown', this._manualLoginKeyHandler);
};

/**
 * Hide manual login overlay
 */
PROFILES.prototype.hideManualLogin = function () {
    var overlay = document.getElementById('manualLoginOverlay');
    var usernameInput = document.getElementById('manualUsername');
    var passwordInput = document.getElementById('manualPassword');

    overlay.style.display = 'none';

    if (this._manualLoginKeyHandler) {
        usernameInput.removeEventListener('keydown', this._manualLoginKeyHandler);
        passwordInput.removeEventListener('keydown', this._manualLoginKeyHandler);
        this._manualLoginKeyHandler = null;
    }

    var cards = document.querySelectorAll('.profile-card');
    if (cards.length > 0) {
        cards[0].focus();
    }
};

/**
 * Submit manual login
 */
PROFILES.prototype.submitManualLogin = function () {
    var self = this;
    var usernameInput = document.getElementById('manualUsername');
    var passwordInput = document.getElementById('manualPassword');
    var error = document.getElementById('manualLoginError');
    var username = usernameInput.value.trim();
    var password = passwordInput.value;

    if (!username) {
        error.textContent = 'Please enter a username';
        error.style.display = 'block';
        return;
    }

    error.style.display = 'none';
    this.showLoading();

    this.authenticateUser(
        this.currentServer.baseurl,
        null,
        username,
        password,
        function (response) {
            self.hideManualLogin();
            self.hideProfileSelection();
            self.onComplete(response.User, response.AccessToken);
        },
        function (errMsg) {
            self.hideLoading();
            error.textContent = errMsg;
            error.style.display = 'block';
            passwordInput.value = '';
            passwordInput.focus();
        }
    );
};

/**
 * Hide profile selection UI
 */
PROFILES.prototype.hideProfileSelection = function () {
    document.getElementById('profileSelection').style.display = 'none';
};

/**
 * Show loading indicator
 */
PROFILES.prototype.showLoading = function () {
    document.getElementById('profileLoading').style.display = 'flex';
};

/**
 * Hide loading indicator
 */
PROFILES.prototype.hideLoading = function () {
    document.getElementById('profileLoading').style.display = 'none';
};

/**
 * Show error message
 */
PROFILES.prototype.showError = function (message) {
    var error = document.getElementById('profileError');
    error.textContent = message;
    error.style.display = 'block';
    setTimeout(function () {
        error.style.display = 'none';
    }, 3000);
};

/**
 * Set up keyboard/remote navigation
 */
PROFILES.prototype.setupNavigation = function () {
    var grid = document.getElementById('profileGrid');
    var cards = grid.querySelectorAll('.profile-card');
    var cardArray = Array.prototype.slice.call(cards);

    grid.onkeydown = function (e) {
        var currentIndex = cardArray.indexOf(document.activeElement);
        if (currentIndex === -1) return;

        var newIndex = currentIndex;
        var columns = Math.floor(grid.offsetWidth / 200); // Approximate cards per row

        switch (e.keyCode) {
            case 37: // Left
                newIndex = Math.max(0, currentIndex - 1);
                break;
            case 39: // Right
                newIndex = Math.min(cardArray.length - 1, currentIndex + 1);
                break;
            case 38: // Up
                newIndex = Math.max(0, currentIndex - columns);
                break;
            case 40: // Down
                newIndex = Math.min(cardArray.length - 1, currentIndex + columns);
                break;
            case 461: // Back button
                e.preventDefault();
                profiles.goBack();
                return;
        }

        if (newIndex !== currentIndex) {
            e.preventDefault();
            cardArray[newIndex].focus();
        }
    };
};

/**
 * Go back to server selection
 */
PROFILES.prototype.goBack = function () {
    this.stopQuickConnectPolling();
    this.hideQuickConnect();
    this.hideProfileSelection();
    this.hidePinEntry();
    this.hideManualLogin();
    document.querySelector('.container').style.display = '';
    hideConnecting();
};

// ==================== QUICK CONNECT ====================

/**
 * Check if Quick Connect is enabled on the server
 */
PROFILES.prototype.checkQuickConnectEnabled = function (baseurl, callback) {
    ajax.request(normalizeUrl(baseurl + '/QuickConnect/Enabled'), {
        method: 'GET',
        success: function (data) {
            // Response is a boolean or string "true"/"false"
            var enabled = data === true || data === 'true' || data === 'True';
            callback(enabled);
        },
        error: function () {
            callback(false);
        },
        timeout: 5000
    });
};

/**
 * Initiate Quick Connect session
 */
PROFILES.prototype.initiateQuickConnect = function (callback, errorCallback) {
    var self = this;
    var authHeader = 'MediaBrowser Client="Jellyfin WebOS", Device="' + appInfo.deviceName +
        '", DeviceId="' + appInfo.deviceId + '", Version="' + appInfo.appVersion + '"';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', normalizeUrl(this.currentServer.baseurl + '/QuickConnect/Initiate'));
    xhr.setRequestHeader('X-Emby-Authorization', authHeader);
    xhr.timeout = 10000;

    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                if (response.Code && response.Secret) {
                    self.quickConnectCode = response.Code;
                    self.quickConnectSecret = response.Secret;
                    callback(response);
                } else {
                    errorCallback('Invalid Quick Connect response');
                }
            } catch (e) {
                errorCallback('Failed to parse Quick Connect response');
            }
        } else if (xhr.status === 401) {
            errorCallback('Quick Connect is not enabled on this server');
        } else {
            errorCallback('Quick Connect failed: ' + xhr.status);
        }
    };

    xhr.onerror = function () {
        errorCallback('Network error');
    };

    xhr.ontimeout = function () {
        errorCallback('Request timed out');
    };

    xhr.send();
};

/**
 * Poll Quick Connect status
 */
PROFILES.prototype.pollQuickConnect = function (callback, errorCallback) {
    var self = this;
    if (!this.quickConnectSecret) {
        errorCallback('No Quick Connect session');
        return;
    }

    var authHeader = 'MediaBrowser Client="Jellyfin WebOS", Device="' + appInfo.deviceName +
        '", DeviceId="' + appInfo.deviceId + '", Version="' + appInfo.appVersion + '"';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', normalizeUrl(this.currentServer.baseurl + '/QuickConnect/Connect?secret=' + this.quickConnectSecret));
    xhr.setRequestHeader('X-Emby-Authorization', authHeader);
    xhr.timeout = 10000;

    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                callback(response);
            } catch (e) {
                errorCallback('Invalid response');
            }
        } else {
            errorCallback('Poll failed: ' + xhr.status);
        }
    };

    xhr.onerror = function () {
        errorCallback('Network error');
    };

    xhr.ontimeout = function () {
        errorCallback('Request timed out');
    };

    xhr.send();
};

/**
 * Authenticate with Quick Connect secret
 */
PROFILES.prototype.authenticateWithQuickConnect = function (callback, errorCallback) {
    var self = this;
    if (!this.quickConnectSecret) {
        errorCallback('No Quick Connect session');
        return;
    }

    var authHeader = 'MediaBrowser Client="Jellyfin WebOS", Device="' + appInfo.deviceName +
        '", DeviceId="' + appInfo.deviceId + '", Version="' + appInfo.appVersion + '"';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', normalizeUrl(this.currentServer.baseurl + '/Users/AuthenticateWithQuickConnect'));
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-Emby-Authorization', authHeader);
    xhr.timeout = 10000;

    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                if (response.AccessToken && response.User) {
                    // Update server ID with the real ServerId from Jellyfin
                    // This is crucial for credential injection to work correctly
                    if (response.ServerId && self.currentServer) {
                        console.log('Quick Connect: Updating server ID from', self.currentServer.id, 'to', response.ServerId);
                        self.currentServer.id = response.ServerId;
                        self.currentServer.Id = response.ServerId;
                    }
                    
                    self.storeAuth(
                        self.currentServer.id,
                        response.User.Id,
                        response.AccessToken,
                        response.User.Name,
                        response.User.PrimaryImageTag || null,
                        response.User.HasPassword !== undefined ? response.User.HasPassword : false
                    );
                    callback(response);
                } else {
                    errorCallback('Invalid authentication response');
                }
            } catch (e) {
                errorCallback('Failed to parse response');
            }
        } else {
            errorCallback('Authentication failed: ' + xhr.status);
        }
    };

    xhr.onerror = function () {
        errorCallback('Network error');
    };

    xhr.ontimeout = function () {
        errorCallback('Request timed out');
    };

    xhr.send(JSON.stringify({
        Secret: this.quickConnectSecret
    }));
};

/**
 * Create Quick Connect card
 */
PROFILES.prototype.createQuickConnectCard = function () {
    var self = this;
    var card = document.createElement('div');
    card.className = 'profile-card profile-card-quickconnect';
    card.tabIndex = this.users.length + 1;

    var icon = document.createElement('div');
    icon.className = 'profile-avatar profile-avatar-placeholder';
    icon.innerHTML = '&#128279;'; // Link icon
    card.appendChild(icon);

    var name = document.createElement('div');
    name.className = 'profile-name';
    name.textContent = 'Quick Connect';
    card.appendChild(name);

    card.onclick = function () {
        self.showQuickConnect();
    };

    card.onkeydown = function (e) {
        if (e.keyCode === 13 || e.keyCode === 32) {
            e.preventDefault();
            self.showQuickConnect();
        }
    };

    return card;
};

/**
 * Show Quick Connect overlay
 */
PROFILES.prototype.showQuickConnect = function () {
    var self = this;
    var overlay = document.getElementById('quickConnectOverlay');
    var codeDisplay = document.getElementById('quickConnectCode');
    var status = document.getElementById('quickConnectStatus');
    var error = document.getElementById('quickConnectError');

    // Reset state
    codeDisplay.textContent = '------';
    status.textContent = 'Generating code...';
    error.style.display = 'none';
    overlay.style.display = 'flex';

    // Initiate Quick Connect
    this.initiateQuickConnect(function (response) {
        codeDisplay.textContent = response.Code;
        status.textContent = 'Enter this code in another Jellyfin app';
        self.startQuickConnectPolling();
    }, function (errMsg) {
        error.textContent = errMsg;
        error.style.display = 'block';
        status.textContent = 'Failed to start Quick Connect';
    });
};

/**
 * Hide Quick Connect overlay
 */
PROFILES.prototype.hideQuickConnect = function () {
    var overlay = document.getElementById('quickConnectOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    this.stopQuickConnectPolling();
    this.quickConnectSecret = null;
    this.quickConnectCode = null;

    // Refocus on profile grid
    var cards = document.querySelectorAll('.profile-card');
    if (cards.length > 0) {
        cards[0].focus();
    }
};

/**
 * Start polling for Quick Connect authorization
 */
PROFILES.prototype.startQuickConnectPolling = function () {
    var self = this;
    this.stopQuickConnectPolling(); // Clear any existing interval

    this.quickConnectPollInterval = setInterval(function () {
        self.pollQuickConnect(function (response) {
            if (response.Authenticated) {
                self.stopQuickConnectPolling();
                var status = document.getElementById('quickConnectStatus');
                status.textContent = 'Authorized! Signing in...';

                self.authenticateWithQuickConnect(function (authResponse) {
                    self.hideQuickConnect();
                    self.hideProfileSelection();
                    self.onComplete(authResponse.User, authResponse.AccessToken);
                }, function (errMsg) {
                    var error = document.getElementById('quickConnectError');
                    error.textContent = errMsg;
                    error.style.display = 'block';
                    status.textContent = 'Authentication failed';
                });
            }
        }, function (errMsg) {
            console.warn('Quick Connect poll error:', errMsg);
            // Continue polling unless it's a critical error
        });
    }, 2000); // Poll every 2 seconds
};

/**
 * Stop polling for Quick Connect
 */
PROFILES.prototype.stopQuickConnectPolling = function () {
    if (this.quickConnectPollInterval) {
        clearInterval(this.quickConnectPollInterval);
        this.quickConnectPollInterval = null;
    }
};
