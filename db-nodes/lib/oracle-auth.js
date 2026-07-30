/*
 Copyright (c) 2025 Oracle and/or its affiliates.
 The Universal Permissive License (UPL), Version 1.0

 Subject to the condition set forth below, permission is hereby granted to any
 person obtaining a copy of this software, associated documentation and/or data
 (collectively the "Software"), free of charge and under any and all copyright
 rights in the Software, and any and all patent rights owned or freely
 licensable by each licensor hereunder covering either (i) the unmodified
 Software as contributed to or provided by such licensor, or (ii) the Larger
 Works (as defined below), to deal in both

 (a) the Software, and
 (b) any piece of software and/or hardware listed in the
     lrgrwrks.txt file if one is included with the Software (each a "Larger
     Work" to which the Software is contributed by such licensors),

 without restriction, including without limitation the rights to copy, create
 derivative works of, display, perform, and distribute the Software and make,
 use, sell, offer for sale, import, export, have made, and have sold the
 Software and the Larger Work(s), and to sublicense the foregoing rights on
 either these or other terms.

 This license is subject to the following condition: The above copyright notice
 and either this complete permission notice or at a minimum a reference to the
 UPL must be included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

var fs = require("fs");
var path = require("path");

function buildBasicUsername(username, sessionUser) {
    var existingUsername = String(username || "");
    var separateSessionUser = String(sessionUser || "").trim();
    if (!separateSessionUser) return existingUsername;

    var bracketMatch = existingUsername.match(/^(.*)\[([^\[\]]+)\]$/);
    if (!bracketMatch) {
        return existingUsername + "[" + separateSessionUser + "]";
    }
    if (bracketMatch[2].toLowerCase() !== separateSessionUser.toLowerCase()) {
        throw new Error(
            "Session User does not match the bracketed session user in Username. " +
            "Clear Session User or enter matching values."
        );
    }
    return existingUsername;
}

function validateWalletDirectory(walletDirectory) {
    var stats;
    try {
        stats = fs.statSync(walletDirectory);
    } catch (err) {
        throw new Error("Wallet Directory could not be read. Enter an accessible extracted wallet directory.");
    }
    if (!stats.isDirectory()) {
        throw new Error("Wallet Directory must point to an extracted wallet directory, not a file.");
    }
}

function findClosingParenthesis(value, startIndex) {
    var depth = 0;
    var quoted = false;
    for (var i = startIndex; i < value.length; i += 1) {
        var ch = value.charAt(i);
        if (ch === '"' && value.charAt(i - 1) !== "\\") {
            quoted = !quoted;
        } else if (!quoted && ch === "(") {
            depth += 1;
        } else if (!quoted && ch === ")") {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function resolveTnsAlias(alias, walletDirectory) {
    var tnsnames;
    try {
        tnsnames = fs.readFileSync(path.join(walletDirectory, "tnsnames.ora"), "utf8");
    } catch (err) {
        throw new Error("Wallet Directory must contain a readable tnsnames.ora file for TNS alias resolution.");
    }

    var assignmentPattern = /^[ \t]*([A-Za-z0-9_$#.-]+(?:[ \t]*,[ \t]*[A-Za-z0-9_$#.-]+)*)[ \t]*=/gm;
    var assignment;
    while ((assignment = assignmentPattern.exec(tnsnames)) !== null) {
        var aliases = assignment[1].split(",").map(function (value) {
            return value.trim().toLowerCase();
        });
        if (aliases.indexOf(alias.toLowerCase()) === -1) continue;

        var descriptorStart = assignmentPattern.lastIndex;
        while (/\s/.test(tnsnames.charAt(descriptorStart))) descriptorStart += 1;
        if (tnsnames.charAt(descriptorStart) !== "(") {
            throw new Error("The configured TNS alias does not contain a valid connect descriptor.");
        }
        var descriptorEnd = findClosingParenthesis(tnsnames, descriptorStart);
        if (descriptorEnd === -1) {
            throw new Error("The configured TNS alias contains an incomplete connect descriptor.");
        }
        return tnsnames.slice(descriptorStart, descriptorEnd + 1);
    }

    throw new Error(
        'TNS alias "' + alias + '" was not found in the configured Wallet Directory.'
    );
}

function addWalletDirectoryToDescriptor(descriptor, walletDirectory) {
    if (/\(\s*my_wallet_directory\s*=/i.test(descriptor)) return descriptor;
    if (/[\r\n"]/.test(walletDirectory)) {
        throw new Error("Wallet Directory contains characters that cannot be used in a TNS descriptor.");
    }

    var setting = '(my_wallet_directory="' + walletDirectory + '")';
    var securityStart = descriptor.search(/\(\s*security\s*=/i);
    if (securityStart !== -1) {
        var securityEnd = findClosingParenthesis(descriptor, securityStart);
        if (securityEnd === -1) {
            throw new Error("TNS descriptor contains an incomplete SECURITY section.");
        }
        return descriptor.slice(0, securityEnd) + setting + descriptor.slice(securityEnd);
    }

    var outerEnd = findClosingParenthesis(descriptor, descriptor.indexOf("("));
    if (outerEnd === -1) {
        throw new Error("TNS descriptor is incomplete.");
    }
    return descriptor.slice(0, outerEnd) +
        "(security=" + setting + ")" +
        descriptor.slice(outerEnd);
}

function prepareConnectString(connectString, walletDirectory, effectiveMode, options) {
    options = options || {};
    var prepared = String(connectString || "").trim();
    var walletPath = String(walletDirectory || "").trim();
    var driverMode = String(effectiveMode || "thick").toLowerCase();
    if (!walletPath || driverMode !== "thick") return prepared;

    if (/^[A-Za-z0-9_$#.-]+\s*=/.test(prepared)) {
        throw new Error(
            "Enter either a TNS alias or only the descriptor after the alias assignment."
        );
    }
    var isDescriptor = prepared.charAt(0) === "(";
    var isAlias = /^[A-Za-z0-9_$#.-]+$/.test(prepared);
    if (!isDescriptor && !isAlias) return prepared;

    if (options.validateDirectory !== false) {
        validateWalletDirectory(walletPath);
    }
    if (isDescriptor) {
        return addWalletDirectoryToDescriptor(prepared, walletPath);
    }
    return addWalletDirectoryToDescriptor(
        resolveTnsAlias(prepared, walletPath),
        walletPath
    );
}

module.exports = {
    buildBasicUsername: buildBasicUsername,
    prepareConnectString: prepareConnectString
};
