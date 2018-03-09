/*jshint node: true */
/*jshint esversion: 6 */
'use strict';
var logger = require('winston');
if (process.env.hasOwnProperty('log_level')) {
    logger.level = process.env.log_level;
} else {
    logger.level = 'info';
}
var REGION = "us-east-1";
if (process.env.hasOwnProperty("REGION")) {
    REGION = process.env.REGION;
}

var DB_ENDPOINT = "";
if (process.env.hasOwnProperty("DB_ENDPOINT")) {
    DB_ENDPOINT = process.env.DB_ENDPOINT;
}

var _ = require('lodash');
var AWS = require('aws-sdk');
AWS.config.region = REGION;

var serviceParams = {
    endpoint: process.env.DB_ENDPOINT
};
var docClient = new AWS.DynamoDB.DocumentClient(serviceParams);

const TABLENAME_ASSETINTEGRATION = 'Integration';
exports.TABLENAME_ASSETINTEGRATION = TABLENAME_ASSETINTEGRATION;

const INTEGRATIONFLDS = {
    KEY: 'key',
    VRS: 'vrs',
    GWID: 'gId',
    GWVRS: 'gVrs',
    NODEID: 'nId',
    NODEVRS: 'nVrs',
    NODESKTCHNM: 'nSktchNm',
    NODESKTCHVRS: 'nSktchVrs',
    SENSORID: 'sId',
    SENSORTYPE: 'sTyp',
    SENSORTYPEVAL: 'sTypVal',
    SENSORUNITS: 'sUnits',
    SENSORLSTTM: 'sLstTm', //Last Time Presented
    SENSORLSTTMISO: 'sLstTmIso', //Last Time Presented
    SENSORLSTTEL: 'sLstTel', //Last Telemetry Time
    SENSORLSTTELISO: 'sLstTelIso', //Last Telemetry Time
    SENSORLSTVAL: 'sLstVal' //Last Telemetry Value
};
exports.INTEGRATIONFLDS = INTEGRATIONFLDS;

///////////////////////////////////////////////////////////////////////////////
/**
 * Retrieve Integration details
 * 
 * @param {*} args 
 * @param {*} failsafe 
 * @param {*} tbl_prefix 
 */
function lookupIntegrationByKey(args, failsafe, tbl_prefix) {
    return new Promise(function (resolve, reject) {
        try {
            let dbParams = {
                TableName: tbl_prefix + TABLENAME_ASSETINTEGRATION
            };

            if (args.hasOwnProperty('key') && args.key) {
                dbParams.Key = {};
                dbParams.Key[INTEGRATIONFLDS.KEY] = args.key;
            } else {
                logger.error("Asset Key is required!");
                reject("[ValidationError] - Asset Key is required");
            }
            //for AssetState lets use StronglyConsistentReads
            dbParams.ConsistentRead = true;

            logger.info("lookupIntegrationByKey() dbParams: %j", dbParams);
            docClient.get(dbParams, function (err, data) {
                if (err) {
                    if (failsafe) {
                        logger.info("lookupIntegrationByKey DB Error (failsafe = true): %j", err);
                        resolve({});
                    } else {
                        logger.error("lookupIntegrationByKey DB Error: %j", err);
                        reject(err);
                    }
                } else {
                    logger.info("lookupIntegrationByKey DB results: %j", data);
                    resolve(data);
                }
            });
        } catch (err) {
            logger.error("lookupIntegrationByKey DB Error: %j", err);
            reject(err);
        }
    });
}
exports.lookupIntegrationByKey = lookupIntegrationByKey;

function updateIntegrationAttributes(key, updateExp, condExp, attNames, attVals, tbl_prefix, failsafe) {
    return new Promise(function (resolve, reject) {
        try {
            if (!tbl_prefix) {
                tbl_prefix = process.env.TABLE_PREFIX;
            }
            attVals = removeEmptyStrings(attVals);
            let dbParams = {
                TableName: tbl_prefix + TABLENAME_ASSETINTEGRATION,
                UpdateExpression: updateExp,
                ConditionExpression: condExp,
                ExpressionAttributeNames: attNames,
                ExpressionAttributeValues: attVals,
                ReturnValues: "ALL_NEW"
            };
            dbParams.Key = {};
            dbParams.Key[INTEGRATIONFLDS.KEY] = key;
            logger.info("Update Integration Attributes: dbParams: %j", dbParams);
            docClient.update(dbParams, function (err, data) {
                if (err) {
                    if (failsafe) {
                        logger.info("Update Integration Attributes DB Error (failsafe = true): %j", err);
                        resolve({});
                    } else {
                        logger.error("Update Integration Attributes DB Error: %j", err);
                        reject(err);
                    }
                } else {
                    logger.info("Update Integration Attributes DB results: %j", data);
                    resolve(data);
                }
            });
        } catch (err) {
            logger.error("Update Integration Attributes Error: %j", err);
            reject(err);
        }
    });
}
exports.updateIntegrationAttributes = updateIntegrationAttributes;

