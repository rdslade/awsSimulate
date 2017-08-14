var plotly = require('plotly')('ryandslade','bV6ZrClV56Oqp3oZFMd7');
var fs = require('fs');
var time = [];
file = "file.txt";
fs.readFile(file,'utf8',function(err,data){
    getTimes(data);
});
//var data = [
//  {
//    x: ["2013-10-04 22:23:00", "2013-11-04 22:23:00", "2013-12-04 22:23:00"],
//    y: [1, 3, 6],
//    type: "scatter"
//  }
//];
//var graphOptions = {filename: "date-axes", fileopt: "extend"};
//plotly.plot(data, graphOptions, function (err, msg) {
//    console.log(msg);
//});

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
          family: "Times New Roman, monospace",
          size: 18,
          color: "#7f7f7f"
        },
        autorange:true
      },
      yaxis: {
        title: "Device",
        titlefont: {
          family: "Futura, monospace",
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