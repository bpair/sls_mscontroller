/*jshint node: true */
/*jshint esversion: 6 */
'use strict';
var _ = require('lodash');
var logger = require('winston');
if (process.env.hasOwnProperty('log_level')) {
    logger.level = process.env.log_level;
} else {
    logger.level = 'info';
}

var shortid = require('shortid');
var AWS = require('aws-sdk');
AWS.config.region = process.env.SERVERLESS_REGION;
var iotdata = new AWS.IotData({
    endpoint: process.env.IOT_ENDPOINT
});
var iot = new AWS.Iot();

var envUtils = require('./envUtils');
var eventUtils = require('./eventUtils');

const JSON_STRINGIFY_SPACING = 4;
exports.JSON_STRINGIFY_SPACING = JSON_STRINGIFY_SPACING;

const MAX_VERSION_NUMBER = 2147483647;
exports.MAX_VERSION_NUMBER = MAX_VERSION_NUMBER;

/**
 * Get thing by thing name
 * 
 * @param {*} thingName 
 * @param {*} failSafe 
 */
function getThing(thingName, failSafe) {
    return new Promise(function (resolve, reject) {
        try {
            let params = {
                thingName: thingName
            };

            iot.describeThing(params, function (err, data) {
                if (err) {
                    logger.info("Could not find thing with name: " + thingName); // an error occurred
                    if (failSafe) {
                        logger.info('Ignore problems looking up thing'); // an error occurred
                        resolve(null);
                    } else {
                        reject(err);
                    }
                } else {
                    // logger.info('IoT Asset: %j"',data); // successful response
                    resolve(data);
                }
            });
        } catch (err) {
            if (failSafe) {
                logger.info('Ignore problems looking up thing'); // an error occurred
                resolve(null);
            } else {
                logger.info("IOT Error retrieving thing: %j", err);
                reject(err);
            }
        }
    });
}
exports.getThing = getThing;

/**
 * Find thing shadow by thing name
 * 
 * @param {*} thingName 
 * @param {*} failSafe 
 */
function findThingShadow(thingName, failSafe) {
    return new Promise(function (resolve, reject) {
        try {
            var params = {
                thingName: thingName
            };
            iotdata.getThingShadow(params, function (err, data) {
                if (err) {
                    logger.info('Thing Shadow Retrieval: %j', err);
                    logger.info('Error', err, err.stack); // an error occurred
                    if (failSafe) {
                        logger.info('Ignore problems looking up thing'); // an error occurred
                        resolve(null);
                    } else {
                        reject(err);
                    }
                } else {
                    if (!data.payload) {
                        logger.info('Thing Shadow Retrieval - No Payload in Response: %j', data);
                        if (failSafe) {
                            logger.info('Ignore problems looking up thing shadow payload'); // an error occurred
                            resolve(null);
                        } else {
                            reject(new Error('Thing Shadow Retrieval - No Payload in Response'));
                        }
                    } else {
                        logger.info('Thing Shadow: %s', data.payload);
                        let shdw = JSON.parse(data.payload);
                        // logger.info(JSON.stringify(data);
                        resolve(shdw);
                    }

                }
            });
        } catch (err) {
            if (failSafe) {
                logger.info('Ignore problems looking up thing shadow'); // an error occurred
                resolve(null);
            } else {
                logger.info("IOT Error retrieving thing shadow: %j", err);
                reject(err);
            }
        }
    });
}
exports.findThingShadow = findThingShadow;

/**
 * Non failsafe version of find thing shadow
 * 
 * @param {*} thingName 
 */
function getThingShadow(thingName) {
    return findThingShadow(thingName, false);
}
exports.getThingShadow = getThingShadow;

/**
 * Low Level Update thing shadow function
 * 
 * @param {*} thingName 
 * @param {*} payload 
 */
function updateThingShadow(thingName, payload) {
    return new Promise(function (resolve, reject) {
        try {
            var params = {
                thingName: thingName,
                payload: payload
            };
            logger.info('Thing Shadow Update: %j', payload);
            iotdata.updateThingShadow(params, function (err, data) {
                if (err) {
                    logger.info('Thing Shadow Update Error: %j', err);
                    logger.info(err, err.stack); // an error occurred
                    reject(err);
                } else {
                    if (!data.payload) {
                        logger.info('Thing Shadow Update Error - No Payload in Response: %j', data);
                        reject(new Error('Thing Shadow Update Error - No Payload in Response'));
                    } else {
                        // logger.info('Thing Shadow: %s', data.payload);
                        let shdw = JSON.parse(data.payload);
                        // logger.info(JSON.stringify(data);
                        resolve(shdw);
                    }
                }
            });
        } catch (err) {
            logger.info("IOT Error Updating Thing shadow: %j", err);
            reject(err);
        }
    });
}
//exports.updateThingShadow = updateThingShadow;

