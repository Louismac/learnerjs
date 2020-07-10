/**
   Class for the main Learner library
 */
class Learner {
 /**
  * Creates the main Learner Object
  * @param {Object} options - options for initialisation
    @param {string} options.modelName - Id used for storing data. You only need to provide this if you have two instances of Learner.js running, this name is used to distinguish the datasets.
    @param {function} options.onLoad - Called after all the libraries have set up
  * @example
  * new Learner({
  *   modelName:"classifier1"
  *   onLoad:()=>{
  *     console.log("I finished loading!")
  *   }
  * })

  */
  constructor(options) {
    let modelName = "";
    let docIdPrefix;
    if(window.frameElement) {
      docIdPrefix = window.frameElement.name;
    }
    let databaseName = "";
    if(docIdPrefix === undefined)
    {
      docIdPrefix = "local";
    }
    if(options !== undefined)
    {
      modelName = options.modelName
    }
    databaseName = docIdPrefix + "_" + modelName;
    this.USE_WORKER = true;
    this.outputGUI = [];
    this.modelOptions = {};
    //Classifier 0, Regression 1, Series 2
    this.modelType = 0;
    this.recordingRound = 0;
    /** Is currently recording
        @var {boolean} */
    this.recording = false;
    /** Is currently running
        @var {boolean} */
    this.running = false;
    this.temp = [];
    this.streamBuffers = [];
    /** The current output values (taken from GUI)
        @var {Array} */
    this.y = [];
    this.numOutputs = 1;
    this.gui = false;
    this.recLimit = 0;
    this.countIn = 0;
    let storageScript = document.createElement('script');
    storageScript.type = 'text/javascript';
    storageScript.async = true;
    storageScript.onload = ()=>{
      this.DATASET_KEY = "dataset";
      this.REC_KEY = "recordingRound";
      this.store = localforage.createInstance({name: databaseName});
      console.log("loaded localforage", this.store);
      this.store.getItem(this.DATASET_KEY).then((dataset)=> {
        if(!dataset)
        {
          console.log("making new entry for dataset");
          this.store.setItem(this.DATASET_KEY,[]);
          this.store.setItem(this.REC_KEY, 0);
        }
        else
        {
          this.store.getItem(this.REC_KEY).then((rec)=> {
            this.recordingRound = rec;
          });
          console.log("dataset exists of size " + dataset.length);
        }
        this.updateNumExamples();
      });
      if(options.onLoad !== undefined) {
        options.onLoad();
      }
    };
    let origin = document.location.origin
    if(origin.includes("file"))
    {
      origin = "."
    }
    storageScript.src = origin + '/libs/localforage.min.js';
    document.getElementsByTagName('head')[0].appendChild(storageScript);

    this.onRapidLoad = [];
    let rapidLib = document.createElement('script');
    rapidLib.type = 'text/javascript';
    rapidLib.async = true;
    rapidLib.onload = ()=>{
      console.log("rapidlib loaded")
      this.onRapidLoad.forEach((f)=>{
        f()
      });
    }
    rapidLib.src = origin + '/libs/rapidLib.js';
    document.getElementsByTagName('head')[0].appendChild(rapidLib);

    let head = document.getElementsByTagName('HEAD')[0];
    let link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = origin + '/libs/learner.css';
    head.appendChild(link);
    /** Called whenever new output values are returned
        This is either when the GUI has been changed
        or when new values have come from a model when running
        Results are returned as Array of numbers.
      * @example
      * //Classification
      * this.onOutput = (data)=> {
      *   if(data[0] == 0) {
      *     sound.trigger()
      *   } else {
      *     sound2.trigger()
      *   }
      * }
      * @example
      * //Regression (3 outputs)
      * this.onOutput = (data)=> {
      *   sound.pitch = data[0]
      *   sound.volume = data[1]
      *   sound.lfo = data[2]
      * }
      * @example
      * //Series Classification
      * this.onOutput = (data)=> {
      *   if(data[0] == 0) {
      *     sound.trigger()
      *   } else {
      *     sound2.trigger()
      *   }
      * }
        @var {function}
     */
    this.onOutput = ()=> {

    }
  }
  /**
  Add the gui
  @param {Element} [parent = document.body]  - the parent element to append to
  */
  addGUI(p) {
    let parent = document.body;
    if(p)
    {
      parent = p;
    }
    //parent.style.display = "none";
    this.mainContainer = document.createElement('div');
    this.mainContainer.id = "learner-container";
    parent.appendChild(this.mainContainer)
    this.selectorContainer = document.createElement('div');
    this.mainContainer.appendChild(this.selectorContainer)
   	const table = document.createElement("TABLE");
    this.mainContainer.appendChild(table)
    let row = table.insertRow();
    let cell = row.insertCell();
    cell.colSpan = 2;
    this.recBtn = document.createElement("BUTTON");
    this.recBtn.classList.add("learner-btn")
    this.recBtn.onclick = ()=>{
      this.toggleRecord();
    };
    this.recBtn.innerHTML = "Record";
    cell.appendChild(this.recBtn);
    cell = row.insertCell();
    cell.colSpan = 2;
    this.countDown = document.createElement('span')
    this.countDown.classList.add("learner-label");
    cell.appendChild(this.countDown);

	  row = table.insertRow();
    cell = row.insertCell();
    cell.colSpan = 2;
    this.trainBtn = document.createElement("BUTTON");
    this.trainBtn.classList.add("learner-btn")
    this.trainBtn.onclick = ()=>{
      this.train();
    };
    this.trainBtn.innerHTML = "Train";
    cell.appendChild(this.trainBtn);

    row = table.insertRow();
    cell = row.insertCell();
    cell.colSpan = 2;
    this.runBtn = document.createElement("BUTTON");
    this.runBtn.onclick = ()=>{
      this.toggleRun();
    };
    this.runBtn.innerHTML = "Run";
    this.runBtn.classList.add("learner-btn")
    this.runBtn.disabled = true;
    cell.appendChild(this.runBtn);

    row = table.insertRow();
    cell = row.insertCell();
    cell.colSpan = 1;
    this.deleteLastBtn = document.createElement("BUTTON");
    this.deleteLastBtn.classList.add("learner-btn")
    this.deleteLastBtn.classList.add("learner-btn-3");
    this.deleteLastBtn.onclick = ()=>{
      this.deleteLastRound();
    };
    this.deleteLastBtn.innerHTML = "Clear Prev";
    cell.appendChild(this.deleteLastBtn);

    this.deleteBtn = document.createElement("BUTTON");
    cell = row.insertCell();
    cell.colSpan = 1;
    this.deleteBtn.classList.add("learner-btn");
    this.deleteBtn.classList.add("learner-btn-3");
    this.deleteBtn.onclick = ()=>{
      this.clear();
    };
    this.deleteBtn.innerHTML = "Clear All";
    cell.appendChild(this.deleteBtn);

    cell = row.insertCell();
    cell.colSpan = 2;
    this.saveBtn = document.createElement("BUTTON");
    this.saveBtn.classList.add("learner-btn");
    this.saveBtn.onclick = ()=>{
      this.downloadTrainingData();
    };
    this.saveBtn.innerHTML = "Download Data";
    cell.appendChild(this.saveBtn);

    row = table.insertRow();
    cell = row.insertCell();
    cell.colSpan = 2;
    this.datalog = document.createElement('span')
    this.datalog.classList.add("learner-label");
    cell.appendChild(this.datalog);

    this.outputLabel = document.createElement("span");
    this.outputLabel.innerHTML = "Select your outputs"
    this.outputLabel.style.display = "none";
    this.outputLabel.classList.add("learner-label");
    this.selectorContainer.appendChild(this.outputLabel);
    this.randomiseBtn = document.createElement("BUTTON");
    this.randomiseBtn.classList.add("learner-btn")
    this.randomiseBtn.onclick = ()=>{
      this.randomise();
    };
    this.randomiseBtn.innerHTML = "Randomise";
    this.randomiseBtn.style.display = "none";
    this.selectorContainer.appendChild(this.randomiseBtn);

    this.guiParent = parent;

    this.updateNumExamples();
  }

