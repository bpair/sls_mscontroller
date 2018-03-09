/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

const os = require('os');

var _ = require('lodash');
var path = require('path');

var REGION = "us-east-1";
if (process.env.hasOwnProperty("REGION")) {
    REGION = process.env.REGION;
}

var IOT_ENDPOINT = null;
if (process.env.hasOwnProperty("IOT_ENDPOINT")) {
    IOT_ENDPOINT = process.env.IOT_ENDPOINT;
}

var ES_REGION = "us-east-1";
if (process.env.hasOwnProperty("ES_REGION")) {
    ES_REGION = process.env.ES_REGION;
}

var ES_ENDPOINT = "";
if (process.env.hasOwnProperty("ES_ENDPOINT")) {
    ES_ENDPOINT = process.env.ES_ENDPOINT;
}

var ES_INDEX = "ms_v1";
if (process.env.hasOwnProperty("ES_INDEX")) {
    ES_INDEX = process.env.ES_INDEX;
}

var ES_DOCTYPE = "ms_v1";
if (process.env.hasOwnProperty("ES_DOCTYPE")) {
    ES_DOCTYPE = process.env.ES_DOCTYPE;
}

/* == Globals == */
// var esDomain = {
//     region: ES_REGION,
//     endpoint: ES_ENDPOINT,
//     index: ES_INDEX,
//     doctype: ES_DOCTYPE
// };
var ENV = "dev";
if (process.env.hasOwnProperty("ENV")) {
    ENV = process.env.ENV;
}
var TBLPRE = ENV + '_';


var AWS = require('aws-sdk');
AWS.config.region = REGION;
// var endpoint = new AWS.Endpoint(esDomain.endpoint);
/*
 * The AWS credentials are picked up from the environment.
 * They belong to the IAM role assigned to the Lambda function.
 * Since the ES requests are signed using these credentials,
 * make sure to apply a policy that allows ES domain operations
 * to the role.
 */
var creds = new AWS.EnvironmentCredentials('AWS');

var iotdata = null;
if (IOT_ENDPOINT) {
    iotdata = new AWS.IotData({
        endpoint: IOT_ENDPOINT
    });
}
var dbUtils = require('./dbUtils');


var BATTERY_SENSOR_ID = 255;
if (process.env.hasOwnProperty("BATTERY_SENSOR_ID")) {
    BATTERY_SENSOR_ID = +process.env.BATTERY_SENSOR_ID;
}
exports.BATTERY_SENSOR_ID = BATTERY_SENSOR_ID;

var MAX_NODEID = 254;
if (process.env.hasOwnProperty("MAX_NODEID")) {
    MAX_NODEID = +process.env.MAX_NODEID;
}
exports.MAX_NODEID = MAX_NODEID;

var CONFIG_UNITS = 'M';
if (process.env.hasOwnProperty("CONFIG_UNITS")) {
    CONFIG_UNITS = process.env.CONFIG_UNITS;
}
exports.CONFIG_UNITS = CONFIG_UNITS;

var TOPIC_IN = 'in';
if (process.env.hasOwnProperty("TOPIC_IN")) {
    TOPIC_IN = process.env.TOPIC_IN;
}
exports.TOPIC_IN = TOPIC_IN;

var TOPIC_OUT = 'out';
if (process.env.hasOwnProperty("TOPIC_OUT")) {
    TOPIC_OUT = process.env.TOPIC_OUT;
}
exports.TOPIC_OUT = TOPIC_OUT;

var CORE_TOPIC_PREFIX = 'ms';
if (process.env.hasOwnProperty("CORE_TOPIC_PREFIX")) {
    CORE_TOPIC_PREFIX = process.env.CORE_TOPIC_PREFIX;
}
exports.TOPIC_OUT = TOPIC_OUT;

var logger = require('winston');
if (process.env.hasOwnProperty('log_level')) {
    logger.level = process.env.log_level;
} else {
    logger.level = 'info';
}

const TOKEN_SEPERATOR = ';';
exports.TOKEN_SEPERATOR = TOKEN_SEPERATOR;

const TOPIC_TELEMETRY = 'tel';
exports.TOPIC_TELEMETRY = TOPIC_TELEMETRY;

//MESSAGE ATTRIBUTES
const MSGATT = {
    RAW: 'raw', //raw message from node
    GWID: 'gId', //Gateway Identifier
    NODEID: 'nId', //Node Identifier
    SENSORID: 'sId', //Sensor Identifier
    CMD: 'cmd', //Command - See Commands below
    ACK: 'ack', //ACK Request
    TYP: 'typ', //TYPE - TYPE values depend on Command
    VAL: 'val', //Value - Value depends on Command and Type
    NUMVAL: 'nVal', //Value converted to a number
    TXTVAL: 'tVal', //Text Value
    TOPIC: 'topic', //Topic of original Message
    KEY: 'key', //Unique Identifier for GWID, NODEID, and SENSORID
    TM: 'tm', //TM data was recorded at Sensor (UTC)
    TMISO: 'tmIso', //TM in ISO format
    SYSTM: 'sysTm', //System Time message was received (UTC); Messages may be batched at Gateway
    SYSTMISO: 'sysTmIso', //SYSTEM Time in ISO format
};
exports.MSGATT = MSGATT;

/*
The message format is from the MySensors project, mysensors.org
Please check it out and support them
*/

//COMMANDS
const CMD = {
    PRESENTATION: 0,
    SET: 1,
    REQUEST: 2,
    INTERNAL: 3,
    STREAM: 4
};
exports.CMD = CMD;

