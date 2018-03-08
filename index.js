/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var utils = require("lib/msgHandlers.js");

module.exports.inboundIntegrationEvent = function (event, context, cb) {
    console.info("Event Object: " + JSON.stringify(event, null, utils.JSON_STRINGIFY_SPACING));
    // console.info("Context Object: " + JSON.stringify(context, null, JSON_STRINGIFY_SPACING));
    Promise.resolve()
        .then(function (data) {
            return utils.handleInboundEvent(event, context);
        })
        .then(function (data) {
            cb(null, {
                message: 'Inbound Event Handled',
                data: data
            });
        }).catch(function (err) {
            err = utils.handleLambdaError(err, event, context, 'Unable to Handle Inbound Event');
            if (err) {
                if (typeof err === 'string') {
                    cb(err);
                } else {
                    cb(JSON.stringify(err));
                }
            } else {
                cb("[InternalError] - Unspecified");
            }
        });
};

exports.inboundIntegration = (event, context, callback) => {
    console.log('event: ' + JSON.stringify(event));
    console.log('context: ' + JSON.stringify(context));
    utils.handleInboundEvent(event);
    callback(null, 'Hello from Lambda');
};

module.exports.telemetryEvent = function (event, context, cb) {
    console.info("Event Object: " + JSON.stringify(event, null, utils.JSON_STRINGIFY_SPACING));
    // console.info("Context Object: " + JSON.stringify(context, null, JSON_STRINGIFY_SPACING));
    Promise.resolve()
        .then(function (data) {
            return utils.handleTelemetryEvent(event, context);
        })
        .then(function (data) {
            cb(null, {
                message: 'Telemetry Event Handled',
                data: data
            });
        }).catch(function (err) {
            err = utils.handleLambdaError(err, event, context, 'Unable to Handle Telemetry Event');
            if (err) {
                if (typeof err === 'string') {
                    cb(err);
                } else {
                    cb(JSON.stringify(err));
                }
            } else {
                cb("[InternalError] - Unspecified");
            }
        });
};

exports.telemetry = (event, context, callback) => {
    console.log('event: ' + JSON.stringify(event));
    console.log('context: ' + JSON.stringify(context));
    utils.handleTelemetryEvent(event);
    callback(null, 'Hello from Lambda');
};