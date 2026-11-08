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
    this.manageMode = false;
    this._numPinKeyHandler = null;
    this._numPinState = null;
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
 * Store auth data for a user on a server (preserves existing PIN and skip state)
 */
PROFILES.prototype.storeAuth = function (serverId, userId, token, userName, primaryImageTag, hasPassword) {
    var targetServerId = serverId || (this.currentServer && (this.currentServer.id || this.currentServer.Id));
    if (!targetServerId || !userId) return;
    var key = this.getAuthStorageKey(targetServerId);
    var authData = this.getStoredAuth(targetServerId);
    var existing = authData[userId] || {};
    var entry = {
        token: token,
        userName: userName || existing.userName,
        primaryImageTag: primaryImageTag !== undefined ? primaryImageTag : (existing.primaryImageTag || null),
        hasPassword: hasPassword !== undefined ? !!hasPassword : !!existing.hasPassword,
        timestamp: Date.now()
    };
    if (existing.pin) {
        entry.pin = existing.pin;
    }
    if (existing.pinPromptSkipped) {
        entry.pinPromptSkipped = true;
    }
    authData[userId] = entry;
    storage.set(key, authData);
};

/**
 * Clear only the stored token for a user (used when token is invalid; preserves PIN)
 */
PROFILES.prototype.clearToken = function (serverId, userId) {
    var ids = this.getCandidateServerIds(serverId);
    for (var i = 0; i < ids.length; i++) {
        var key = this.getAuthStorageKey(ids[i]);
        var data = storage.get(key);
        if (data && typeof data === 'object' && data[userId]) {
            delete data[userId].token;
            storage.set(key, data);
        }
    }
};

/**
 * Remove all auth data (including PIN) for a user (forget profile)
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
    if (Array.isArray(this.users)) {
        this.users = this.users.filter(function (u) {
            return !(u && u.Id === userId && u._saved);
        });
    }
};

/**
 * Get stored 4-digit PIN for a user, or null if not set
 */
PROFILES.prototype.getUserPin = function (serverId, userId) {
    var authData = this.getStoredAuth(serverId);
    if (authData[userId] && typeof authData[userId].pin === 'string' && authData[userId].pin.length === 4) {
        return authData[userId].pin;
    }
    return null;
};

/**
 * Set 4-digit PIN for a user
 */
PROFILES.prototype.setUserPin = function (serverId, userId, pin) {
    var targetServerId = serverId || (this.currentServer && (this.currentServer.id || this.currentServer.Id));
    if (!targetServerId || !userId) return;
    var cleanPin = (pin && typeof pin === 'string') ? pin : String(pin || '');
    var ids = this.getCandidateServerIds(targetServerId);
    var authData = this.getStoredAuth(targetServerId);
    var existing = authData[userId] || {};
    existing.pin = cleanPin;
    authData[userId] = existing;
    storage.set(this.getAuthStorageKey(targetServerId), authData);

    for (var i = 0; i < ids.length; i++) {
        var key = this.getAuthStorageKey(ids[i]);
        var data = storage.get(key);
        if (data && typeof data === 'object' && data[userId]) {
            data[userId].pin = cleanPin;
            storage.set(key, data);
        }
    }
};

/**
 * Clear PIN for a user
 */
PROFILES.prototype.clearUserPin = function (serverId, userId) {
    var ids = this.getCandidateServerIds(serverId);
    for (var i = 0; i < ids.length; i++) {
        var key = this.getAuthStorageKey(ids[i]);
        var data = storage.get(key);
        if (data && typeof data === 'object' && data[userId]) {
            delete data[userId].pin;
            storage.set(key, data);
        }
    }
};

/**
 * Check if initial PIN prompt was skipped for a user
 */
PROFILES.prototype.isPinPromptSkipped = function (serverId, userId) {
    var authData = this.getStoredAuth(serverId);
    return !!(authData[userId] && authData[userId].pinPromptSkipped);
};

/**
 * Mark initial PIN prompt as skipped for a user
 */