/// Type of sensor (used when presenting sensors)
const SENSORTYP = {
    S_DOOR: 0, //!< Door sensor, V_TRIPPED, V_ARMED
    S_MOTION: 1, //!< Motion sensor, V_TRIPPED, V_ARMED
    S_SMOKE: 2, //!< Smoke sensor, V_TRIPPED, V_ARMED
    S_BINARY: 3, //!< Binary light or relay, V_STATUS, V_WATT
    S_LIGHT: 3, //!< \deprecated Same as S_BINARY
    S_DIMMER: 4, //!< Dimmable light or fan device, V_STATUS (on/off), V_PERCENTAGE (dimmer level 0-100), V_WATT
    S_COVER: 5, //!< Blinds or window cover, V_UP, V_DOWN, V_STOP, V_PERCENTAGE (open/close to a percentage)
    S_TEMP: 6, //!< Temperature sensor, V_TEMP
    S_HUM: 7, //!< Humidity sensor, V_HUM
    S_BARO: 8, //!< Barometer sensor, V_PRESSURE, V_FORECAST
    S_WIND: 9, //!< Wind sensor, V_WIND, V_GUST
    S_RAIN: 10, //!< Rain sensor, V_RAIN, V_RAINRATE
    S_UV: 11, //!< Uv sensor, V_UV
    S_WEIGHT: 12, //!< Personal scale sensor, V_WEIGHT, V_IMPEDANCE
    S_POWER: 13, //!< Power meter, V_WATT, V_KWH, V_VAR, V_VA, V_POWER_FACTOR
    S_HEATER: 14, //!< Header device, V_HVAC_SETPOINT_HEAT, V_HVAC_FLOW_STATE, V_TEMP
    S_DISTANCE: 15, //!< Distance sensor, V_DISTANCE
    S_LIGHT_LEVEL: 16, //!< Light level sensor, V_LIGHT_LEVEL (uncalibrated in percentage), V_LEVEL (light level in lux)
    S_ARDUINO_NODE: 17, //!< Used (internally) for presenting a non-repeating Arduino node
    S_ARDUINO_REPEATER_NODE: 18, //!< Used (internally) for presenting a repeating Arduino node
    S_LOCK: 19, //!< Lock device, V_LOCK_STATUS
    S_IR: 20, //!< IR device, V_IR_SEND, V_IR_RECEIVE
    S_WATER: 21, //!< Water meter, V_FLOW, V_VOLUME
    S_AIR_QUALITY: 22, //!< Air quality sensor, V_LEVEL
    S_CUSTOM: 23, //!< Custom sensor
    S_DUST: 24, //!< Dust sensor, V_LEVEL
    S_SCENE_CONTROLLER: 25, //!< Scene controller device, V_SCENE_ON, V_SCENE_OFF.
    S_RGB_LIGHT: 26, //!< RGB light. Send color component data using V_RGB. Also supports V_WATT
    S_RGBW_LIGHT: 27, //!< RGB light with an additional White component. Send data using V_RGBW. Also supports V_WATT
    S_COLOR_SENSOR: 28, //!< Color sensor, send color information using V_RGB
    S_HVAC: 29, //!< Thermostat/HVAC device. V_HVAC_SETPOINT_HEAT, V_HVAC_SETPOINT_COLD, V_HVAC_FLOW_STATE, V_HVAC_FLOW_MODE, V_TEMP
    S_MULTIMETER: 30, //!< Multimeter device, V_VOLTAGE, V_CURRENT, V_IMPEDANCE
    S_SPRINKLER: 31, //!< Sprinkler, V_STATUS (turn on/off), V_TRIPPED (if fire detecting device)
    S_WATER_LEAK: 32, //!< Water leak sensor, V_TRIPPED, V_ARMED
    S_SOUND: 33, //!< Sound sensor, V_TRIPPED, V_ARMED, V_LEVEL (sound level in dB)
    S_VIBRATION: 34, //!< Vibration sensor, V_TRIPPED, V_ARMED, V_LEVEL (vibration in Hz)
    S_MOISTURE: 35, //!< Moisture sensor, V_TRIPPED, V_ARMED, V_LEVEL (water content or moisture in percentage?)
    S_INFO: 36, //!< LCD text device / Simple information device on controller, V_TEXT
    S_GAS: 37, //!< Gas meter, V_FLOW, V_VOLUME
    S_GPS: 38, //!< GPS Sensor, V_POSITION
    S_WATER_QUALITY: 39 //!< V_TEMP, V_PH, V_ORP, V_EC, V_STATUS
};
exports.SENSORTYP = SENSORTYP;