/**
 * Simulates a config change change request on teh shadow but does 
 * not change any data. If there is a delta it will be sent to the asset
 * 
 * @param {*} astId 
 * @param {*} clientToken 
 * @param {*} failSafe 
 */
function triggerShadowDelta(astId, clientToken, failSafe) {
    try {
        if (!astId) {
            return Promise.reject('[ValidationError] No asset Id found. ');
        }
        if (!clientToken) {
            clientToken = shortid.generate();
        }
        let msg = {
            state: {},
            clientToken: clientToken
        };
        return updateThingShadow(astId + '', JSON.stringify(msg, null, 0));
    } catch (err) {
        if (failSafe) {
            logger.info('Ignore problems triggering shadow delta: %j', err); // an error occurred
            return Promise.resolve(null);
        } else {
            logger.info("IOT Error triggering shadow delta: %j", err);
            return Promise.reject(err);
        }
    }
}
exports.triggerShadowDelta = triggerShadowDelta;

/**
 * Main (high-level) function for updating the desired section of a shadow. 
 * This function :
 * 
 * 1. Retrieves the shadow 
 * 2. Verifies the environment to prevent corruption
 * 3. Compares the version numbers to help prevent data corruption
 * 4. Increments desired version number
 * 5. Normalizes and sorts event arrays
 * 6. Trims any uncessary one-time events
 * 7. Compares events and only updates if there are changes
 * 8. Updates shadow 
 * 
 * @param {*} evnt 
 * @param {*} context 
 * @param {*} ignoreVersion 
 */
