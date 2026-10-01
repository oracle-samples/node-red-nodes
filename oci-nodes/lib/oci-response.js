const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function responseLimit(value) {
    if (value === undefined) return DEFAULT_MAX_RESPONSE_BYTES;
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0 ||
        number > require("node:buffer").constants.MAX_LENGTH) {
        const err = new Error("Max Response Bytes must be a positive integer within the Buffer size limit");
        err.code = "OCI_RESPONSE_LIMIT_INVALID";
        throw err;
    }
    return number;
}

function tooLarge(limit) {
    const err = new Error("OCI response exceeds Max Response Bytes (" + limit + ")");
    err.code = "OCI_RESPONSE_TOO_LARGE";
    return err;
}

async function cancelBody(value) {
    if (!value) return;
    try {
        if (typeof value.destroy === "function") value.destroy();
        else if (typeof value.getReader === "function") {
            const reader = value.getReader();
            try { await reader.cancel(); } finally { reader.releaseLock(); }
        } else if (typeof value.cancel === "function") await value.cancel();
        else if (typeof value[Symbol.asyncIterator] === "function") {
            const iterator = value[Symbol.asyncIterator]();
            if (typeof iterator.return === "function") await iterator.return();
        }
    } catch (err) {
        // Cleanup must not replace the response error.
    }
}

async function readBuffer(value, maxResponseBytes, contentLength) {
    const limit = responseLimit(maxResponseBytes);
    if (value && value.body && typeof value.body === "object") value = value.body;
    else if (value && typeof value.stream === "function") value = value.stream();
    if (Number(contentLength) > limit) {
        await cancelBody(value);
        throw tooLarge(limit);
    }
    if (value === undefined || value === null) return Buffer.alloc(0);

    let length = 0;
    const chunks = [];
    function append(chunk) {
        if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
            throw new Error("OCI response stream must contain bytes or text");
        }
        const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
        if (size === 0) return;
        if (size > limit - length) throw tooLarge(limit);
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (buffer.length > limit - length) throw tooLarge(limit);
        length += buffer.length;
        chunks.push(buffer);
    }
    if (typeof value === "string" || Buffer.isBuffer(value) || value instanceof Uint8Array) {
        append(value);
        return chunks[0] || Buffer.alloc(0);
    }
    if (typeof value.getReader === "function") {
        const reader = value.getReader();
        try {
            while (true) {
                const result = await reader.read();
                if (result.done) break;
                append(result.value);
            }
        } catch (err) {
            try { await reader.cancel(); } catch (cleanupError) { /* Preserve the original error. */ }
            throw err;
        } finally {
            reader.releaseLock();
        }
    } else if (typeof value[Symbol.asyncIterator] === "function") {
        try {
            for await (const chunk of value) append(chunk);
        } catch (err) {
            if (typeof value.destroy === "function") value.destroy();
            throw err;
        }
    } else {
        throw new Error("OCI response body is not a readable stream");
    }
    return Buffer.concat(chunks, length);
}

module.exports = { responseLimit, readBuffer };