/// @brief Type of sensor data (for set/req/ack messages)
const SETTYPE = {
    V_TEMP: 0, //!< S_TEMP. Temperature S_TEMP, S_HEATER, S_HVAC
    V_HUM: 1, //!< S_HUM. Humidity
    V_STATUS: 2, //!< S_BINARY, S_DIMMER, S_SPRINKLER, S_HVAC, S_HEATER. Used for setting/reporting binary (on/off) status. 1;on, 0;off
    V_LIGHT: 2, //!< \deprecated Same as V_STATUS
    V_PERCENTAGE: 3, //!< S_DIMMER. Used for sending a percentage value 0-100 (%).
    V_DIMMER: 3, //!< \deprecated Same as V_PERCENTAGE
    V_PRESSURE: 4, //!< S_BARO. Atmospheric Pressure
    V_FORECAST: 5, //!< S_BARO. Whether forecast. string of "stable", "sunny", "cloudy", "unstable", "thunderstorm" or "unknown"
    V_RAIN: 6, //!< S_RAIN. Amount of rain
    V_RAINRATE: 7, //!< S_RAIN. Rate of rain
    V_WIND: 8, //!< S_WIND. Wind speed
    V_GUST: 9, //!< S_WIND. Gust
    V_DIRECTION: 10, //!< S_WIND. Wind direction 0-360 (degrees)
    V_UV: 11, //!< S_UV. UV light level
    V_WEIGHT: 12, //!< S_WEIGHT. Weight(for scales etc)
    V_DISTANCE: 13, //!< S_DISTANCE. Distance
    V_IMPEDANCE: 14, //!< S_MULTIMETER, S_WEIGHT. Impedance value
    V_ARMED: 15, //!< S_DOOR, S_MOTION, S_SMOKE, S_SPRINKLER. Armed status of a security sensor. 1: Armed, 0: Bypassed
    V_TRIPPED: 16, //!< S_DOOR, S_MOTION, S_SMOKE, S_SPRINKLER, S_WATER_LEAK, S_SOUND, S_VIBRATION, S_MOISTURE. Tripped status of a security sensor. 1: Tripped, 0
    V_WATT: 17, //!< S_POWER, S_BINARY, S_DIMMER, S_RGB_LIGHT, S_RGBW_LIGHT. Watt value for power meters
    V_KWH: 18, //!< S_POWER. Accumulated number of KWH for a power meter
    V_SCENE_ON: 19, //!< S_SCENE_CONTROLLER. Turn on a scene
    V_SCENE_OFF: 20, //!< S_SCENE_CONTROLLER. Turn of a scene
    V_HVAC_FLOW_STATE: 21, //!< S_HEATER, S_HVAC. HVAC flow state ("Off", "HeatOn", "CoolOn", or "AutoChangeOver")
    V_HEATER: 21, //!< \deprecated Same as V_HVAC_FLOW_STATE
    V_HVAC_SPEED: 22, //!< S_HVAC, S_HEATER. HVAC/Heater fan speed ("Min", "Normal", "Max", "Auto")
    V_LIGHT_LEVEL: 23, //!< S_LIGHT_LEVEL. Uncalibrated light level. 0-100%. Use V_LEVEL for light level in lux
    V_VAR1: 24, //!< VAR1
    V_VAR2: 25, //!< VAR2
    V_VAR3: 26, //!< VAR3
    V_VAR4: 27, //!< VAR4
    V_VAR5: 28, //!< VAR5
    V_UP: 29, //!< S_COVER. Window covering. Up
    V_DOWN: 30, //!< S_COVER. Window covering. Down
    V_STOP: 31, //!< S_COVER. Window covering. Stop
    V_IR_SEND: 32, //!< S_IR. Send out an IR-command
    V_IR_RECEIVE: 33, //!< S_IR. This message contains a received IR-command
    V_FLOW: 34, //!< S_WATER. Flow of water (in meter)
    V_VOLUME: 35, //!< S_WATER. Water volume
    V_LOCK_STATUS: 36, //!< S_LOCK. Set or get lock status. 1;Locked, 0;Unlocked
    V_LEVEL: 37, //!< S_DUST, S_AIR_QUALITY, S_SOUND (dB), S_VIBRATION (hz), S_LIGHT_LEVEL (lux)
    V_VOLTAGE: 38, //!< S_MULTIMETER
    V_CURRENT: 39, //!< S_MULTIMETER
    V_RGB: 40, //!< S_RGB_LIGHT, S_COLOR_SENSOR. Sent as ASCII hex: RRGGBB (RR;red, GG;green, BB;blue component)
    V_RGBW: 41, //!< S_RGBW_LIGHT. Sent as ASCII hex: RRGGBBWW (WW;white component)
    V_ID: 42, //!< Used for sending in sensors hardware ids (i.e. OneWire DS1820b).
    V_UNIT_PREFIX: 43, //!< Allows sensors to send in a string representing the unit prefix to be displayed in GUI, not parsed by controller! E.g. cm, m, km, inch.
    V_HVAC_SETPOINT_COOL: 44, //!< S_HVAC. HVAC cool setpoint (Integer between 0-100)
    V_HVAC_SETPOINT_HEAT: 45, //!< S_HEATER, S_HVAC. HVAC/Heater setpoint (Integer between 0-100)
    V_HVAC_FLOW_MODE: 46, //!< S_HVAC. Flow mode for HVAC ("Auto", "ContinuousOn", "PeriodicOn")
    V_TEXT: 47, //!< S_INFO. Text message to display on LCD or controller device
    V_CUSTOM: 48, //!< Custom messages used for controller/inter node specific commands, preferably using S_CUSTOM device type.
    V_POSITION: 49, //!< GPS position and altitude. Payload: latitude;longitude;altitude(m). E.g. "55.722526;13.017972;18"
    V_IR_RECORD: 50, //!< Record IR codes S_IR for playback
    V_PH: 51, //!< S_WATER_QUALITY, water PH
    V_ORP: 52, //!< S_WATER_QUALITY, water ORP : redox potential in mV
    V_EC: 53, //!< S_WATER_QUALITY, water electric conductivity μS/cm (microSiemens/cm)
    V_VAR: 54, //!< S_POWER, Reactive power: volt-ampere reactive (var)
    V_VA: 55, //!< S_POWER, Apparent power: volt-ampere (VA)
    V_POWER_FACTOR: 56, //!< S_POWER, Ratio of real power to apparent power: floating point value in the range [-1,..,1]
};
exports.SETTYPE = SETTYPE;