function updateDesiredShadowState(evnt, context, ignoreVersion) {
    ignoreVersion = typeof ignoreVersion !== 'undefined' ? ignoreVersion : false;
    // logger.info("updateDesiredShadowState devState: %j", evnt);
    if (!evnt.msgData) {
        return Promise.reject('[ValidationError] No msgData found. Event: %j', evnt);
    }
    if (!evnt.astId) {
        return Promise.reject('[ValidationError] No asset Id found. Event: %j', evnt);
    }
    return getThingShadow(evnt.astId)
        .then(function (thingShadow) {
            if (evnt.env && thingShadow && thingShadow.state && thingShadow.state.reported && thingShadow.state.reported.env) {
                if (!envUtils.inSameEnv(evnt.env, thingShadow.state.reported.env)) {
                    return Promise.reject('[ValidationError] Command is attampting to update a thing in a different environment. Message env = ' + evnt.env + ' and thing env = ' + thingShadow.state.reported.env);
                }
            }
            if (thingShadow && thingShadow.state && thingShadow.state.desired && thingShadow.state.desired.dsrdVrs) {
                // if (!ignoreVersion && thingShadow.version) {
                if (evnt.dsrdVrs) {
                    if (thingShadow.state.desired.dsrdVrs && evnt.dsrdVrs != thingShadow.state.desired.dsrdVrs) {
                        return Promise.reject('[ValidationError] Command is attempting to update a thing with an incorrect version number. Event version = ' + evnt.version + ' and thing version = ' + thingShadow.state.desired.dsrdVrs);
                    } else {
                        if (evnt.dsrdVrs >= MAX_VERSION_NUMBER) {
                            logger.info("Resetting dsrdVrs");
                            evnt.msgData.dsrdVrs = 1;
                        } else {
                            evnt.msgData.dsrdVrs = evnt.dsrdVrs + 1;
                        }
                    }
                } else {
                    return Promise.reject('[ValidationError] Command is attempting to update a thing without a version number. Message env = ' + evnt.env + ' and thing desired version = ' + thingShadow.state.desired.dsrdVrs);
                }
            } else {
                //make sure we add a version
                if (evnt.dsrdVrs) {
                    if (evnt.dsrdVrs >= MAX_VERSION_NUMBER) {
                        logger.info("Resetting dsrdVrs");
                        evnt.msgData.dsrdVrs = 1;
                    } else {
                        evnt.msgData.dsrdVrs = evnt.dsrdVrs + 1;
                    }
                } else {
                    evnt.msgData.dsrdVrs = 1;
                }
            }
            return thingShadow;
        })
        .then(function (thingShadow) {
            if (evnt.msgData.hasOwnProperty('rcrEvntsCfg') && _.isArray(evnt.msgData.rcrEvntsCfg)) {
                evnt.msgData.rcrEvntsCfg.forEach(function (element) {
                    if (element.hasOwnProperty('dysOfWk')) {
                        if (_.isString(element.dysOfWk)) {
                            var ary1 = element.dysOfWk.split(',');
                            for (let i = 0; i < ary1.length; i++) {
                                ary1[i] = Number.parseInt(ary1[i]);
                            }
                            element.dysOfWk = ary1;
                        } else if (_.isArray(element.dysOfWk) && !_.isEmpty(element.dysOfWk)) {
                            //check first element type
                            if (_.isString(element.dysOfWk[0])) {
                                var ary2 = [];
                                element.dysOfWk.forEach(function (e) {
                                    //we asume that all elements are strings
                                    ary2.push(Number.parseInt(e));
                                });
                                element.dysOfWk = ary2;
                            }
                        }
                    }
                });
                //sort before saving
                evnt.msgData.rcrEvntsCfg.sort(eventUtils.compareRecurringEvents);
            }
            if (evnt.msgData.hasOwnProperty('oneEvntsCfg')) {
                //sort before saving
                evnt.msgData.oneEvntsCfg.sort(eventUtils.compareOneTimeEvents);
            }

            //AWS does not compare arrays so we must do it
            //Recurring Events
            if (evnt.msgData.hasOwnProperty('rcrEvntsCfg') && thingShadow && thingShadow.state && thingShadow.state.desired && thingShadow.state.desired.hasOwnProperty('rcrEvntsCfg')) {
                logger.info("Recurring Events in config request supplied=" + JSON.stringify(evnt.msgData.rcrEvntsCfg, null, JSON_STRINGIFY_SPACING) + ", shadow=" + JSON.stringify(thingShadow.state.desired.rcrEvntsCfg, null, JSON_STRINGIFY_SPACING))
                if (eventUtils.compareRecurringEventArrays(evnt.msgData.rcrEvntsCfg, thingShadow.state.desired.rcrEvntsCfg) == 0) {
                    // they are the same so do not update
                    logger.info("Recurring Events in config request same as in shadow so not updating. supplied=" + JSON.stringify(evnt.msgData.rcrEvntsCfg, null, JSON_STRINGIFY_SPACING) + ", shadow=" + JSON.stringify(thingShadow.state.desired.rcrEvntsCfg, null, JSON_STRINGIFY_SPACING))
                    delete evnt.msgData.rcrEvntsCfg;
                }
            }
            //One-Time Events
            if (evnt.msgData.hasOwnProperty('oneEvntsCfg') && thingShadow && thingShadow.state && thingShadow.state.desired && thingShadow.state.desired.hasOwnProperty('oneEvntsCfg')) {
                if (eventUtils.compareOneTimeEventArrays(evnt.msgData.oneEvntsCfg, thingShadow.state.desired.oneEvntsCfg) == 0) {
                    // they are the same so do not update
                    logger.info("One-Time Events in config request same as in shadow so not updating. supplied=" + JSON.stringify(evnt.msgData.oneEvntsCfg, null, JSON_STRINGIFY_SPACING) + ", shadow=" + JSON.stringify(thingShadow.state.desired.oneEvntsCfg, null, JSON_STRINGIFY_SPACING))
                    delete evnt.msgData.oneEvntsCfg;
                } else {
                    //since we are updating lets trim
                    eventUtils.trimOneTimeEvents(evnt.msgData.oneEvntsCfg);
                }
            } else if (evnt.msgData.hasOwnProperty('oneEvntsCfg')) {
                //since we are updating lets trim
                logger.info("One-Time Events do not exist in shadow yet. supplied=" + JSON.stringify(evnt.msgData.oneEvntsCfg, null, JSON_STRINGIFY_SPACING) + ", shadow=" + JSON.stringify(thingShadow.state.desired.oneEvntsCfg, null, JSON_STRINGIFY_SPACING))
                eventUtils.trimOneTimeEvents(evnt.msgData.oneEvntsCfg);
                //the trimmed event could match
                if (eventUtils.compareOneTimeEventArrays(evnt.msgData.oneEvntsCfg, thingShadow.state.desired.oneEvntsCfg) == 0) {
                    // they are the same so do not update
                    logger.info("One-Time Events in config request same as in shadow so not updating. supplied=" + JSON.stringify(evnt.msgData.oneEvntsCfg, null, JSON_STRINGIFY_SPACING) + ", shadow=" + JSON.stringify(thingShadow.state.desired.oneEvntsCfg, null, JSON_STRINGIFY_SPACING))
                    delete evnt.msgData.oneEvntsCfg;
                }
            }

            let msg = {
                state: {
                    desired: evnt.msgData
                },
                clientToken: evnt.clientToken
                //, version: thingShadow.version
            };
            return updateThingShadow(evnt.astId, JSON.stringify(msg, null, 0));
        });
}
exports.updateDesiredShadowState = updateDesiredShadowState;


