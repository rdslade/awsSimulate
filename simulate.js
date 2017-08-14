#!/usr/bin/env node
var program = require('commander');
var jwt = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdXRoMHxsb2FkX3Rlc3RfYWNjb3VudCIsImF1ZCI6IkZ4NmdsMUUzWTl5Uk8zUjFsSlg5cXNMeUJvUFZKS1JMIiwiaWF0IjoxNTAwNDAxNTY3LCJleHAiOjE5NzM3NjU1Njd9.PvPXvHPqAneDYmdqta8mIaqc9PlcBDA2G-o0CddtTXg";
var headers = {
        'Authorization': jwt
    };
program
  .description("A command-line tool for running simulated load tests")
  .option('-n --numDevices <Integer>', 'Number of devices to simulate',parseInt)
  .option('-p, --publish [Integer]', 'Number of publishes per device',parseInt)
  .option('-l, --asyncLimit [Integer]', 'Limit for simultaneous asyncronous actions',parseInt)
  .version('0.1.0')
program.on('--help',function(){
    console.log("\n\n  Examples:");
    console.log("");
    console.log('    $ simulate -n 2');
    console.log('    Creates 2 devices with default publishes and default asyncLimit');
    console.log('\n    $ simulate --publish 3 --numDevices 2');
    console.log('    Creates 2 devices with 3 publishes and a default asyncLimit');
    console.log('\n    $ simulate --asyncLimit 3 -n 2');
    console.log('    Creates 2 devices with default publishes and an asyncLimit of 3 actions');
    console.log('\n    $ simulate -p 4 -l 10 -n 25');
    console.log('    Creates 25 devices with 4 publishes and an asyncLimit of 10 actions');
});
program.parse(process.argv);
const numDevices = program.numDevices ? program.numDevices : 0;
const numPublish = program.publish ? program.publish : 1;
const aLimit = program.asyncLimit ? program.asyncLimit : 8;

/**
 * Callback from waterfall
 *
 * @callback  waterfallCallback
 */
var request = require('request');
var async = require('async');
var logs = []; //array that holds deviceLog objects
var time = [];
var successfulConnections = 0;

async.timesLimit(numDevices,aLimit,function(n,next){
    let tasks = [
        async.apply(getClaimCode,n),
        parseClaimCode,
        getCertificates,
        awsPublish,
        deleteDevice,
        showFinalCode
    ]
    
//    if (purgeWhenDone) tasks.push(deleteDevice)
//    if (verbose) tasks.push(showFinalCode)
    
    async.waterfall(tasks, function(err,result) {
        if(!err){
            console.log(result);
            next(null,result);
        }
        else{
            //console.log(err);
            next(err,result);
        }
    });
},function(err,results){
    var folder = 'success'
    if(err){
        folder = 'fail'
    }
    var AWS = require('aws-sdk');
    var s3 = new AWS.S3();
    var params = {
        Body: JSON.stringify(logs),
        Bucket: "lambda-simulate-test-data",
        Key:folder+"/"+numDevices+"devices@"+numPublish+"publishes@"+getCurrentTime(1),
    };
    s3.putObject(params,function(err,data){
        if(err) console.log(err);
        else{    
            console.log("\nClick this link to download the test log:");
            console.log("\t"+parseURL("http://s3.dualstack.us-east-1.amazonaws.com/lambda-simulate-test-data/"+params.Key))
            graphics(JSON.stringify(logs))
        }
    });
});

/**
 * Uses authorization token to request a claim code from the following endpoint
 *
 * @param {Number} n - Iteration of device
 * @param {waterfallCallback} callback - Callback function recieved from waterfall
 */
function getClaimCode(n,callback){
    var claimOptions = {
        url: 'https://2-api.connectsense-staging.com/devices/claim-code',
        headers: headers
    };

    request(claimOptions,function(error,response,body){
        if(!error && response.statusCode == 200){
            callback(null,response,body,n);
        }
        else if(error)
            console.log("Error 1: "+error);
    });
}

/**
 * Parses string to recieve claim code
 *
 * @param {Object} response - Response from claim code request
 * @param {String} body - Body from claim code request containing claim code
 * @param {Number} n - Iteration of device
 * @param {waterfallCallback} callback - Callback function recieved from waterfall
 */
function parseClaimCode(response, body,n, callback) {
    var claimCode = JSON.parse(body).claimCode;
    callback(null,claimCode,n);
}

/**
 * Makes registration request for authorization certificates 
 *
 * @param {String} result - Claim code used for authorization
 * @param {Number} n - Iteration of device
 * @param {waterfallCallback} callback - Callback function recieved from waterfall
 */