/// @brief Type of internal messages (for internal messages)
const INTERNALTYP = {
    I_BATTERY_LEVEL: 0, //!< Battery level
    I_TIME: 1, //!< Time (request/response)
    I_VERSION: 2, //!< Version
    I_ID_REQUEST: 3, //!< ID request
    I_ID_RESPONSE: 4, //!< ID response
    I_INCLUSION_MODE: 5, //!< Inclusion mode
    I_CONFIG: 6, //!< Config (request/response)
    I_FIND_PARENT_REQUEST: 7, //!< Find parent
    I_FIND_PARENT_RESPONSE: 8, //!< Find parent response
    I_LOG_MESSAGE: 9, //!< Log message
    I_CHILDREN: 10, //!< Children
    I_SKETCH_NAME: 11, //!< Sketch name
    I_SKETCH_VERSION: 12, //!< Sketch version
    I_REBOOT: 13, //!< Reboot request
    I_GATEWAY_READY: 14, //!< Gateway ready
    I_SIGNING_PRESENTATION: 15, //!< Provides signing related preferences (first byte is preference version)
    I_NONCE_REQUEST: 16, //!< Request for a nonce
    I_NONCE_RESPONSE: 17, //!< Payload is nonce data
    I_HEARTBEAT_REQUEST: 18, //!< Heartbeat request
    I_PRESENTATION: 19, //!< Presentation message
    I_DISCOVER_REQUEST: 20, //!< Discover request
    I_DISCOVER_RESPONSE: 21, //!< Discover response
    I_HEARTBEAT_RESPONSE: 22, //!< Heartbeat response
    I_LOCKED: 23, //!< Node is locked (reason in string-payload)
    I_PING: 24, //!< Ping sent to node, payload incremental hop counter
    I_PONG: 25, //!< In return to ping, sent back to sender, payload incremental hop counter
    I_REGISTRATION_REQUEST: 26, //!< Register request to GW
    I_REGISTRATION_RESPONSE: 27, //!< Register response from GW
    I_DEBUG: 28, //!< Debug message
    I_SIGNAL_REPORT_REQUEST: 29, //!< Device signal strength request
    I_SIGNAL_REPORT_REVERSE: 30, //!< Internal
    I_SIGNAL_REPORT_RESPONSE: 31, //!< Device signal strength response (RSSI)
    I_PRE_SLEEP_NOTIFICATION: 32, //!< Message sent before node is going to sleep
    I_POST_SLEEP_NOTIFICATION: 33 //!< Message sent after node woke up (if enabled)
};
exports.INTERNALTYP = INTERNALTYP;

/// @brief Type of data stream (for streamed message)
const STREAMTYP = {
    ST_FIRMWARE_CONFIG_REQUEST: 0, //!< Request new FW, payload contains current FW details
    ST_FIRMWARE_CONFIG_RESPONSE: 1, //!< New FW details to initiate OTA FW update
    ST_FIRMWARE_REQUEST: 2, //!< Request FW block
    ST_FIRMWARE_RESPONSE: 3, //!< Response FW block
    ST_SOUND: 4, //!< Sound
    ST_IMAGE: 5 //!< Image
};
exports.STREAMTYP = STREAMTYP;

/**
 *    mysensors messages have the form - [  node-id ; child-sensor-id ; command ; ack ; type ; payload \n ]
 *    node-id (integer): ID of end device
 *    child-sensor-id (integer): ID of a sensor on an end device
 *    command (integer): Code for the type of communication this function will ignore all commands except Set=1
 *    ack (integer 0 or 1): Used for acknowledgment, but not important for this function
 *    type (integer): indicates the type of data, e.g. Temperature, Humidity
 *    payload (could be string, number): Sensor value
 *
 * msgUtils.enrichInboundEvent
 * @param {*} event 
 */
function enrichInboundEvent(event) {
    logger.debug('START:enrichOutboundEvent %j', event);
    let dt = new Date();
    event[MSGATT.SYSTM] = dt.getTime();
    event[MSGATT.SYSTMISO] = dt.toISOString();
    //if gw did not add tm to message use system time
    if (!event.hasOwnProperty(MSGATT.TMISO) || _.isNil(event[MSGATT.TMISO])) {
        if (event[MSGATT.TM] && !_.isNil(event[MSGATT.TM])) {
            //inbound message did have a timestamp so use it
            try {
                let dt = new Date(event[MSGATT.TM]);
                event[MSGATT.TMISO] = dt.toISOString();
            } catch (err) {
                logger.error('Invalid time value passed in event %j', event);
                event[MSGATT.TMISO] = event[MSGATT.SYSTMISO];
            }
        } else {
            event[MSGATT.TMISO] = event[MSGATT.SYSTMISO];
        }
    }
    if (!event.hasOwnProperty(MSGATT.TM) || _.isNil(event[MSGATT.TM])) {
        event[MSGATT.TM] = event[MSGATT.SYSTM];
    }
    logger.debug('END:enrichOutboundEvent %j', event);
    return event;
}
exports.enrichInboundEvent = enrichInboundEvent;


function validateGenericEvent(event) {
    logger.debug('START:validateGenericEvent %j', event);
    //Gateway is required
    if (_.isNil(event[MSGATT.GWID]) || _.isEmpty(event[MSGATT.GWID]) || event[MSGATT.GWID].trim() === '') {
        logger.error('No valid Gateway Id found in message: %j', event);
        throw ('No valid Gateway Id found in message.');
    }
    // let gwTopic = parseGatewayIdFromTopic(event);
    // if (event[MSGATT.GWID] !== gwTopic) {
    //     logger.error('Gateway Id found in message does not match topic %s, %j', gwTopic, event);
    //     throw ('Gateway Id found in message does not ID match topic.');
    // }
    if (_.isNil(event[MSGATT.TOPIC]) || _.isEmpty(event[MSGATT.TOPIC]) || event[MSGATT.TOPIC].trim() === '') {
        logger.error('No valid topic found in message: %j', event);
        throw ('No valid topic found in message.');
    }
    logger.debug('END:validateGenericEvent %j', event);

}
exports.validateGenericEvent = validateGenericEvent;

/**
 *    mysensors messages have the form - [  node-id ; child-sensor-id ; command ; ack ; type ; payload \n ]
 *    node-id (integer): ID of end device
 *    child-sensor-id (integer): ID of a sensor on an end device
 *    command (integer): Code for the type of communication this function will ignore all commands except Set=1
 *    ack (integer 0 or 1): Used for acknowledgment, but not important for this function
 *    type (integer): indicates the type of data, e.g. Temperature, Humidity
 *    payload (could be string, number): Sensor value
 *
 * 
 * @param {*} event 
 */
function parsePayloads(event) {
    let rawMsgs = [];
    if (_.isNil(event[MSGATT.RAW]) && _.isNil(event[MSGATT.GWID])) {
        logger.error('Message received with no raw attribute or gateway Id: %j', event);
        throw ('Invalid message received');
    }

    //some gateways split the data before sending so split if necessary and then validate all the parts
    if (!_.isNil(event[MSGATT.RAW]) && _.isNil(event[MSGATT.NODEID])) {
        rawMsgs = parseRawPayloads(event);
    } else {
        rawMsgs.push(event);
    }
    return rawMsgs;
}
exports.parsePayloads = parsePayloads;