  newRegression() {
    this.rapidLib = RapidLib();
    this.myModel = new this.rapidLib.Regression();
  }

  newClassifier() {
    this.rapidLib = RapidLib();
    this.myModel = new this.rapidLib.Classification();
  }
/**
  Add a regression model
  @param {number} outputs - the number of outputs for the regression model
  @param {boolean} [gui = true]  - Add gui
  @param {number} [numFrames = 0]  - How many frames to smooth the output over
 */
  addRegression(
      n,
      gui = true,
      smoothOutput = 0
      )
   {
      let origin = document.location.origin
      if(origin.includes("file"))
      {
        origin = "http://127.0.0.1:4200"
      }
      const workerUrl = origin + "/libs/regressionWorker.js"
      if(this.USE_WORKER)
      {
        this.setWorker(workerUrl)
      }
      else
      {
        this.newRegression();
      }

      this.modelType = 1;
      this.numOutputs = n;
      this.gui = gui;
      for(let i = 0; i < n; i++)
      {
        this.y.push(0);
        this.addStream(smoothOutput);
      }
      if(gui)
      {
        let container = this.selectorContainer;
        this.randomiseBtn.style.display = "block";
        this.outputLabel.style.display = "block";
        for(let i = 0; i < n; i++)
        {
          let slider = document.createElement('input');
          slider.type = 'range';
          slider.min = 0;
          slider.max = 1;
          slider.value = 0;
          slider.step = 0.01;
          this.outputGUI.push(slider);
          slider.oninput = ()=>{
            this.y[i] = parseFloat(slider.value);
            this.onOutput(this.y);
          }
          container.appendChild(slider);
        }
      }
  }
  /**
    Add a classification model
    @param {number} outputs - the number of classes for the classification model
    @param {boolean} [gui = true]  - Include a gui
    @param {number} [numFrames = 0]  - How many frames to smooth the output over
   */
  addClassifier(
      n,
      gui = true,
      smoothOutput = 0)
  {
    let origin = document.location.origin
    if(origin.includes("file"))
    {
      origin = "http://127.0.0.1:4200"
    }
    const workerUrl = origin + "/libs/classificationWorker.js"
    if(this.USE_WORKER)
    {
      this.setWorker(workerUrl)
    }
    else
    {
      this.newClassifier();
    }
    this.modelType = 0;
    this.addDropdownGui(n, gui, smoothOutput)
  }

