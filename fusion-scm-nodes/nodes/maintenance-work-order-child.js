/*
 Copyright (c) 2025 Oracle and/or its affiliates.
 The Universal Permissive License (UPL), Version 1.0
 */

module.exports = function(RED) {
    var childNode = require("../lib/work-order-child-node.js");
    var p = childNode.placeholders;

    childNode.registerWorkOrderChildNode(RED, "maintenance-work-order-child", {
        label: "Maintenance Work Order Child",
        outputProperty: "maintenanceWorkOrderChild",
        defaultResource: "operation",
        resources: {
            operation: {
                label: "Maintenance operation",
                actions: ["create", "list", "get", "update", "delete"],
                path: ["maintenanceWorkOrders", p.workOrderId(), "child", "WorkOrderOperation"],
                itemPlaceholder: p.childRecordId("Operation ID")
            },
            material: {
                label: "Maintenance operation material",
                actions: ["create", "list", "get", "update", "delete"],
                path: ["maintenanceWorkOrders", p.workOrderId(), "child", "WorkOrderOperation", p.operationId(), "child", "WorkOrderOperationMaterial"],
                itemPlaceholder: p.childRecordId("Material ID")
            },
            resource: {
                label: "Maintenance operation resource",
                actions: ["create", "list", "get", "update", "delete"],
                path: ["maintenanceWorkOrders", p.workOrderId(), "child", "WorkOrderOperation", p.operationId(), "child", "WorkOrderOperationResource"],
                itemPlaceholder: p.childRecordId("Resource ID")
            },
            costTransaction: {
                label: "Maintenance cost transaction",
                actions: ["create"],
                path: ["maintenanceOperationTransactions"]
            }
        }
    });
};