function putAssetIntegration(item, tblPrfx) {
    return new Promise(function (resolve, reject) {
        if (_.isNull(item) || !_.isObject(item)) {
            reject('Not Valid Integration Item supplied');
        }
        item = removeEmptyStrings(item);
        item.lastMod = new Date().toISOString();
        //Telemetry Data
        let params = {
            "TableName": tblPrfx + TABLENAME_ASSETINTEGRATION,
            "Item": item
        };
        logger.info("putAssetIntegration Param: %j", params);

        docClient.put(params, function (err, data) {
            if (err) {
                if (typeof err == 'string') {
                    logger.error("putAssetIntegration Item DB error: " + err);
                } else {
                    logger.error("putAssetIntegration Item DB error: %j", err);
                }
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}
exports.putAssetIntegration = putAssetIntegration;

//dynamoDB cannot handle any empty strings this function recursively checks for empty strings and removes them
function removeEmptyStrings(obj) {
    // logger.info("removeEmptyStrings: START %j", obj);
    Object.keys(obj).forEach(function (key) {
        if (obj[key] && typeof obj[key] === 'object') {
            removeEmptyStrings(obj[key]);
        } else if (typeof obj[key] === 'string' && '' === obj[key]) {
            delete obj[key];
        }
    });
    // logger.info("removeEmptyStrings: END %j", obj);
    return obj;
}
exports.removeEmptyStrings = removeEmptyStrings;

/*
 *  Retrieves node ids for a gateway. assumes no paged results
 */
function getGatewayNodeIds(gwId, tbl_prefix) {
    return new Promise(function (resolve, reject) {
        try {
            let ids = [];
            let dbParams = {
                TableName: tbl_prefix + TABLENAME_ASSETINTEGRATION,
                FilterExpression: "#g = :gv",
                ExpressionAttributeNames: {
                    '#g': INTEGRATIONFLDS.GWID
                },
                ExpressionAttributeValues: {
                    ':gv': gwId
                },
                ProjectionExpression: INTEGRATIONFLDS.NODEID
            };
            logger.info("Get Node Ids for a Gateway dbParams: %j", dbParams);
            docClient.scan(dbParams, function (err, data) {
                if (err) {
                    logger.error("getGatewayNodeIds DB Error: %j", err);
                    reject(err);
                } else {
                    logger.debug("getGatewayNodeIds results: %j", data);
                    if (data.Items && data.Items.length > 0) {
                        data.Items.forEach(element => {
                            ids.push(element[INTEGRATIONFLDS.NODEID]);
                        });
                    }
                    resolve(ids);
                }
            });
        } catch (err) {
            logger.error("getGatewayNodeIds Error: %j", err);
            reject(err);
        }
    });
}
exports.getGatewayNodeIds = getGatewayNodeIds;

/*
 *  Retrieves node ids for a gateway. assumes no paged results
 */
function getKeysByGatewayNodeId(gwId, nId, tbl_prefix) {
    return new Promise(function (resolve, reject) {
        try {
            let dbParams = {
                TableName: tbl_prefix + TABLENAME_ASSETINTEGRATION,
                FilterExpression: "#g = :gv, #n = :nv",
                ExpressionAttributeNames: {
                    '#g': INTEGRATIONFLDS.GWID,
                    '#n': INTEGRATIONFLDS.NODEID
                },
                ExpressionAttributeValues: {
                    ':gv': gwId,
                    ':nv': nId
                },
                ProjectionExpression: INTEGRATIONFLDS.KEY + ',' + INTEGRATIONFLDS.VRS
            };
            logger.info("Get Keys for a specific Gateway ad Node - dbParams: %j", dbParams);
            docClient.scan(dbParams, function (err, data) {
                if (err) {
                    logger.error("getKeysByGatewayNodeId DB Error: %j", err);
                    reject(err);
                } else {
                    logger.debug("getKeysByGatewayNodeId results: %j", data);
                    resolve(data);
                }
            });
        } catch (err) {
            logger.error("getKeysByGatewayNodeId Error: %j", err);
            reject(err);
        }
    });
}
exports.getKeysByGatewayNodeId = getKeysByGatewayNodeId;