function getCertificates(result,n,callback){
    var serialNumber =  JSON.stringify(Math.floor(1000 + Math.random() * 9000));
    var data = {claimCode: result, serialNumber: "GC-CS-TH"+serialNumber};
    var dataString = JSON.stringify(data);
    var registerOptions = {
        url: 'https://2-api.connectsense-staging.com/devices/register',
        method: 'POST',
        body: dataString
    };
    var req = request(registerOptions, function(error,response,body){
        if(response.statusCode==200){
            callback(null,response,body,n);
        }
        else{
            var deviceLog = {
                id : n,
                name : "load_test_account_"+serialNumber,
                fail:getCurrentTime(0),
                status: body
            };
            //console.log(deviceLog);
            logs.push(deviceLog);
            deleteDeviceError("load_test_account_"+serialNumber,error,n,callback);
        }
    });
}

/**
 * Publishes messages to topic defined by device ID and disconnects device from IoT
 *
 * @param {Object} response - Response from registration request
 * @param {String} body - Body from registration request containing certificates
 * @param {Number} n - Iteration of device
 * @param {waterfallCallback} callback - Callback function recieved from waterfall
 */
function awsPublish(response,body,n,callback){
    var awsIot = require('aws-iot-device-sdk');
    var stringToBuffer = require('string-to-buffer');
    var final = JSON.parse(body);
    //console.log(final)
    var device = awsIot.device({
        privateKey: stringToBuffer(final.certificates.privateKey),
        clientCert: stringToBuffer(final.certificates.certPem),
        caCert: "./caCert.crt",
        host: final.endpoint,
        clientId: final.thingName,
        region: 'us-east-1'
    });
    var deviceLog = {
        id : n,
        name : final.thingName,
        connect : false,
        publish : false,
        disconnect : false,
        delete : false,
        complete : false
    };
    device.on('connect', function() {
        deviceLog.connect = getCurrentTime(0);
        time.push(deviceLog.connect);
        deviceLog.publish = {};
        var params = {
            topic: "$aws/things/"+final.thingName+"/shadow/update",
            qos: 0,
            payload: JSON.stringify({test_data: "Test"})
        };
        async.times(numPublish,function(n,next){
            device.publish(params.topic,params.payload,function(err){
                if(err){
                    console.log(err);
                }
                else{
                    var curPub = deviceLog.publish;
                    var key = "Pub"+n;
                    curPub[key] = getCurrentTime(0);
                    deviceLog.publish = curPub;
                    time.push(deviceLog.publish)
                    next();
                }
            });
        },function(){
            device.end();
            callback(null,final.thingName,n,deviceLog);
        })
    });
    device.on('close', function() {
        deviceLog.disconnect = getCurrentTime(0);
        time.push(deviceLog.disconnect);
    });
    device.on('reconnect', function() {
        console.log('reconnect');
    });
    device.on('offline', function() {
        console.log('offline');
    });
    device.on('error', function(error) {
        console.log('error', error);
    });
}

/**
 * Makes DELETE request to each devices endpoint 
 *
 * @param {String} thingName - Device name in form of 'testaccount1_{id number}'
 * @param {Number} n - Iteration of device
 * @param {Object} deviceLog - Log of the nth device
 * @param {waterfallCallback} callback - Callback function recieved from waterfall
 */
function deleteDevice(thingName,n,deviceLog,callback){
    var claimOptions = {
        url: 'https://2-api.connectsense-staging.com/devices/'+thingName,
        headers: headers,
        method:"DELETE"
    };

    request(claimOptions,function(error,response,body){
        if(!error && response.statusCode == 200){
            deviceLog.delete = getCurrentTime(0);
            time.push(deviceLog.delete);
            callback(null,thingName,n,deviceLog);
        }
        else if(error){
            console.log("Error 1: "+error);
        }
    });
}

/**
 * Outputs the device iteration upon successful process and pushes devices log to global array 
 *
 * @param {Number} n - Iteration of device
 * @param {Object} deviceLog - Log of the nth device
 * @param {waterfallCallback} callback - Callback function recieved from waterfall
 */
function showFinalCode(thingName,n,deviceLog,callback){
    successfulConnections++;
    deviceLog.complete = getCurrentTime(0);
    logs.push(deviceLog);
    callback(null,"Device "+n+" Success");
}

/**
 * Returns a human readable format of curret date and time
 * @param {Integer} option - Specifies which form the date to return
 * @return {String} Human readable format of current date and time
 */
function getCurrentTime(option){
    var currentdate = new Date();
    if(option==1){
        return currentdate;
    }
    var datetime = parseDateProps((currentdate.getMonth()+1)) + "/"
                + parseDateProps((currentdate.getDate()))  + "/" 
                + currentdate.getFullYear() + " @ "  
                + parseDateProps(currentdate.getHours()) + ":"  
                + parseDateProps(currentdate.getMinutes()) + ":" 
                + parseDateProps(currentdate.getSeconds()) + ":"
                + parseDateProps(currentdate.getMilliseconds());
    return datetime;
}

