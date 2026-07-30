function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
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

async function fetchAllCollectionPages(initialUrl, fetchPage) {
    var nextUrl = new URL(initialUrl);
    var firstResponse;
    var firstData;
    var items = [];
    var pageCount = 0;

    while (true) {
        var response = await fetchPage(nextUrl.toString());
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
        items = items.concat(data.items);

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
}

module.exports = {
    buildMeterReadingFinder: buildMeterReadingFinder,
    fetchAllCollectionPages: fetchAllCollectionPages
};
