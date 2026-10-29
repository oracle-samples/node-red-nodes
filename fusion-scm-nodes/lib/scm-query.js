function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
}

function queryValidationError(message) {
    var err = new Error(message);
    err.scmQueryValidationError = true;
    return err;
}

function buildQueryEquality(field, value, type) {
    if (typeof field !== "string" || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(field)) {
        throw queryValidationError("Query field name is invalid");
    }
    if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") ||
        (typeof value === "number" && !Number.isFinite(value))) {
        throw queryValidationError(field + " requires a string, finite number, or boolean value");
    }
    if (type === "number") {
        var numeric = String(value).trim();
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(numeric) || !Number.isFinite(Number(numeric))) {
            throw queryValidationError(field + " requires a numeric value");
        }
        // Keep integer IDs exact even when they exceed JavaScript's safe integer range.
        return field + "=" + numeric;
    }
    if (typeof value === "string" || type === "string") {
        // REST framework 2 treats doubled apostrophes as part of a string literal.
        return field + "='" + String(value).replace(/'/g, "''") + "'";
    }
    return field + "=" + String(value);
}

function buildQueryExpression(primaryField, primaryValue, filters) {
    var parts = [];
    if (hasValue(primaryField) && hasValue(primaryValue)) {
        var type = primaryField === "OrganizationId" || primaryField === "OperationSequenceNumber"
            ? "number" : "string";
        parts.push(buildQueryEquality(primaryField, primaryValue, type));
    }
    Object.keys(filters || {}).forEach(function (field) {
        parts.push(buildQueryEquality(field, filters[field]));
    });
    return parts.join(" and ");
}

function buildMeterReadingFinder(assetNumber, meterCode) {
    var asset = requireFinderValue(assetNumber, "AssetNumber");
    var meter = requireFinderValue(meterCode, "MeterCode");
    return "MetersByAssetMeterUserKey;MntAssetNumber=" + asset + ",MntMeterCode=" + meter;
}

function requireFinderValue(value, label) {
    if (!hasValue(value)) {
        throw new Error(label + " is required");
    }
    var text = String(value).trim();
    if (/[;,]/.test(text)) {
        throw new Error(label + " must not contain ',' or ';'");
    }
    return text;
}

async function fetchAllCollectionPages(initialUrl, fetchPage, options) {
    options = options || {};
    var maxPages = options.maxPages || 1000;
    var maxItems = options.maxItems || 100000;
    var controller = new AbortController();
    var failure;
    var rejectAbort;
    var aborted = new Promise(function (resolve, reject) { rejectAbort = reject; });
    function stop(message, code) {
        if (failure) return;
        failure = new Error(message);
        failure.code = code;
        controller.abort();
        rejectAbort(failure);
    }
    function onAbort() { stop("Fusion collection request stopped", "SCM_REQUEST_STOPPED"); }
    if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true });
    var timer = setTimeout(function () { stop("Fusion collection pagination timed out", "SCM_PAGINATION_TIMEOUT"); }, options.timeoutMs || 120000);
    // Observe abort even if it occurs before the first page starts.
    aborted.catch(function () {});
    try {
        if (options.signal && options.signal.aborted) onAbort();

        var nextUrl = new URL(initialUrl);
        var firstResponse;
        var firstData;
        var items = [];
        var pageCount = 0;

        while (true) {
            if (failure) throw failure;
            if (pageCount >= maxPages) throw queryValidationError("Fusion collection page limit exceeded");
            var response = await Promise.race([fetchPage(nextUrl.toString(), controller.signal), aborted]);
            if (failure) throw failure;
            var data = response && response.data;
            if (!data || !Array.isArray(data.items)) {
                if (!firstResponse) {
                    return response;
                }
                throw new Error("Fusion returned an invalid collection page");
            }

            if (!firstResponse) {
                firstResponse = response;
                firstData = data;
            }
            pageCount += 1;
            if (items.length + data.items.length > maxItems) throw queryValidationError("Fusion collection item limit exceeded");
            for (var item of data.items) items.push(item);
            if (data.hasMore && data.items.length === 0) throw queryValidationError("Fusion returned an empty page claiming more results");

            if (!data.hasMore) {
                if (pageCount === 1) {
                    return response;
                }
                var combined = Object.assign({}, firstData, {
                    items: items,
                    count: items.length,
                    hasMore: false,
                    offset: 0
                });
                delete combined.links;
                if (Object.prototype.hasOwnProperty.call(firstData, "totalResults")) {
                    combined.totalResults = items.length;
                }
                return Object.assign({}, firstResponse, { data: combined });
            }

            var requestedOffset = Number(nextUrl.searchParams.get("offset")) || 0;
            var offset = Number(data.offset);
            if (!Number.isFinite(offset) || offset < 0) {
                offset = requestedOffset;
            } else if (offset < requestedOffset) {
                throw new Error("Fusion collection pagination did not advance");
            }
            var limit = Number(data.limit);
            if (!Number.isFinite(limit) || limit <= 0) {
                limit = data.items.length || 25;
            }
            var nextOffset = offset + limit;
            if (nextOffset <= requestedOffset) {
                throw new Error("Fusion collection pagination did not advance");
            }
            nextUrl.searchParams.set("offset", String(nextOffset));
        }
    } finally {
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener("abort", onAbort);
    }
}

module.exports = {
    QUERY_FRAMEWORK_VERSION: "2",
    buildQueryEquality: buildQueryEquality,
    buildQueryExpression: buildQueryExpression,
    buildMeterReadingFinder: buildMeterReadingFinder,
    fetchAllCollectionPages: fetchAllCollectionPages
};