/**
 *    mysensors messages have the form - [  node-id ; child-sensor-id ; command ; ack ; type ; payload \n ]
 *    node-id (integer): ID of end device
 *    child-sensor-id (integer): ID of a sensor on an end device
 *    command (integer): Code for the type of communication this function will ignore all commands except Set=1
 *    ack (integer 0 or 1): Used for acknowledgment, but not important for this function
 *    type (integer): indicates the type of data, e.g. Temperature, Humidity
 *    payload (could be string, number): Sensor value
 *
 * 
 * @param {*} event 
 */
function parseRawPayloads(event) {
    logger.debug('START:parseRawPayloads %j', event);

    let msgs = [];
    if (!_.isNil(event[MSGATT.RAW])) {
        let lines = event[MSGATT.RAW].split(os.EOL);
        lines.forEach(element => {
            if (element.trim() !== "") {
                logger.debug('parseRawPayloads line %s', element);
                let parts = element.split(TOKEN_SEPERATOR);
                let o = {};
                o[MSGATT.GWID] = event[MSGATT.GWID];
                o[MSGATT.NODEID] = +parts[0];
                o[MSGATT.SENSORID] = +parts[1];
                o[MSGATT.CMD] = +parts[2];
                o[MSGATT.ACK] = +parts[3];
                o[MSGATT.TYP] = +parts[4];
                o[MSGATT.VAL] = parts[5];
                o[MSGATT.TOPIC] = event.topic;
                o[MSGATT.KEY] = createDBKey(o);
                o[MSGATT.SYSTM] = event[MSGATT.SYSTM];
                o[MSGATT.TM] = event[MSGATT.TM];
                o[MSGATT.SYSTMISO] = event[MSGATT.SYSTMISO];
                o[MSGATT.TMISO] = event[MSGATT.TMISO];
                msgs.push(o);
            }
        });
    }
    logger.debug('END:parseRawPayloads %j', msgs);

    return msgs;
}
exports.parseRawPayloads = parseRawPayloads;

function validateParsedEvent(event) {
    logger.debug('START:validateParseEvent %j', event);
    //Command is required (Minimum Validation for every Command)
    if (_.isNil(event[MSGATT.CMD]) || !_.isInteger(event[MSGATT.CMD]) || event[MSGATT.CMD] < 0) {
        logger.error('Command could not be parsed from message: %j', event);
        throw ('Command could not be parsed from message.');
    }
    //Type is required (Minimum Validation for every Command)
    if (_.isNil(event[MSGATT.TYP]) || !_.isInteger(event[MSGATT.TYP]) || event[MSGATT.TYP] < 0) {
        logger.error('Type could not be parsed from message: %j', event);
        throw ('Type could not be parsed from message.');
    }
    //Is this a command with no nodeId?

    //NodeId is required (Minimum Validation for every Command)
    if (_.isNil(event[MSGATT.NODEID]) || !_.isInteger(event[MSGATT.NODEID]) || event[MSGATT.NODEID] < 0) {
        logger.error('Node Id could not be parsed from message: %j', event);
        throw ('Node Id could not be parsed from message.');
    }

    //Sensor is required (Minimum Validation for every Command)
    if (_.isNil(event[MSGATT.SENSORID]) || !_.isInteger(event[MSGATT.SENSORID]) || event[MSGATT.SENSORID] < 0) {
        logger.error('Sensor Id could not be parsed from message: %j', event);
        throw ('Sensor Id could not be parsed from message.');
    }

    logger.debug('End:validateParseEvent %j', event);

    return event;
}
exports.validateParsedEvent = validateParsedEvent;

/**
 * Handles an Event that has been validated
 * Routes based on Command to specific handler
 * 
 * @param {*} event 
 */
function handleEvent(event) {
    logger.debug('START:handleEvent %j', event);
    //PRESENTATION
    if (_.isNil(event[MSGATT.CMD]) || !_.isInteger(event[MSGATT.CMD]) || event[MSGATT.CMD] < 0) {
        logger.error('Command could not be parsed from message: %j', event);
        throw ('Command could not be parsed from message.');
    }
    if (event[MSGATT.CMD] === CMD.PRESENTATION) {
        return handlePresentationEvent(event);
    } else if (event[MSGATT.CMD] === CMD.SET) {
        return handleSetEvent(event);
    } else if (event[MSGATT.CMD] === CMD.REQUEST) {
        return handleRequestEvent(event);
    } else if (event[MSGATT.CMD] === CMD.INTERNAL) {
        return handleInternalEvent(event);
    } else if (event[MSGATT.CMD] === CMD.STREAM) {
        logger.info('Stream Command received but ignored %j', event);
        return Promise.resolve('Ignore');
    } else {
        logger.error('Command Not Recognized cmd value=%d, event=%j', event[MSGATT.CMD], event);
        return Promise.reject('Command Not Recognized');
    }
}
exports.handleEvent = handleEvent;

/**
 * Handles a Presentation Event that has been validated
 * Atempts to find match in state table.
 * Adds record if needed or updates type
 * 
 * @param {*} event 
 */