/**
 * Returns a corrected version of a date/time number if only 1 digit
 * @param {Integer} num - Time variable to be checked for single digit correction
 * @return {String} Corrected variable of date/time
 */
function parseDateProps(num){
    if(num < 10){
        return "0"+num;
    }
    else{
        return JSON.stringify(num);
    }
}

function deleteDeviceError(thingName,error,n,callback){
    var headers = {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdXRoMHxsb2FkX3Rlc3RfYWNjb3VudCIsImlhdCI6MTUwMDQwMDM2MywiZXhwIjoxOTczNzY0MzYzfQ.81uBtX9O6tpPE7VhXOieOkpBbSmKxat1xEYQ1ugmiwM'
    };
    var claimOptions = {
        url: 'https://2-api.connectsense-staging.com/devices/'+thingName,
        headers: headers,
        method:"DELETE"
    };

    request(claimOptions,function(error,response,body){
        if(!error && response.statusCode == 200){
            return callback(new Error('Device not created properly'));
        }
        else if(error){
            console.log("Error 1: "+error);
        }
    });
}

/**
 * Returns a valid URL from a given string
 *
 * @param {String} url - String to be converted
 * @return {String} Valid URL
 */
function parseURL(url){
    url = url.replace(/@/g,'%40');
    url = url.replace(/ /g,'+');
    return url;
}

/* *************************************************************************************************** */

function graphics(txt){
    var plotly = require('plotly')('ryandslade','bV6ZrClV56Oqp3oZFMd7');
    var fs = require('fs');
    var time = [];
    getTimes(txt);
    function getTimes(txt){
        var o = JSON.parse(txt);
        for(var i=0;i<o.length;i++){
            var curTime = [];
            var cur = o[i];
            curTime.push(toTimestamp(parseDate(cur.connect)));
            var j=0;
            while(cur.publish["Pub"+j]){
                curTime.push(toTimestamp(parseDate(cur.publish["Pub"+j])));
                j++;
            }
            curTime.push(toTimestamp(parseDate(cur.disconnect)));
            curTime.push(toTimestamp(parseDate(cur.delete)));
            curTime.push(toTimestamp(parseDate(cur.complete)));
            //curTime.push(parseDate(cur.connect));
            time.push(curTime);
        }
        makeTraces();
        //console.log(time);
    }

    function parseDate(t){
        var monthDay = t.split('/');
        var yearTime=monthDay[2].split("@");
        var n= yearTime[0]+"-"+monthDay[0]+'-'+monthDay[1];
        n=n.replace(/\s/g, '');
        return(n+' '+yearTime[1]);
    }

    function makeTraces(){
        var ys = [];
        for(var i=0;i<time.length;i++){
            var cury = []
            for(var j=0;j<time[0].length;j++){
                cury.push(i);
            }
            ys.push(cury)
        }
        var pointLabels = ["Connection"];
        for(i=0;i<time[0].length-4;i++){
            pointLabels.push("Publish"+i);
        }
        pointLabels.push("Disconnection");
        pointLabels.push("Delete");
        pointLabels.push("Completion");
        var data = [];
        for(i=0;i<ys.length;i++){
            var curtrace = {
                x:time[i],
                y:ys[i],
                mode:"markers+text",
                text:pointLabels,
                textposition:"topright",
                type:"scatter"
            }
            data.push(curtrace)
        }
        var layout = {
          title: "LOG",
          xaxis: {
            title: "Time",
            titlefont: {
              family: "Courier New, monospace",
              size: 18,
              color: "#7f7f7f"
            },
            autorange:true
          },
          yaxis: {
            title: "Device",
            titlefont: {
              family: "Courier New, monospace",
              size: 18,
              color: "#7f7f7f"
            }
          }
        };
        var graphOptions = {layout:layout,filename: "date-axes", fileopt: "overwrite"};
        console.log('Plotting graph...')
        plotly.plot(data, graphOptions, function (err, msg) {
            //console.log(msg)
            console.log('Configuring image...')
            plotly.getFigure('ryandslade', '4', function (err, figure) {
                if (err) return console.log(err);

                var imgOpts = {
                    format: 'png',
                    width: 1000,
                    height: 500
                };
                console.log("Waiting for image upload...")
                plotly.getImage(figure, imgOpts, function (error, imageStream) {
                    if (error) return console.log (error);
                    var pic = 'log.png'
                    var fileStream = fs.createWriteStream(pic);
                    imageStream.pipe(fileStream);
                    var opener = require('opener');
                    opener("log.png");
                    console.log("Graph save in file: "+pic)
                });
            });
        }); 
    }

    function toTimestamp(strDate){
       var datum = Date.parse(strDate);
       return datum/1000;
    }
}