PROFILES.prototype.setPinPromptSkipped = function (serverId, userId, skipped) {
    var targetServerId = serverId || (this.currentServer && (this.currentServer.id || this.currentServer.Id));
    if (!targetServerId || !userId) return;
    var ids = this.getCandidateServerIds(targetServerId);
    var authData = this.getStoredAuth(targetServerId);
    var existing = authData[userId] || {};
    existing.pinPromptSkipped = !!skipped;
    authData[userId] = existing;
    storage.set(this.getAuthStorageKey(targetServerId), authData);

    for (var i = 0; i < ids.length; i++) {
        var key = this.getAuthStorageKey(ids[i]);
        var data = storage.get(key);
        if (data && typeof data === 'object' && data[userId]) {
            data[userId].pinPromptSkipped = !!skipped;
            storage.set(key, data);
        }
    }
};

/**
 * Check if any user on the current server has a stored token
 */
PROFILES.prototype.hasSavedUsers = function () {
    var serverId = this.currentServer ? (this.currentServer.id || this.currentServer.Id) : null;
    var authData = this.getStoredAuth(serverId);
    var userIds = Object.keys(authData);
    for (var i = 0; i < userIds.length; i++) {
        if (authData[userIds[i]] && authData[userIds[i]].token) {
            return true;
        }
    }
    return false;
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
    this.manageMode = false;
    options = options || {};

    // Check if Quick Connect is enabled on server
    this.checkQuickConnectEnabled(serverInfo.baseurl, function (enabled) {
        self.quickConnectEnabled = enabled;
        var container = document.getElementById('profileSelection');
        var grid = document.getElementById('profileGrid');
        if (enabled && !self.manageMode && container && container.style.display === 'flex' && grid && !grid.querySelector('.profile-card-quickconnect')) {
            var manageCard = grid.querySelector('.profile-card-manage');
            if (manageCard) {
                grid.insertBefore(self.createQuickConnectCard(), manageCard);
            } else {
                grid.appendChild(self.createQuickConnectCard());
            }
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
                    // Token invalid, clear token (keep PIN) and show selection
                    self.clearToken(serverInfo.id, user.Id);
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
    var headerEl = container ? container.querySelector('h1') : null;

    if (headerEl) {
        headerEl.textContent = this.manageMode ? 'Manage profiles' : "Who's watching?";
    }

    // Clear existing profiles
    grid.innerHTML = '';

    // Create profile cards
    this.users.forEach(function (user, index) {
        var card = self.createProfileCard(user, index);
        grid.appendChild(card);
    });

    if (this.manageMode) {
        var doneCard = this.createDoneCard();
        grid.appendChild(doneCard);
    } else {
        // Add "Add User" card for manual login
        var addCard = this.createAddUserCard();
        grid.appendChild(addCard);

        // Add "Quick Connect" card if enabled
        if (this.quickConnectEnabled) {
            var quickConnectCard = this.createQuickConnectCard();
            grid.appendChild(quickConnectCard);
        }

        // Add "Manage PINs" card if there are saved users
        if (this.hasSavedUsers()) {
            var manageCard = this.createManageCard();
            grid.appendChild(manageCard);
        }
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

    var serverId = this.currentServer ? (this.currentServer.id || this.currentServer.Id) : null;
    var hasPin = !!this.getUserPin(serverId, user.Id);
    var storedToken = this.getUserToken(serverId, user.Id);

    // Lock icon for password-protected or PIN-protected users (single icon)
    if (user.HasPassword || hasPin) {
        var lock = document.createElement('div');
        lock.className = 'profile-lock';
        lock.innerHTML = '&#128274;';
        card.appendChild(lock);
    }

    // Stored PIN / token indicator
    if (hasPin) {
        var pinProtected = document.createElement('div');
        pinProtected.className = 'profile-remembered';
        pinProtected.textContent = 'PIN protected';
        card.appendChild(pinProtected);
    } else if (storedToken) {
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
 * Create "Manage PINs" card
 */
PROFILES.prototype.createManageCard = function () {
    var self = this;
    var card = document.createElement('div');
    card.className = 'profile-card profile-card-manage';
    card.tabIndex = this.users.length + 2;

    var icon = document.createElement('div');
    icon.className = 'profile-avatar profile-avatar-placeholder';
    icon.innerHTML = '&#9881;';
    card.appendChild(icon);

    var name = document.createElement('div');
    name.className = 'profile-name';
    name.textContent = 'Manage PINs';
    card.appendChild(name);

    var enterManage = function () {
        self.manageMode = true;
        self.showProfileSelection();
    };

    card.onclick = enterManage;
    card.onkeydown = function (e) {
        if (e.keyCode === 13 || e.keyCode === 32) {
            e.preventDefault();
            enterManage();
        }
    };

    return card;
};

/**
 * Create "Done" card for exiting manage mode
 */
PROFILES.prototype.createDoneCard = function () {
    var self = this;
    var card = document.createElement('div');
    card.className = 'profile-card profile-card-manage';
    card.tabIndex = this.users.length;

    var icon = document.createElement('div');
    icon.className = 'profile-avatar profile-avatar-placeholder';
    icon.innerHTML = '&#10003;';
    card.appendChild(icon);

    var name = document.createElement('div');
    name.className = 'profile-name';
    name.textContent = 'Done';
    card.appendChild(name);

    var exitManage = function () {
        self.manageMode = false;
        self.showProfileSelection();
    };

    card.onclick = exitManage;
    card.onkeydown = function (e) {
        if (e.keyCode === 13 || e.keyCode === 32) {
            e.preventDefault();
            exitManage();
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

    if (this.manageMode) {
        this.manageProfile(user);
        return;
    }

    var serverId = this.currentServer ? (this.currentServer.id || this.currentServer.Id) : null;
    var storedPin = this.getUserPin(serverId, user.Id);

    if (storedPin) {
        this.showNumericPin({
            title: 'Enter PIN',
            subtitle: user.Name,
            mode: 'verify',
            buttons: { cancel: true },
            onComplete: function (enteredPin) {
                if (enteredPin === storedPin) {
                    self.hideNumericPin();
                    self.proceedSelectProfile(user);
                } else {
                    self.numPinShowError('Incorrect PIN');
                }
            },
            onCancel: function () {
                self.showProfileSelection();
            }
        });
        return;
    }

    this.proceedSelectProfile(user);
};

/**
 * Continue profile selection after PIN verification (or when no PIN is set)
 */
PROFILES.prototype.proceedSelectProfile = function (user) {
    var self = this;

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
            // Token invalid, clear token (preserve PIN) and prompt for password / manual login
            self.clearToken(self.currentServer.id, user.Id);
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
 * Manage PIN / profile in manage mode
 */
PROFILES.prototype.manageProfile = function (user) {
    var self = this;
    var serverId = this.currentServer ? (this.currentServer.id || this.currentServer.Id) : null;
    var storedToken = this.getUserToken(serverId, user.Id);

    if (!storedToken) {
        this.showError('Sign in first to set a PIN');
        return;
    }

    var existingPin = this.getUserPin(serverId, user.Id);

    var openManagePad = function () {
        var hasPinNow = !!self.getUserPin(serverId, user.Id);
        self.showNumericPin({
            title: 'Change PIN for ' + user.Name,
            subtitle: 'Enter a new 4-digit PIN',
            mode: 'manage',
            buttons: {
                remove: hasPinNow,
                forget: true,
                cancel: true
            },
            onComplete: function (newPin) {
                self.setUserPin(serverId, user.Id, newPin);
                self.hideNumericPin();
                self.showProfileSelection();
            },
            onRemove: function () {
                self.clearUserPin(serverId, user.Id);
                self.hideNumericPin();
                self.showProfileSelection();
            },
            onForget: function () {
                self.removeAuth(serverId, user.Id);
                self.hideNumericPin();
                if (!self.hasSavedUsers()) {
                    self.manageMode = false;
                }
                self.showProfileSelection();
            },
            onCancel: function () {
                self.showProfileSelection();
            }
        });
    };

    if (existingPin) {
        this.showNumericPin({
            title: 'Enter PIN',
            subtitle: user.Name,
            mode: 'verify',
            buttons: { cancel: true },
            onComplete: function (enteredPin) {
                if (enteredPin === existingPin) {
                    self.hideNumericPin();
                    openManagePad();
                } else {
                    self.numPinShowError('Incorrect PIN');
                }
            },
            onCancel: function () {
                self.showProfileSelection();
            }
        });
    } else {
        openManagePad();
    }
};

/**
 * Central post-login handler for fresh authentications
 */
PROFILES.prototype.finishLogin = function (user, token) {
    var self = this;
    this.hideLoading();
    var serverId = this.currentServer ? (this.currentServer.id || this.currentServer.Id) : null;
    var userId = user && user.Id;
    var existingPin = userId ? this.getUserPin(serverId, userId) : null;
    var skipped = userId ? this.isPinPromptSkipped(serverId, userId) : false;

    if (userId && !existingPin && !skipped) {
        this.showNumericPin({
            title: 'Set a PIN for ' + (user.Name || 'this profile') + '?',
            subtitle: '4-digit PIN to protect this profile on this TV',
            mode: 'set',
            buttons: { skip: true },
            onComplete: function (pin) {
                self.setUserPin(serverId, userId, pin);
                self.hideNumericPin();
                self.hideProfileSelection();
                self.onComplete(user, token);
            },
            onSkip: function () {
                self.setPinPromptSkipped(serverId, userId, true);
                self.hideNumericPin();
                self.hideProfileSelection();
                self.onComplete(user, token);
            }
        });
        return;
    }

    this.hideProfileSelection();
    this.onComplete(user, token);
};

/**
 * Authenticate user without password
 */
PROFILES.prototype.authenticateWithoutPassword = function (user) {
    var self = this;
    this.showLoading();

    this.authenticateUser(this.currentServer.baseurl, user.Id, user.Name, '', function (response) {
        self.finishLogin(response.User, response.AccessToken);
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
            self.finishLogin(response.User, response.AccessToken);
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
            self.finishLogin(response.User, response.AccessToken);
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
 * Show numeric PIN pad overlay
 */
PROFILES.prototype.showNumericPin = function (options) {
    var self = this;
    options = options || {};
    var buttons = options.buttons || {};
    var mode = options.mode || 'verify';

    this.hideNumericPin();

    var overlay = document.getElementById('numericPinOverlay');
    var titleEl = document.getElementById('numPinTitle');
    var subtitleEl = document.getElementById('numPinSubtitle');
    var dotsContainer = document.getElementById('numPinDots');
    var dots = dotsContainer ? dotsContainer.querySelectorAll('.num-pin-dot') : [];
    var errorEl = document.getElementById('numPinError');
    var pad = document.getElementById('numPinPad');
    var keys = pad ? Array.prototype.slice.call(pad.querySelectorAll('.num-pin-key')) : [];

    var btnSkip = document.getElementById('numPinSkip');
    var btnRemove = document.getElementById('numPinRemove');
    var btnForget = document.getElementById('numPinForget');
    var btnCancel = document.getElementById('numPinCancel');

    var initialTitle = options.title || 'Enter PIN';
    var initialSubtitle = options.subtitle || '';

    titleEl.textContent = initialTitle;
    subtitleEl.textContent = initialSubtitle;
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    if (dotsContainer) {
        dotsContainer.classList.remove('shake');
    }

    btnSkip.style.display = buttons.skip ? 'inline-block' : 'none';
    btnRemove.style.display = buttons.remove ? 'inline-block' : 'none';
    btnForget.style.display = buttons.forget ? 'inline-block' : 'none';
    btnCancel.style.display = buttons.cancel ? 'inline-block' : 'none';

    this._numPinState = {
        digits: '',
        mode: mode,
        step: 1,
        firstPin: '',
        initialTitle: initialTitle,
        initialSubtitle: initialSubtitle,
        options: options
    };

    var updateDots = function () {
        var len = self._numPinState ? self._numPinState.digits.length : 0;
        for (var i = 0; i < dots.length; i++) {
            if (i < len) {
                dots[i].classList.add('filled');
            } else {
                dots[i].classList.remove('filled');
            }
        }
    };

    updateDots();

    var handleComplete = function (enteredPin) {
        var state = self._numPinState;
        if (!state) return;

        if (state.mode === 'set' || state.mode === 'manage') {
            if (state.step === 1) {
                state.firstPin = enteredPin;
                state.step = 2;
                state.digits = '';
                titleEl.textContent = 'Confirm PIN';
                subtitleEl.textContent = 'Re-enter the 4-digit PIN';
                errorEl.style.display = 'none';
                updateDots();
                return;
            }
            if (enteredPin !== state.firstPin) {
                state.step = 1;
                state.firstPin = '';
                state.digits = '';
                titleEl.textContent = state.initialTitle;
                subtitleEl.textContent = state.initialSubtitle;
                self.numPinShowError('PINs did not match. Try again.');
                return;
            }
        }

        if (options.onComplete) {
            options.onComplete(enteredPin);
        }
    };

    var handleKeyInput = function (keyVal) {
        var state = self._numPinState;
        if (!state) return;

        if (keyVal === 'clear') {
            state.digits = '';
            errorEl.style.display = 'none';
            updateDots();
            return;
        }

        if (keyVal === 'back') {
            if (state.digits.length > 0) {
                state.digits = state.digits.slice(0, -1);
                updateDots();
            }
            return;
        }

        if (/^[0-9]$/.test(keyVal) && state.digits.length < 4) {
            errorEl.style.display = 'none';
            state.digits += keyVal;
            updateDots();
            if (state.digits.length === 4) {
                var completedPin = state.digits;
                setTimeout(function () {
                    handleComplete(completedPin);
                }, 80);
            }
        }
    };

    keys.forEach(function (btn) {
        btn.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            handleKeyInput(btn.getAttribute('data-key'));
        };
    });

    btnSkip.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (options.onSkip) {
            options.onSkip();
        } else {
            self.hideNumericPin();
        }
    };

    btnRemove.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (options.onRemove) {
            options.onRemove();
        }
    };

    btnForget.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (options.onForget) {
            options.onForget();
        }
    };

    btnCancel.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.hideNumericPin();
        if (options.onCancel) {
            options.onCancel();
        }
    };

    var getVisibleActions = function () {
        var list = [btnSkip, btnRemove, btnForget, btnCancel];
        return list.filter(function (b) {
            return b && b.style.display !== 'none';
        });
    };

    this._numPinKeyHandler = function (e) {
        if (!overlay || overlay.style.display !== 'flex') return;
        e.stopPropagation();
        if (e.stopImmediatePropagation) {
            e.stopImmediatePropagation();
        }

        var code = e.keyCode || e.which;

        // Top row numbers 0-9 (48-57)
        if (code >= 48 && code <= 57) {
            e.preventDefault();
            handleKeyInput(String(code - 48));
            return;
        }

        // Numpad numbers 0-9 (96-105)
        if (code >= 96 && code <= 105) {
            e.preventDefault();
            handleKeyInput(String(code - 96));
            return;
        }

        // Backspace
        if (code === 8) {
            e.preventDefault();
            handleKeyInput('back');
            return;
        }

        // Back (461) or Escape (27)
        if (code === 461 || code === 27) {
            e.preventDefault();
            if (buttons.cancel) {
                self.hideNumericPin();
                if (options.onCancel) {
                    options.onCancel();
                }
            }
            return;
        }

        // Enter (13) or Space (32)
        if (code === 13 || code === 32) {
            var active = document.activeElement;
            if (active && overlay.contains(active) && typeof active.click === 'function') {
                e.preventDefault();
                active.click();
            }
            return;
        }

        // D-pad arrows (37-40)
        if (code >= 37 && code <= 40) {
            e.preventDefault();
            var activeEl = document.activeElement;
            var keyIdx = keys.indexOf(activeEl);
            var visibleActions = getVisibleActions();
            var actionIdx = visibleActions.indexOf(activeEl);

            if (keyIdx !== -1) {
                var row = Math.floor(keyIdx / 3);
                var col = keyIdx % 3;
                if (code === 37 && col > 0) {
                    keys[keyIdx - 1].focus();
                } else if (code === 39 && col < 2) {
                    keys[keyIdx + 1].focus();
                } else if (code === 38 && row > 0) {
                    keys[keyIdx - 3].focus();
                } else if (code === 40) {
                    if (row < 3) {
                        keys[keyIdx + 3].focus();
                    } else if (visibleActions.length > 0) {
                        var targetAction = Math.min(col, visibleActions.length - 1);
                        visibleActions[targetAction].focus();
                    }
                }
            } else if (actionIdx !== -1) {
                if (code === 37 && actionIdx > 0) {
                    visibleActions[actionIdx - 1].focus();
                } else if (code === 39 && actionIdx < visibleActions.length - 1) {
                    visibleActions[actionIdx + 1].focus();
                } else if (code === 38 && keys.length >= 12) {
                    var targetCol = Math.min(2, actionIdx);
                    keys[9 + targetCol].focus();
                }
            } else if (keys.length > 0) {
                keys[0].focus();
            }
        }
    };

    overlay.style.display = 'flex';
    document.addEventListener('keydown', this._numPinKeyHandler, true);

    if (keys.length > 0) {
        keys[0].focus();
    }
};

/**
 * Show error on numeric PIN pad, shake dots, and clear entry
 */
PROFILES.prototype.numPinShowError = function (msg) {
    var dotsContainer = document.getElementById('numPinDots');
    var dots = dotsContainer ? dotsContainer.querySelectorAll('.num-pin-dot') : [];
    var errorEl = document.getElementById('numPinError');

    if (this._numPinState) {
        this._numPinState.digits = '';
    }

    for (var i = 0; i < dots.length; i++) {
        dots[i].classList.remove('filled');
    }

    if (errorEl) {
        errorEl.textContent = msg || 'Incorrect PIN';
        errorEl.style.display = 'block';
    }

    if (dotsContainer) {
        dotsContainer.classList.remove('shake');
        void dotsContainer.offsetWidth;
        dotsContainer.classList.add('shake');
        setTimeout(function () {
            dotsContainer.classList.remove('shake');
        }, 400);
    }
};

/**
 * Hide numeric PIN pad overlay
 */
PROFILES.prototype.hideNumericPin = function () {
    var overlay = document.getElementById('numericPinOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    if (this._numPinKeyHandler) {
        document.removeEventListener('keydown', this._numPinKeyHandler, true);
        this._numPinKeyHandler = null;
    }
    this._numPinState = null;
};

/**
 * Set up keyboard/remote navigation
 */
PROFILES.prototype.setupNavigation = function () {
    var grid = document.getElementById('profileGrid');
    var cards = grid.querySelectorAll('.profile-card');
    var cardArray = Array.prototype.slice.call(cards);

    grid.onkeydown = function (e) {
        var numPinOverlay = document.getElementById('numericPinOverlay');
        if (numPinOverlay && numPinOverlay.style.display === 'flex') return;

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
 * Go back to server selection (or exit manage mode)
 */
PROFILES.prototype.goBack = function () {
    if (this.manageMode) {
        this.manageMode = false;
        this.showProfileSelection();
        return;
    }
    this.stopQuickConnectPolling();
    this.hideQuickConnect();
    this.hideNumericPin();
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
                    self.finishLogin(authResponse.User, authResponse.AccessToken);
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