  /**
    Add a series model
    @param {number} outputs - the number of gestures for the series model
    @param {boolean} [gui = true]  - Include a gui
    @param {number} [numFrames = 0]  - How many frames to smooth the output over
   */
  addSeries(
      n,
      gui = true,
      smoothOutput = 0)
  {
    let origin = document.location.origin
    if(origin.includes("file"))
    {
      origin = "http://127.0.0.1:4200"
    }
    const workerUrl = origin + "/libs/seriesWorker.js"
    if(this.USE_WORKER)
    {
      this.setWorker(workerUrl)
    }
    this.modelType = 2;

    this.addDropdownGui(n, gui, smoothOutput)
  }

  addDropdownGui(n, gui, smoothOutput) {
    this.numOutputs = 1;
    this.gui = gui;
    this.numClasses = n
    this.y.push(0);
    if(gui)
    {
      let container = this.selectorContainer;;
      var selectList = document.createElement("select");
      this.randomiseBtn.style.display = "none";
      selectList.id = "dropdown";
      var label = document.createElement("p");
      label.innerHTML = "Class:"
      label.id = "class-label"
      selectList.oninput = ()=> {
        this.y[0] = parseInt(selectList.selectedIndex);
        if(this.onOutput !== undefined)
        {
          this.onOutput(this.y)
        }
      }
      container.appendChild(label);
      container.appendChild(selectList);
      for (let i = 0; i < n; i++)
      {
          var option = document.createElement("option");
          option.value = i;
          option.text = i;
          selectList.appendChild(option);
      }
      this.outputGUI.push(selectList);
    }
    this.addStream(smoothOutput)
  }

  addStream(w)
  {
    try {
      if(w > 0)
      {
        if(this.rapidLib === undefined)
        {
          this.rapidLib = RapidLib();
        }
        this.streamBuffers.push(new this.rapidLib.StreamBuffer(w))
      }
    } catch (err) {
      this.onRapidLoad.push(()=>{this.addStream(w)})
    }
  }

  disableButtons(disable)
  {
    this.runBtn.disabled = this.recBtn.disabled = this.trainBtn.disabled = disable;
  }