function handlePresentationEvent(event) {
    logger.debug('START:handlePresentationEvent %j', event);
    //PRESENTATION
    if (_.isNil(event[MSGATT.TYP]) || !_.isInteger(event[MSGATT.TYP]) || event[MSGATT.TYP] < 0) {
        logger.error('Type could not be parsed from message: %j', event);
        throw ('Type could not be parsed from message.');
    }

    //attempt to find match in State Table
    let hasIntegrationRecord = false;
    let state;
    return dbUtils.lookupIntegrationByKey(event, false, TBLPRE)
        .then(function (data) {
            if (!_.isNull(data) && _.has(data, 'Item.key')) {
                logger.debug('Existing integration record found: %s', event[MSGATT.KEY]);
                hasIntegrationRecord = true;
                state = data.Item;
                return data.Item;
            } else {
                logger.debug('No Existing integration record found: %s', event[MSGATT.KEY]);
                hasIntegrationRecord = false;
                return null;
            }
        })
        .then(function (data) {
            if (!hasIntegrationRecord) {
                logger.info('%s - Create Integration record: key: %s', event[MSGATT.KEY]);
                //attempt to create one
                let item = {};
                item[dbUtils.INTEGRATIONFLDS.KEY] = event[MSGATT.KEY];
                item[dbUtils.INTEGRATIONFLDS.VRS] = 1; //set the version to 1                
                item[dbUtils.INTEGRATIONFLDS.GWID] = event[MSGATT.GWID];
                item[dbUtils.INTEGRATIONFLDS.NODEID] = event[MSGATT.NODEID];
                item[dbUtils.INTEGRATIONFLDS.SENSORID] = event[MSGATT.SENSORID];
                item[dbUtils.INTEGRATIONFLDS.SENSORTYPE] = event[MSGATT.TYP];
                item[dbUtils.INTEGRATIONFLDS.SENSORTYPEVAL] = event[MSGATT.VAL];
                item[dbUtils.INTEGRATIONFLDS.SENSORLSTTM] = event[MSGATT.TM];
                item[dbUtils.INTEGRATIONFLDS.SENSORLSTTMISO] = event[MSGATT.TMISO];
                return dbUtils.putAssetIntegration(item, TBLPRE);
            }
        })
        .then(function (data) {
            if (hasIntegrationRecord) {
                //do the types match? if not update
                if (!_.has(state, dbUtils.INTEGRATIONFLDS.SENSORTYPEVAL) || event[MSGATT.VAL] !== state[dbUtils.INTEGRATIONFLDS.SENSORTYPEVAL]) {
                    //update specific attributes
                    let updateExp = 'set #st  = :stv, #stm = :stmv, #stmi = :stmiv';
                    let conditionExp = '#vrs  = :vrsv';
                    let attNames = {
                        '#stv': dbUtils.INTEGRATIONFLDS.SENSORTYPEVAL,
                        '#stm': dbUtils.INTEGRATIONFLDS.SENSORLSTTM,
                        '#stmi': dbUtils.INTEGRATIONFLDS.SENSORLSTTMISO,
                        '#vrs': dbUtils.INTEGRATIONFLDS.VRS
                    };
                    let attValues = {
                        ':stv': event[MSGATT.VAL],
                        ':stmv': event[MSGATT.TM],
                        ':stmiv': event[MSGATT.TMISO],
                        ':vrsv': state[dbUtils.INTEGRATIONFLDS.VRS]
                    };
                    return dbUtils.updateAssetStateAttributes(event[MSGATT.KEY], updateExp, conditionExp, attNames, attValues, TBLPRE, false);
                }
                return data;
            }
        });
}
exports.handlePresentationEvent = handlePresentationEvent;

/**
 * Handles a Set Event that has been validated
 * 
 * @param {*} event 
 */
function handleSetEvent(event) {
    logger.debug('START:handleSetEvent %j', event);
    if (_.isNil(event[MSGATT.TYP]) || !_.isInteger(event[MSGATT.TYP]) || event[MSGATT.TYP] < 0) {
        logger.error('Type could not be parsed from message: %j', event);
        throw ('Type could not be parsed from message.');
    }
    if (_.isNil(event[MSGATT.VAL])) {
        logger.error('Value could not be parsed from message: %j', event);
        throw ('Value could not be parsed from message.');
    }
    //for correct indexing determine if value is text or numeric
    if (_.isNaN(+event[MSGATT.VAL])) {
        //definitely not a number
        event[MSGATT.TXTVAL] = event[MSGATT.VAL];
    } else {
        event[MSGATT.NUMVAL] = +event[MSGATT.VAL];
    }
    //attempt to find match in State Table
    let hasIntegrationRecord = false;
    let state;
    return dbUtils.lookupIntegrationByKey(event, false, TBLPRE)
        .then(function (data) {
            if (!_.isNull(data) && _.has(data, 'Item.key')) {
                logger.debug('Existing integration record found: %s', event[MSGATT.KEY]);
                hasIntegrationRecord = true;
                state = data.Item;
                return data.Item;
            } else {
                logger.debug('No Existing integration record found: %s', event[MSGATT.KEY]);
                hasIntegrationRecord = false;
                return null;
            }
        })
        .then(function (data) {
            if (!hasIntegrationRecord) {
                logger.info('%s - Create Integration record: key: %s', event[MSGATT.KEY]);
                //attempt to create one
                let item = {};
                item[dbUtils.INTEGRATIONFLDS.KEY] = event[MSGATT.KEY];
                item[dbUtils.INTEGRATIONFLDS.VRS] = 1; //set the version to 1                
                item[dbUtils.INTEGRATIONFLDS.GWID] = event[MSGATT.GWID];
                item[dbUtils.INTEGRATIONFLDS.NODEID] = event[MSGATT.NODEID];
                item[dbUtils.INTEGRATIONFLDS.SENSORID] = event[MSGATT.SENSORID];
                item[dbUtils.INTEGRATIONFLDS.SENSORLSTTEL] = event[MSGATT.TM];
                item[dbUtils.INTEGRATIONFLDS.SENSORLSTTELISO] = event[MSGATT.TMISO];
                item[dbUtils.INTEGRATIONFLDS.SENSORLSTVAL] = event[MSGATT.VAL];
                return dbUtils.putAssetIntegration(item, TBLPRE);
            }
        })
        .then(function (data) {
            if (hasIntegrationRecord) {
                //update specific attributes
                let updateExp = 'set #st  = :stv, #stm = :stmv, #stmi = :stmiv';
                let conditionExp = '#vrs  = :vrsv';
                let attNames = {
                    '#stv': dbUtils.INTEGRATIONFLDS.SENSORLSTVAL,
                    '#stm': dbUtils.INTEGRATIONFLDS.SENSORLSTTEL,
                    '#stmi': dbUtils.INTEGRATIONFLDS.SENSORLSTTELISO,
                    '#vrs': dbUtils.INTEGRATIONFLDS.VRS
                };
                let attValues = {
                    ':stv': event[MSGATT.VAL],
                    ':stmv': event[MSGATT.TM],
                    ':stmiv': event[MSGATT.TMISO],
                    ':vrsv': state[dbUtils.INTEGRATIONFLDS.VRS]
                };
                return dbUtils.updateAssetStateAttributes(event[MSGATT.KEY], updateExp, conditionExp, attNames, attValues, TBLPRE, false);
            }
            return data;
        })
        .then(function (data) {
            //Does state table include units or scale
            //Convert value as needed for Units
            return data;
        })
        .then(function (data) {
            //Forward event for further persisting
            return postHTTPMsg(CORE_TOPIC_PREFIX + '/' + event.topic + '/' + TOPIC_TELEMETRY, event, 1);
        });
}
exports.handleSetEvent = handleSetEvent;