/**
 * Main (high-level) function for updating the reported section of a shadow. 
 * This function:
 * 
 * 1. Validates message for required attributes
 * 2. Normalizes message for any differences in attribute paths
 * 3. Retrieves the shadow 
 * 4. Verifies the environment to prevent corruption
 * 5. Compares the version numbers to help prevent data corruption
 * 6. If rptdVrs = 0 then treats the update like a full reset, clearing the reported section in teh shadow
 * 7. Translates any config data from Asset format to Cloud format
 * 8. Normalizes and sorts event arrays
 * 9. Updates shadow
 * 
 * @param {*} evnt 
 * @param {*} context 
 */
function updateReportedShadowState(evnt, context) {
    logger.info("updateReportedShadowState devState: %j", evnt);
    if (!evnt.msgData) {
        //commands use the msgData object for config details
        //boot and power up just pass the cfg details
        if (evnt.hasOwnProperty('sysCfg') || evnt.hasOwnProperty('opsCfg') || evnt.hasOwnProperty('ntwrkCfg') || evnt.hasOwnProperty('rptdVrs')) {
            evnt.msgData = {
                sysCfg: evnt.sysCfg,
                opsCfg: evnt.opsCfg,
                ntwrkCfg: evnt.ntwrkCfg,
                rptdVrs: evnt.rptdVrs
            };
        } else if (evnt.hasOwnProperty('msgTyp') && (evnt.msgTyp == 201 || evnt.msgTyp == 202)) {
            return 'Normal Operation message without any config data.';
        } else {
            //return Promise.reject('No config data found. Not updating the thing shadow. Event: ',evnt);
            logger.info('No config data found in config request. Not updating the thing shadow. Event: %j', evnt);
            return 'No config data found.';
        }
    }
    if (!evnt.astId) {
        return Promise.reject('[ValidationError] No asset Id found. Event: ' + JSON.stringify(evnt, null, JSON_STRINGIFY_SPACING));
    }
    if (!evnt.msgData.hasOwnProperty('rptdVrs') && !evnt.hasOwnProperty('rptdVrs')) {
        return Promise.reject('[ValidationError] No Reported Version found. Event: ' + JSON.stringify(evnt, null, JSON_STRINGIFY_SPACING));
    } else if (!evnt.hasOwnProperty('rptdVrs')) {
        evnt.rptdVrs = evnt.msgData.rptdVrs;
    } else {
        evnt.msgData.rptdVrs = evnt.rptdVrs;
    }
    if (evnt.msgData.hasOwnProperty('dsrdVrs')) {
        evnt.dsrdVrs = evnt.msgData.dsrdVrs;
    } else if (evnt.hasOwnProperty('dsrdVrs')) {
        evnt.msgData.dsrdVrs = evnt.dsrdVrs;
    }

    return getThingShadow(evnt.astId)
        .then(function (thingShadow) {
            if (evnt.env && thingShadow && thingShadow.state && thingShadow.state.reported && thingShadow.state.reported.env) {
                if (!envUtils.inSameEnv(evnt.env, thingShadow.state.reported.env)) {
                    return Promise.reject('[ValidationError] Command is attampting to update a thing in a different environment. Message env = ' + evnt.env + ' and thing env = ' + thingShadow.state.reported.env);
                }
            }
            //rptdVrs in the shadow must be in the desired section so that is included in the Delta messages
            if (thingShadow && thingShadow.state && thingShadow.state.desired) {

                if (thingShadow.state.desired.hasOwnProperty('rptdVrs')) {
                    // if (!ignoreVersion && thingShadow.version) {
                    if (evnt.hasOwnProperty('rptdVrs')) {
                        //**** Update even if version is old. Worst case is we sed the config down again by the scheduled job **** */
                        //allowing equal versions for now in case response is split into multiple messages
                        // if (evnt.rptdVrs != 0 && evnt.rptdVrs < thingShadow.state.desired.rptdVrs && MAX_VERSION_NUMBER != thingShadow.state.desired.rptdVrs) {
                        //     logger.info('[AssetConfigResponse] Updating a thing with an incorrect Reported version number. Thing reported version = ' + evnt.rptdVrs + ' and thing shadow reported version = ' + thingShadow.state.desired.rptdVrs);
                        //     //rather than reject lets just resolve
                        //     return Promise.resolve('[ValidationError] Command is attempting to update a thing with an incorrect version number. Event reported version = ' + evnt.rptdVrs + ' and thing reported version = ' + thingShadow.state.desired.rptdVrs);
                        // }
                    }
                    // if (evnt.msgData.hasOwnProperty('dsrdVrs') && thingShadow.state.desired.hasOwnProperty('dsrdVrs') && evnt.msgData.dsrdVrs < thingShadow.state.desired.dsrdVrs) {
                    //     //asset is still behind the desired so set the clienToken indicating another request
                    //     evnt.clientToken = 'AU-UPDT';
                    // }
                }
            }
            if (evnt.msgData.hasOwnProperty('dsrdVrs')) {
                delete evnt.msgData.dsrdVrs;
            }
            return thingShadow;

        })
        .then(function (thingShadow) {
            logger.debug("check for conversion and sorting. evnt.msgData: %j , thingshadow: %j", evnt.msgData, thingShadow);
            if (evnt.msgData.hasOwnProperty('rcrEvntsCfg')) {
                logger.debug("check recurring events %j", evnt.msgData.rcrEvntsCfg);
                let evnts = [];
                if (!_.isNull(thingShadow) && _.has(thingShadow, 'state.reported.rcrEvntsCfg') && _.isArray(thingShadow.state.reported.rcrEvntsCfg)) {
                    evnts = thingShadow.state.reported.rcrEvntsCfg;
                }
                if (evnt.msgData.hasOwnProperty('rcrEvntsCfgCnt')) {
                    //size the reported array to match
                    logger.debug('Sizing the recurring array from %d to %d', evnts.length, evnt.msgData.rcrEvntsCfgCnt);
                    evnts.length = evnt.msgData.rcrEvntsCfgCnt;
                    logger.debug("check recurring events resize shadow events %j", evnts);
                }

                //for version 1 assets we need to sort but have to convert the daysOfWeek first
                evnt.msgData.rcrEvntsCfg.forEach(function (element, i) {
                    logger.debug("forEach recurring. i=%d,  element: %j", i, element);
                    if (!_.isNil(element)) { //ignore empty elements
                        if (element.hasOwnProperty('dysOfWk') && _.isNumber(element.dysOfWk)) {
                            element.dysOfWk = eventUtils.convertDaysOfWeekBitValueToArray(element.dysOfWk);
                        }
                        eventUtils.translateEventDataForShadow(element);
                    } else {
                        logger.debug('Empty Element pos: %d', i);
                    }
                });

                evnt.msgData.rcrEvntsCfg.sort(eventUtils.compareRecurringEvents);

                evnt.msgData.rcrEvntsCfg.forEach(function (element, i) {
                    logger.debug("forEach recurring. i=%d,  element: %j", i, element);
                    if (!_.isNil(element)) { //ignore empty elements
                        let c = i;
                        if (element.hasOwnProperty('pos')) {
                            logger.debug('Setting pos to value %d, was %d', element.pos, c);
                            c = element.pos;
                            delete element.pos;
                        } else {
                            logger.debug('Event element does not have a position %j', element);
                        }
                        evnts[c] = element;
                    } else {
                        logger.debug('Empty Element pos: %d', i);
                    }
                });
                evnt.msgData.rcrEvntsCfg = evnts;
            }
            if (evnt.msgData.hasOwnProperty('oneEvntsCfg')) {
                logger.debug("check one-time events %j", evnt.msgData.oneEvntsCfg);
                let evnts = [];
                if (!_.isNull(thingShadow) && _.has(thingShadow, 'state.reported.oneEvntsCfg') && _.isArray(thingShadow.state.reported.oneEvntsCfg)) {
                    evnts = thingShadow.state.reported.oneEvntsCfg;
                }
                logger.debug("check one-time events begin with sahdow events %j", evnts);
                if (evnt.msgData.hasOwnProperty('oneEvntsCfgCnt')) {
                    //size the reported array to match
                    logger.debug('Sizing the onetime array from %d to %d', evnts.length, evnt.msgData.oneEvntsCfgCnt);
                    evnts.length = evnt.msgData.oneEvntsCfgCnt;
                    logger.debug("check one-time events resize sahdow events %j", evnts);
                }
                //for version 1 assets we need to sort
                evnt.msgData.oneEvntsCfg.sort(eventUtils.compareOneTimeEvents);
                evnt.msgData.oneEvntsCfg.forEach(function (element, i) {
                    logger.debug("forEach one-time. i=%d,  element: %j", i, element);
                    if (!_.isNil(element)) { //ignore empty elements
                        eventUtils.translateEventDataForShadow(element);
                        let c = i;
                        if (element.hasOwnProperty('pos')) {
                            logger.debug('Setting pos to value %d, was %d', element.pos, c);
                            c = element.pos;
                            delete element.pos;
                        } else {
                            logger.debug('Event element does not have a position %j', element);
                        }
                        evnts[c] = element;
                    } else {
                        logger.debug('Empty Element pos: %d', i);
                    }
                });
                //sort before saving
                evnt.msgData.oneEvntsCfg = evnts;
                // }
            }
            if (evnt.msgData.hasOwnProperty('opsCfg')) {
                if (_.has(evnt, 'msgData.opsCfg.tzOfst')) {
                    if (_.isNumber(evnt.msgData.opsCfg.tzOfst)) {
                        if (evnt.msgData.opsCfg.tzOfst > -15 && evnt.msgData.opsCfg.tzOfst < 15) {
                            //old format used hours
                            let oldTz = Math.round(evnt.msgData.opsCfg.tzOfst * 60);
                            logger.debug('Convert shadow tzOfst from %d to %d', evnt.msgData.opsCfg.tzOfst, oldTz);
                            evnt.msgData.opsCfg.tzOfst = oldTz;
                        }
                    }
                }
            }
            if (evnt.msgData.hasOwnProperty('rcrEvntsCfgCnt')) {
                delete evnt.msgData.rcrEvntsCfgCnt;
            }
            if (evnt.msgData.hasOwnProperty('oneEvntsCfgCnt')) {
                delete evnt.msgData.oneEvntsCfgCnt;
            }
            if (evnt.msgData.hasOwnProperty('ops')) {
                delete evnt.msgData.ops;
            }

            //avoid putting garbage in teh shadow by picking attributes
            // let msg = {
            //     state: {
            //         desired: {
            //             rptdVrs: evnt.rptdVrs
            //         },
            //         reported: {
            //             opsCfg: evnt.msgData.opsCfg,
            //             sysCfg: evnt.msgData.sysCfg,
            //             ntwrkCfg: evnt.msgData.ntwrkCfg,
            //             rcrEvntsCfg: evnt.msgData.rcrEvntsCfg,
            //             oneEvntsCfg: evnt.msgData.oneEvntsCfg,
            //             rptdVrs: evnt.rptdVrs
            //         }
            //     },
            //     clientToken: evnt.clientToken
            //     //,                version: evnt.version
            // };
            return thingShadow;
        })
        .then(function (thingShadow) {
            let msg = {
                state: {
                    desired: {
                        rptdVrs: evnt.rptdVrs
                    },
                    reported: evnt.msgData
                },
                clientToken: evnt.clientToken
                //,                version: evnt.version
            };
            if (evnt.rptdVrs == 0) {
                //asset was reset
                msg.state.reported = null;
            }

            return updateThingShadow(evnt.astId, JSON.stringify(msg, null, 0));
        });
}
exports.updateReportedShadowState = updateReportedShadowState;