  updateButtons() {
    this.runBtn.innerHTML = this.running ? "Stop" : "Run"
    this.recBtn.innerHTML = this.recording ? "Stop" : "Record"
    this.recBtn.disabled = this.running;
    this.runBtn.disabled = this.recording;
    this.trainBtn.disabled = this.recording || this.running;
    if(this.onUpdateState)
    {
      this.onUpdateState();
    }
  }

  updateNumExamples() {
    this.numRows().then((n)=>{
      let total = 0;
      if(Array.isArray(n))
      {
        total = n;
      }
      else
      {
         total = n + this.temp.length;
      }
      this.datalog.innerHTML = "You have " + total + " saved examples";
    });
  }

  /**
  Set the delay for recording after the button has been pressed
  @param {number} seconds - The number of seconds to delay
  */
  setCountIn(val) {
    this.countIn = val;
  }

  /**
  Set the timer for how long to record for each time.
  @param {number} seconds - The number of seconds to record for
  */
  setRecordLimit(val) {
    this.recLimit = val;
  }

  isTypedArray(x) {
    return (ArrayBuffer.isView(x) &&
        Object.prototype.toString.call(x) !== "[object DataView]");
  }
  /**
  Provide a new input - output pair.
  If recording, this is added to the dataset.
  If running, the input is given to the model to predict a new output. The outputs is ignored.
  If neither, this does nothing.
  @param {Array} input - An array of numbers for the new input values
  @param {Array} output - An array of numbers for the new output values
  @example
  learner.newExample([1,2,3,4],[5,6])
  */
  newExample(input, y = []) {
    //Convert to Array if TypedArray
    if(this.isTypedArray(input))
    {
      input = Array.prototype.slice.call(input);
    }
    for(let i = 0; i < input.length; i++)
    {
      if(!input[i])
      {
        input[i] = 0;
      }
    }
    for(let i = 0; i < y.length; i++)
    {
      if(!y[i])
      {
        y[i] = 0;
      }
    }
    if(this.recording)
    {
      //ADD TO DATASET
      this.addRow(JSON.parse(JSON.stringify(input)), JSON.parse(JSON.stringify(y)));
    }
    else if(this.running)
    {
      //RUN
      if(this.USE_WORKER)
      {
        if(this.modelType == 2)
        {
          this.temp.push(JSON.parse(JSON.stringify(input)));
        }
        else
        {
          this.myWorker.postMessage({action:"run",data:input});
        }
      }
      else
      {
        let data = this.myModel.run(input)
        this.runEnd(data);
      }
    }
  }

  updateOutput(index, val)
  {
    if(this.gui)
    {
      this.outputGUI[index].value = val;
    }
    this.y[index] = val;
    if(this.onOutput)
    {
	    this.onOutput(this.y)
    }
  }
  /**
  Pass options to the classifier or regression model
  @param {Object} options
  @param {number} options.k - K value for KNN if using classification
  @param {number} options.numEpochs - number of epochs to trian regression model for
  @param {number} options.numHiddenNodes - number of hidden nodes in each hidden layer of regression model
  @param {number} options.numHiddenLayers - number of hidden layers in regression model
   */
  setModelOptions(options) {
    this.modelOptions = options;
    if(this.USE_WORKER)
    {
      if(this.myWorker !== undefined)
      {
        this.myWorker.postMessage({action:"options",data:this.modelOptions});
      }
    }
    else
    {
      if(this.modelOptions.numEpochs !== undefined)
      {
        this.myModel.setNumEpochs(this.modelOptions.numEpochs)
      }
      if(this.modelOptions.numHiddenNodes !== undefined)
      {
        this.myModel.setNumHiddenNodes(this.modelOptions.numHiddenNodes)
      }
      if(this.modelOptions.numHiddenLayers !== undefined)
      {
        this.myModel.setNumHiddenLayers(this.modelOptions.numHiddenLayers)
      }
      if(this.modelOptions.k !== undefined)
      {
        this.myModel.setK(this.modelOptions.k)
      }
    }
  }