/**
 * Handles a Request Event that has been validated
 * 
 * @param {*} event 
 */
function handleRequestEvent(event) {
    logger.debug('START:handleRequestEvent %j', event);

    return dbUtils.lookupIntegrationByKey(event, false, TBLPRE)
        .then(function (data) {
            if (!_.isNull(data) && _.has(data, 'Item.key')) {
                logger.debug('Existing integration record found: %s', event[MSGATT.KEY]);
                return data.Item;
            } else {
                logger.error('No Existing integration record found for Request Event: %s', event[MSGATT.KEY]);
                throw ('No Existing integration record found for Request Event');
            }
        })
        .then(function (data) {
            return postHTTPMsg(createResponseTopicFromEvent(event),
                createResponseFromEvent(event, data[dbUtils.INTEGRATIONFLDS.SENSORLSTVAL]), 1);

        });
}
exports.handleRequestEvent = handleRequestEvent;

/**
 * Handles a Internal Event that has been validated
 * 
 * @param {*} event 
 */
function handleInternalEvent(event) {
    logger.debug('START:handleInternalEvent %j', event);
    if (_.isNil(event[MSGATT.TYP]) || !_.isInteger(event[MSGATT.TYP]) || event[MSGATT.TYP] < 0) {
        logger.error('Type could not be parsed from message: %j', event);
        throw ('Type could not be parsed from message.');
    }
    if (event[MSGATT.TYP] === INTERNALTYP.I_BATTERY_LEVEL) {
        return handleBatteryLevelEvent(event);
    } else if (event[MSGATT.TYP] === INTERNALTYP.I_CONFIG) {
        return handleConfigEvent(event);
    } else if (event[MSGATT.TYP] === INTERNALTYP.I_ID_REQUEST) {
        return handleNodeIdRequestEvent(event);
    } else if (event[MSGATT.TYP] === INTERNALTYP.I_SKETCH_NAME) {
        return handleSketchNameEvent(event);
    } else if (event[MSGATT.TYP] === INTERNALTYP.I_SKETCH_VERSION) {
        return handleSketchVersionEvent(event);
    } else if (event[MSGATT.TYP] === INTERNALTYP.I_TIME) {
        return handleTimeRequestEvent(event);
    } else {
        logger.info('Internal Type Not Recognized, just ignore. type=%d, event= %j', event[MSGATT.TYP], event);
        return Promise.resolve('Internal Type Not Recognized - just ignore');
    }
}
exports.handleInternalEvent = handleInternalEvent;

/**
 * Converts battery level message into a set message
 * 
 * @param {*} event 
 */
function handleBatteryLevelEvent(event) {
    //for now we treat a battery level message like a set message with sensor id
    let newEvnt = _.cloneDeep(event);
    newEvnt[MSGATT.SENSORID] = BATTERY_SENSOR_ID;
    newEvnt[MSGATT.CMD] = CMD.SET;
    newEvnt[MSGATT.TYP] = SETTYPE.V_PERCENTAGE;
    return handleSetEvent(newEvnt);
}

/**
 * Responds with metric or imperial
 * 
 * @param {*} event 
 */
function handleConfigEvent(event) {
    return postHTTPMsg(createResponseTopicFromEvent(event), createResponseFromEvent(event, CONFIG_UNITS), 1);
}

/**
 * Responds with metric or imperial
 * 
 * @param {*} event 
 */
function handleTimeRequestEvent(event) {
    let dt = new Date();
    return postHTTPMsg(createResponseTopicFromEvent(event), createResponseFromEvent(event, dt.getTime()), 1);
}

/**
 * Responds with a node id
 * If simultaneous requests for a node id arrive at the same time
 * it is possible that two nodes could try to use the same ID
 * 
 * @param {*} event 
 */
function handleNodeIdRequestEvent(event) {
    //find all node ids for the supplied gateway
    let ids = dbUtils.getGatewayNodeIds(event[MSGATT.GWID], TBLPRE);
    //find first value not in the existing id list
    let id = -1;
    for (let index = 1; index < MAX_NODEID; index++) {
        if (!_.find(ids, index)) {
            id = index;
            break;
        }
    }
    if (id < 0) {
        logger.error('No valid node id was found for gateway, %s', event[MSGATT.GWID]);
        throw ('No valid node id was found for gateway');
    }
    return postHTTPMsg(createResponseTopicFromEvent(event), createResponseFromEvent(event, id), 1);
}

/**
 * Handles a Sketch name Event that has been validated
 * Atempts to update any existing integration records that match
 * 
 * @param {*} event 
 */
