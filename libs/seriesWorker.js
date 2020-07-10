let url = "https://www.doc.gold.ac.uk/eavi/rapidmix/RapidLib.js"
try {
  importScripts(url);
} catch (err) {
  let url = "http://localhost:4200/libs/rapidLib.js"
  importScripts(url);
}
var options = {}
var rapidLib = RapidLib();
var mySeries = new rapidLib.SeriesClassification();
var trainingData = [];
self.addEventListener('message', function(e) {
  if(e.data.action == "train") {
    //Respond to train msg
    trainingData = e.data.data;
    if(mySeries !== undefined)
    {
      mySeries.reset();
      mySeries.train(trainingData);
    }
    self.postMessage("trainingend");
  }
  if(e.data.action == "run") {
    //Respond to run msg
    try {
      let c = mySeries.run(e.data.data);
      self.postMessage([c, mySeries.getCosts()]);
    } catch(err) {
      console.log(err)
    }
  }
}, false);