  setWorker(url) {
    this.myWorker = this.createWorker(url);
    this.myWorker.onmessage = (event)=>{
      console.log(event)
      if(event.data == "trainingend")
      {
        this.trainingEnd()
      }
      else
      {
        this.runEnd(event.data)
      }
    }
  }

  /**
  Train the current model
   */
  train() {
    if(!this.running && ! this.recording)
    {
      this.disableButtons(true);
      this.trainingData().then((t)=> {
        this.updateNumExamples();
        if(this.USE_WORKER)
        {
          this.myWorker.postMessage({action:"train",data:t});
        }
        else
        {
          this.myModel.train(t);
          this.trainingEnd();
        }
      });
    }
  }

  trainingEnd() {
    this.disableButtons(false);
    if(this.modelType !== 2)
    {
      this.toggleRun()
    }
  }

  /**
  Run/Stop the current model
   */
  toggleRun() {
    this.recording = false;
    this.running = !this.running;
    if(!this.running && this.modelType == 2)
    {
      this.myWorker.postMessage({action:"run",data:this.temp});
      this.temp = [];
    }
    this.updateButtons();
  }

  runEnd(data) {
    if(this.onOutput !== undefined)
    {
      for(let i = 0; i < this.numOutputs; i++)
      {
        let output = data[i];
        if(this.streamBuffers[i] !== undefined)
        {
          this.streamBuffers[i].push(output)
          output = this.streamBuffers[i].mean();
          if(this.modelType == 0)
          {
            output = Math.round(output);
          }
        }
        if(this.gui)
        {
          this.outputGUI[i].value = output;
        }
        this.y[i] = output;
      }
      this.onOutput(this.y);
    }
  }

  limitRecord() {
    let timeLeft = this.recLimit;
    const label = this.cound
    this.stopInterval = setInterval(()=>{
      timeLeft -= 1;
      label.innerHTML = "stopping in " + timeLeft + " secs"
    }, 1000);
    this.stopTimeout = setTimeout(()=>{
      this.stopTimeout = null;
      this.toggleRecord();
    }, this.countIn * 1000)
  }

 /**
  Start/Stop recording
  */
  toggleRecord() {
    if(this.stopInterval)
    {
      clearTimeout(this.stopTimeout);
      clearInterval(this.stopInterval);
      this.stopInterval = null;
      this.stopTimeout = null;
      const label = this.countDown;
      label.innerHTML = "";
    }
    const doRun = ()=> {
      this.running = false;
      this.recording = !this.recording;
      if(!this.recording)
      {
        this.save();
      }
      else
      {
        this.newRecordingRound();
        if(this.recLimit > 0)
        {
		      this.limitRecord();
        }
      }
      this.updateButtons();
      this.runBtn.disabled = true;
    }
    if(this.countIn > 0 && !this.recording)
    {
      let timeLeft = this.countIn;
      const label = this.countDown
      const rec = this.recBtn;
      rec.disabled = true;
      let interval = setInterval(()=>{
        timeLeft -= 1;
        label.innerHTML = "recording in " + timeLeft + " secs"
      }, 1000);
      setTimeout(()=>{
        clearInterval(interval);
        label.innerHTML = "";
        rec.disabled = false;
        doRun();
      }, this.countIn * 1000)
    }
    else
    {
      doRun();
    }
  }
  /**
  Delete all training data
   */
  clear() {
    return new Promise((resolve, reject)=> {
      this.store.setItem(this.DATASET_KEY,[]).then(()=> {
          this.updateNumExamples();
          resolve();
      });
    })

  }
  /**
  Randomise all output parameters
   */
  randomise() {
    for(let i = 0; i < this.numOutputs; i++)
    {
	  this.updateOutput(i, Math.random());
    }
  }
  /**
  Print dataset to console
   */
  print() {
    this.store.getItem(this.DATASET_KEY).then((dataset)=> {
      dataset.forEach((line)=> {
        console.log(line);
      });
    });
  }
  /**
  Delete last round of data (start - stop record cycle)
   */
  deleteLastRound() {
    this.store.getItem(this.DATASET_KEY).then((dataset)=> {
      let trainingData = [];
      if(this.modelType == 2)
      {
        dataset.pop();
        trainingData = dataset;
      }
      else
      {
        dataset.forEach((line)=> {
          if(line.recordingRound < this.recordingRound - 1)
          {
            trainingData.push({input:line.input, output:line.output});
          }
        });
        this.recordingRound--;
        this.store.setItem(this.REC_KEY, this.recordingRound);
      }
      this.store.setItem(this.DATASET_KEY, trainingData).then(()=> {
        this.updateNumExamples();
      });
    });
  }

