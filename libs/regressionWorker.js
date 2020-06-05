let url = "https://mimicproject.com/libs/rapidLib.js"
try {
  importScripts(url);
} catch (err) {
  let url = "http://localhost:4200/libs/rapidLib.js"
  importScripts(url);
}
var options = {};
var rapidLib = RapidLib();
var myRegression = new rapidLib.Regression();
function setOptions() {
  if(myRegression !== undefined)
  {
    console.log("setting options")
    if(options.numEpochs !== undefined)
    {
      myRegression.setNumEpochs(options.numEpochs)
    }
    if(options.numHiddenNodes !== undefined)
    {
      myRegression.setNumHiddenNodes(options.numHiddenNodes)
    }
    if(options.numHiddenLayers !== undefined)
    {
      myRegression.setNumHiddenLayers(options.numHiddenLayers)
    }
  }
}
self.addEventListener('message', function(e) {
  if(e.data.action == "train") {
    if(myRegression !== undefined)
    {
      console.log("training")
      myRegression = new rapidLib.Regression();
      rapidLib = RapidLib();
      setOptions()
      myRegression.train(e.data.data);
    }
    console.log("trainingend")
    self.postMessage("trainingend");
  }
  if(e.data.action == "options") {
    //Respond to options msg
    options = e.data.data
    setOptions()
  }
  if(e.data.action == "run") {
    //Respond to run msg

    let c = myRegression.run(e.data.data);
    //console.log("running", e.data.data, myRegression, c)
    //console.log(c)
    self.postMessage(c);
  }
}, false);
