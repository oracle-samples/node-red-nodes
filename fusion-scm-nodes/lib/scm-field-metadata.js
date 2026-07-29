var TEXT_FIELDS = [
    "AssetNumber", "Description", "ItemNumber", "OperatingOrganizationCode",
    "CurrentLocationContextCode", "MeterCode", "MeterUsageCode", "Comments",
    "SourceCode", "TransactionMode", "TransactionTypeName", "TransactionUnitOfMeasure",
    "SubinventoryCode", "TransferSubinventory", "AccountAliasName", "ReasonName",
    "WorkOrderNumber", "OrganizationCode", "WorkDefinitionCode", "WorkOrderStatusCode",
    "WorkOrderTypeCode", "WorkOrderSubTypeCode", "WorkOrderDescription",
    "MntWorkDefinitionCode", "CompletionSubinventoryCode", "OperationName",
    "OperationDescription", "WorkCenterCode", "UOMCode", "SupplySubinventory",
    "SupplyLocator", "ResourceCode", "UsageUOMCode", "SerialNumber",
    "WorkOrderProductSerialStatus", "InventoryItemNumber", "TransactionUOMCode",
    "AssemblyAssetNumber", "ComplSubinventoryCode"
];

var NUMBER_FIELDS = [
    "Quantity", "ReadingValue", "SourceHeaderId", "SourceLineId", "OrganizationId",
    "TransactionQuantity", "PlannedStartQuantity", "WorkOrderPriority",
    "OperationSequenceNumber", "WoOperationSequenceNumber", "RequiredQuantity",
    "RequiredUsage", "AssignedUnits"
];

var BOOLEAN_FIELDS = [
    "MaintainableFlag", "NewWoAllowedFlag", "UseCurrentCostFlag", "ExplosionFlag",
    "AllowCompletionToInventoryFlag", "AllowOutOfSequenceOperationCompletionFlag",
    "CountPointOperationFlag", "AutoTransactFlag"
];

var DATE_TIME_FIELDS = [
    "ReadingDate", "TransactionDate", "PlannedStartDate", "PlannedCompletionDate"
];

var JSON_FIELDS = ["serials", "TransactionSerial", "OperationTransactionDetail"];

var FIELD_TYPES = {};
TEXT_FIELDS.forEach(function (field) { FIELD_TYPES[field] = "text"; });
NUMBER_FIELDS.forEach(function (field) { FIELD_TYPES[field] = "number"; });
BOOLEAN_FIELDS.forEach(function (field) { FIELD_TYPES[field] = "boolean"; });
DATE_TIME_FIELDS.forEach(function (field) { FIELD_TYPES[field] = "dateTime"; });
JSON_FIELDS.forEach(function (field) { FIELD_TYPES[field] = "json"; });

function getFieldType(field) {
    return FIELD_TYPES[field] || null;
}

function validateRelativePath(mapping) {
    var value = String(mapping.value || "").trim();
    if (mapping.sourceType === "msg" && value.toLowerCase().startsWith("msg.")) {
        throw new Error("Enter the path for " + mapping.scmField + " relative to msg; remove the msg. prefix");
    }
    if (mapping.sourceType === "dequeued" &&
        (value.toLowerCase().startsWith("msg.dequeued.") || value.toLowerCase().startsWith("dequeued."))) {
        throw new Error(
            "Enter the path for " + mapping.scmField +
            " relative to msg.dequeued; remove the dequeued prefix"
        );
    }
}

function validateDateTime(mapping) {
    if (mapping.sourceType !== "static") return;
    var value = String(mapping.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new Error(mapping.scmField + " expects an ISO 8601 date-time");
    }
}

function staticTypeName(sourceType) {
    var names = {
        static: "static text",
        staticNumber: "static number",
        staticBoolean: "static boolean",
        staticJson: "static JSON"
    };
    return names[sourceType] || sourceType;
}

function validateStaticType(mapping, fieldType) {
    var sourceType = mapping.sourceType;
    if (["static", "staticNumber", "staticBoolean", "staticJson"].indexOf(sourceType) === -1) {
        return;
    }

    if (fieldType === "text" && sourceType !== "static") {
        var detail = "";
        if (sourceType === "staticNumber") {
            detail = " Static number would send " + Number(mapping.value) +
                " instead of \"" + String(mapping.value) + "\".";
        }
        throw new Error(mapping.scmField + " expects static text." + detail);
    }
    if (fieldType === "number" && sourceType !== "staticNumber" && sourceType !== "static") {
        throw new Error(mapping.scmField + " expects static number");
    }
    if (fieldType === "boolean" && sourceType !== "staticBoolean") {
        throw new Error(mapping.scmField + " expects static boolean");
    }
    if (fieldType === "json" && sourceType !== "staticJson") {
        throw new Error(mapping.scmField + " expects static JSON");
    }
    if (fieldType === "dateTime" && sourceType !== "static") {
        throw new Error(mapping.scmField + " expects static text containing an ISO 8601 date-time");
    }
}

function validateMappingDefinition(mapping) {
    validateRelativePath(mapping);
    var fieldType = getFieldType(mapping.scmField);
    if (!fieldType) return;
    validateStaticType(mapping, fieldType);
    if (fieldType === "dateTime") validateDateTime(mapping);
}

module.exports = {
    fields: FIELD_TYPES,
    getFieldType: getFieldType,
    validateMappingDefinition: validateMappingDefinition,
    staticTypeName: staticTypeName
};
