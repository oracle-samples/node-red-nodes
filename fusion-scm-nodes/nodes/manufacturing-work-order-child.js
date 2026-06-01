/*
 Copyright (c) 2025 Oracle and/or its affiliates.
 The Universal Permissive License (UPL), Version 1.0
 */

module.exports = function(RED) {
    var childNode = require("../lib/work-order-child-node.js");
    var p = childNode.placeholders;

    childNode.registerWorkOrderChildNode(RED, "manufacturing-work-order-child", {
        label: "Manufacturing Work Order Child",
        outputProperty: "manufacturingWorkOrderChild",
        defaultResource: "operation",
        resources: {
            operation: {
                label: "Manufacturing operation",
                actions: ["create", "list", "get", "update", "delete"],
                path: ["workOrders", p.workOrderId(), "child", "WorkOrderOperation"],
                itemPlaceholder: p.childRecordId("Operation ID")
            },
            component: {
                label: "Manufacturing operation component",
                actions: ["create", "list", "get", "update", "delete"],
                path: ["workOrders", p.workOrderId(), "child", "WorkOrderOperation", p.operationId("Operation ID"), "child", "WorkOrderOperationMaterial"],
                itemPlaceholder: p.childRecordId("Component ID")
            },
            resource: {
                label: "Manufacturing operation resource",
                actions: ["create", "list", "get", "update", "delete"],
                path: ["workOrders", p.workOrderId(), "child", "WorkOrderOperation", p.operationId("Operation ID"), "child", "WorkOrderOperationResource"],
                itemPlaceholder: p.childRecordId("Resource ID")
            },
            serial: {
                label: "Manufacturing work order serial",
                actions: ["create", "list", "get", "delete"],
                path: ["workOrders", p.workOrderId(), "child", "WorkOrderSerialNumber"],
                itemPlaceholder: p.childRecordId("Serial ID")
            },
            progress: {
                label: "Manufacturing progress transaction",
                actions: ["create"],
                path: ["operationTransactions"]
            }
        }
    });
};