function handleSketchNameEvent(event) {
    //get keys
    return dbUtils.getKeysByGatewayNodeId(event[MSGATT.GWID], event[MSGATT.NODEID], TBLPRE)
        .then(function (data) {
            if (data && data.hasOwnProperty('Items') && !_.isEmpty(data.Items)) {
                let updateExp = 'set #s = :sv';
                let conditionExp = '#v = :vrs';
                let attNames = {
                    '#s': dbUtils.INTEGRATIONFLDS.NODESKTCHNM,
                    '#v': dbUtils.INTEGRATIONFLDS.VRS
                };
                return Promise.all(data.Items.map(function (item) {
                    let attValues = {
                        ':sv': event[MSGATT.VAL],
                        ':vrs': item[dbUtils.INTEGRATIONFLDS.VRS]
                    };
                    return dbUtils.updateIntegrationAttributes(item[dbUtils.INTEGRATIONFLDS.KEY], updateExp, conditionExp, attNames, attValues, TBLPRE, true);
                }));
            }
        });
}
exports.handleSketchNameEvent = handleSketchNameEvent;

/**
 * Handles a Sketch name Event that has been validated
 * Atempts to update any existing integration records that match
 * 
 * @param {*} event 
 */
function handleSketchVersionEvent(event) {
    //get keys
    return dbUtils.getKeysByGatewayNodeId(event[MSGATT.GWID], event[MSGATT.NODEID], TBLPRE)
        .then(function (data) {
            if (data && data.hasOwnProperty('Items') && !_.isEmpty(data.Items)) {
                let updateExp = 'set #s = :sv';
                let conditionExp = '#v = :vrs';
                let attNames = {
                    '#s': dbUtils.INTEGRATIONFLDS.NODESKTCHVRS,
                    '#v': dbUtils.INTEGRATIONFLDS.VRS
                };
                return Promise.all(data.Items.map(function (item) {
                        let attValues = {
                            ':sv': event[MSGATT.VAL],
                            ':vrs': item[dbUtils.INTEGRATIONFLDS.VRS]
                        };
                        return dbUtils.updateIntegrationAttributes(item[dbUtils.INTEGRATIONFLDS.KEY], updateExp, conditionExp, attNames, attValues, TBLPRE, true);
                    }))
                    .catch(function (data) {
                        logger.error('Error caught handleSketchVersionEvent');
                        return Promise.reject(new Error('[InternalError] - Error caught handleSketchVersionEvent.'));
                    });
            }
        });
}
exports.handleSketchVersionEvent = handleSketchVersionEvent;


function createResponseFromEvent(event, val) {
    let resp = {};
    resp[MSGATT.GWID] = event[MSGATT.GWID];
    resp[MSGATT.NODEID] = event[MSGATT.NODEID];
    resp[MSGATT.SENSORID] = event[MSGATT.SENSORID];
    resp[MSGATT.ACK] = 0; //no ACK handling currently implemented
    resp[MSGATT.CMD] = event[MSGATT.CMD];
    resp[MSGATT.TYP] = event[MSGATT.TYP];
    resp[MSGATT.VAL] = val;
    resp[MSGATT.TM] = event[MSGATT.SYSTM];
    resp[MSGATT.RAW] = '' +
        resp[MSGATT.NODEID] + TOKEN_SEPERATOR +
        resp[MSGATT.SENSORID] + TOKEN_SEPERATOR +
        resp[MSGATT.CMD] + TOKEN_SEPERATOR +
        resp[MSGATT.ACK] + TOKEN_SEPERATOR +
        resp[MSGATT.TYP] + TOKEN_SEPERATOR +
        resp[MSGATT.VAL] + os.EOL;
}

function createResponseTopicFromEvent(event) {
    return event.topic.replace(TOPIC_IN, TOPIC_OUT);
}

function postHTTPMsg(topicName, msg, qos) {
    return new Promise(function (resolve, reject) {
        try {
            if (_.isObject(msg)) {
                msg = JSON.stringify(msg);
            }
            var params = {
                topic: topicName,
                payload: msg,
                qos: qos
            };
            logger.info('postHTTPMsg: %j', params);
            if (iotdata) {
                iotdata.publish(params, function (err, data) {
                    if (err) {
                        logger.info(err, err.stack); // an error occurred
                        reject(err);
                    } else {
                        // logger.info(data);           // successful response
                        resolve("Request sent to asset");
                    }
                });
            } else {
                logger.error('No IOT_ENDPOINT defined so message not forwarded!');
                resolve('Incomplete');
            }
        } catch (err) {
            logger.error("IOT Error Posting HTTP Message: %j", err);
            reject(err);
        }
    });
}
exports.postHTTPMsg = postHTTPMsg;

/**
 * Simple concatenation of field to create unique key
 * return String
 */
function createDBKey(event) {
    return event[MSGATT.GWID] + '-' + event[MSGATT.NODEID] + '-' + event[MSGATT.SENSORID];
}

// /*
//  * Post the given document to Elasticsearch
//  */
// function postToES(doc, context) {
//     return new Promise(function (resolve, reject) {
//         try {
//             var req = new AWS.HttpRequest(endpoint);

//             req.method = 'POST';
//             req.path = path.join('/', esDomain.index, esDomain.doctype);
//             req.region = esDomain.region;
//             req.headers['presigned-expires'] = false;
//             req.headers.Host = endpoint.host;
//             req.body = doc;

//             var signer = new AWS.Signers.V4(req, 'es'); // es: service code
//             signer.addAuthorization(creds, new Date());

//             var send = new AWS.NodeHttpClient();
//             send.handleRequest(req, null, function (httpResp) {
//                 var respBody = '';
//                 httpResp.on('data', function (chunk) {
//                     respBody += chunk;
//                 });
//                 httpResp.on('end', function (chunk) {
//                     console.log('Response: ' + respBody);
//                     resolve('Success');
//                 });
//             }, function (err) {
//                 console.log('Error: ' + err);
//                 //reject('Lambda failed with error ' + err);
//                 resolve(null);
//             });
//         } catch (err) {
//             logger.error("IOT Error Posting HTTP Message: %j", err);
//             resolve(null);
//         }
//     });

// }