  addRow(newInputs, newOutputs) {
    if(this.modelType !== 2)
    {
      this.temp.push({input:JSON.parse(JSON.stringify(newInputs)),
                      output:JSON.parse(JSON.stringify(newOutputs)),
                      recordingRound:this.recordingRound});
    }
    else
    {
      this.temp.push(JSON.parse(JSON.stringify(newInputs)));
    }
    this.updateNumExamples();
  }

  save() {
    return new Promise((resolve, reject)=> {
      this.store.getItem(this.DATASET_KEY).then((dataset)=> {
        if(this.modelType == 2 && this.temp.length > 0)
        {
          dataset.push({input:this.temp, label:""+this.y[0]})
        }
        else
        {
          dataset = dataset.concat(this.temp);
        }
        this.temp = [];
        this.store.setItem(this.DATASET_KEY, dataset).then(()=> {
          this.updateNumExamples();
          resolve();
        });
      });
    });
  }

  newRecordingRound() {
  	this.recordingRound++;
    this.store.setItem(this.REC_KEY, this.recordingRound);
  };

  numRows() {
    return new Promise((resolve, reject)=> {
      if(!this.store)
      {
        resolve(0);
      }
      else
      {
        this.store.getItem(this.DATASET_KEY).then((dataset)=> {
          if(dataset !== undefined)
          {
            if(this.modelType === 2) {
              let vals = Array(this.numClasses).fill(0);
              dataset.forEach((s)=> {
                vals[parseInt(s.label)]++;
              });
              resolve(vals);
            }
            else
            {
              resolve(dataset.length);
            }

          }
          else
          {
            resolve(0);
          }
        }).catch((err)=>{resolve(0)});
      }
    });
  };

  /**
  Get training data
  @returns {Promise} Promise represents the training data
   */
  trainingData() {
    return new Promise((resolve, reject)=> {
      this.save().then(()=> {
        this.store.getItem(this.DATASET_KEY).then((dataset)=> {
          resolve(dataset);
        });
      });
    });
  }

  /**
  Load training data from url
  @returns {Promise}
  @param {string} url - URL for json file containing dataset
   */
  loadTrainingData(url) {
    return new Promise((resolve, reject)=> {
      this.clear().then(()=>{
        console.log("fetching loaded data")
        fetch(url)
        .then((response) => {
          return response.json();
        })
        .then((data) => {
          this.temp = data;
          this.save().then(()=> {
            console.log("saving loaded data")
            resolve();
          });
        });
      })
    })
  }
  /**
  Download training data to local machine as json
  @returns {Promise}
   */
  downloadTrainingData() {
    return new Promise((resolve, reject)=> {
      learner.trainingData().then((res)=>{
        learner.downloadObjectAsJson(res, "myLearnerData")
        resolve();
      });
    });
  }


  createWorker (workerUrl) {
	var worker = null;
	try {
		worker = new Worker(workerUrl);
	} catch (e) {
		try {
			var blob;
			try {
				blob = new Blob(["importScripts('" + workerUrl + "');"], { "type": 'application/javascript' });
			} catch (e1) {
				var blobBuilder = new (window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder)();
				blobBuilder.append("importScripts('" + workerUrl + "');");
				blob = blobBuilder.getBlob('application/javascript');
			}
			var url = window.URL || window.webkitURL;
			var blobUrl = url.createObjectURL(blob);
			worker = new Worker(blobUrl);
		} catch (e2) {
			//if it still fails, there is nothing much we can do
		}
	}
	return worker;
  }


  downloadObjectAsJson(exportObj, exportName){
   var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
   var downloadAnchorNode = document.createElement('a');
   downloadAnchorNode.setAttribute("href",     dataStr);
   downloadAnchorNode.setAttribute("download", exportName + ".json");
   document.body.appendChild(downloadAnchorNode); // required for firefox
   downloadAnchorNode.click();
   downloadAnchorNode.remove();
 }

}
