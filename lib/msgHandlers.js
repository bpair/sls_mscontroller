/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var AWS_REGION = "us-east-1";
if (process.env.hasOwnProperty("AWS_REGION")) {
    AWS_REGION = process.env.AWS_REGION;
}

var AWS = require('aws-sdk');
AWS.config.region = AWS_REGION;

var logger = require('winston');
if (process.env.hasOwnProperty('log_level')) {
    logger.level = process.env.log_level;
} else {
    logger.level = 'info';
}
let DFLT_SCHEMA = 2.2;
if (process.env.hasOwnProperty("dflt_schema")) {
    try {
        DFLT_SCHEMA = Number.parseFloat(process.env.dflt_schema);
    } catch (err) {
        logger.error('problem parsing environment variable for schema');
    }
}

var msgUtils = require('./messageUtils');


/*
Generic Error handler
*/
/**
 * Generic error handler. Formats error for response
 * @param {*} err - Error object
 * @param {*} event - Message event object
 * @param {*} context - Message context object
 * @param {*} msg - Error message
 */
function handleLambdaError(err, event, context, msg) {
    logger.info('msgHandlers.handleLambdaError()');
    logger.info('msgHandlers.handleLambdaError() err(String): %j' + err);
    let ctxTxt = "error - ";
    if (context && context.functionName) {
        ctxTxt = ctxTxt + context.functionName;
    }
    if (context && context.functionVersion) {
        ctxTxt = ctxTxt + ':' + context.functionVersion;
    }
    if (msg) {
        ctxTxt = ctxTxt + ':Msg=' + msg;
    }
    logger.info("msgHandlers.handleLambdaError(): before err inspection - ctxTxt= %s", ctxTxt);
    let errResp = {};
    if (err) {
        logger.info("msgHandlers.handleLambdaError(): typeof err = %s", typeof err);
        if (typeof err === 'string') {
            logger.info("msgHandlers.handleLambdaError(): err is string");
            if (err.length < 1) {
                logger.info("msgHandlers.handleLambdaError(): err is empty string");
                errResp.message = "[InternalError] - Unspecified";
            } else {
                if (err.startsWith('[')) {
                    errResp.message = err;
                } else {
                    errResp.message = "[InternalError] - " + err;
                }
            }
            ctxTxt = ctxTxt + ':ErrorMessage=' + errResp.message;
        } else if (typeof err === 'object') {
            logger.info("msgHandlers.handleLambdaError(): err is object - check attributes");
            if (err.hasOwnProperty('code')) {
                errResp.code = err.code;
                if (err.hasOwnProperty('message')) {
                    if (err.code == "ResourceNotFoundException") {
                        errResp.message = "[" + err.code + "] - " + err.message;
                    } else {
                        errResp.message = "[InternalError:" + err.code + "] - " + err.message;
                    }
                } else {
                    errResp.message = "[InternalError] - " + err.code;
                }
            } else {
                if (err.hasOwnProperty('message')) {
                    if (err.message.startsWith('[')) {
                        errResp.message = err.message;
                    } else {
                        errResp.message = "[InternalError] - " + err.message;
                    }
                } else if (err.toString().length > 0) {
                    if (err.toString().startsWith('[')) {
                        errResp.message = err.toString();
                    } else {
                        errResp.message = "[InternalError] - " + err.toString();
                    }
                } else {
                    errResp.message = "[InternalError] - Unspecified. " + err.toString();
                }
            }
            ctxTxt = ctxTxt + ':Err=' + errResp.message;
        } else {
            logger.info("msgHandlers.handleLambdaError(): err is not a string or object");
            errResp = {
                message: "[InternalError] - Unspecified",
                err: err
            };
        }
    }
    return errResp;
}
exports.handleLambdaError = handleLambdaError;

/*
    handleInboundMessage is triggered by a message coming from an external service
    such as Link-Labs. The steps for handling the message are as follows:
    1. Parse the publisher(gateway) from the message topic
    2. Compare publisher with the publisher in the message
    2. Lookup publisher in the AWS database (find by gwId, nodeId, sensorId)
    5. Transform message into standard format
    7. Route to correct handler
*/
function handleInboundEvent(event, context) {
    let methodName = 'handleInboundMessage';
    logger.info("%s - Event Object: %j", methodName, event);
    let schema = DFLT_SCHEMA;
    //add current system time
    event = msgUtils.enrichInboundEvent(event);
    let events = msgUtils.parsePayloads(event);
    events.forEach(element => {
        return Promise.resolve()
            .then(function (data) {
                return msgUtils.validateGenericEvent(element);
            })
            .then(function (data) {
                return msgUtils.handleEvent(element);
            });
    });
}
exports.handleInboundEvent = handleInboundEvent;

/*
    handleInboundMessage is triggered by a message coming from an external service
    such as Link-Labs. The steps for handling the message are as follows:
    1. Parse the publisher(gateway) from the message topic
    2. Compare publisher with the publisher in the message
    2. Lookup publisher in the AWS database (find by gwId, nodeId, sensorId)
    5. Transform message into standard format
    7. Route to correct handler
*/
function handleTelemetryEvent(event, context) {
    let methodName = 'handleInboundMessage';
    logger.info("%s - Event Object: %j", methodName, event);
    return Promise.all(event.Records.map(function (record) {
            console.log(JSON.stringify(record, null, 2));
            return msgUtils.postToES(JSON.stringify(record, null, 1));
        }))
        .then(function (data) {
            logger.info(`Successfully processed %d records.`, data.length);
            return ('Success');
        });
}
exports.handleTelemetryEvent = handleTelemetryEvent;