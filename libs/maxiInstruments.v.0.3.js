class MaxiInstruments {

  constructor() {
    this.samplers = [];
    this.synths = [];
    this.synthProcessorName = 'maxi-synth-processor';
    this.version = "v.0.3";
    this.TICKS_PER_BEAT = 24;
    let nexusUI = document.createElement('script');
    nexusUI.type = 'text/javascript';
    nexusUI.async = true;
    nexusUI.onload = function(){
      console.log("nexusUI onload!");
    };
    let origin = document.location.origin
    if(origin.includes("file"))
    {
      origin = "http://127.0.0.1:4200"
    }
    nexusUI.src = origin + '/libs/nexusUI.js';
    document.getElementsByTagName('head')[0].appendChild(nexusUI);
  }

  getSynthName() {
    let origin = document.location.origin
    if(origin.includes("file"))
    {
      origin = "http://127.0.0.1:4200"
    }
    return origin + "/libs/maxiSynthProcessor." + this.version + ".js";
  }

  getInstruments() {
    return this.samplers.concat(this.synths);
  }

  getNumMappedOutputs() {
    return this.getInstruments().reduce((c, s) => c + s.mapped.length, 0);
  }

  addSampler() {
    if (this.audioContext !== undefined) {
      this.node.port.postMessage({addSampler:true});
      let sampler = new MaxiSampler(
        this.node,
        this.samplers.length,
        "sampler",
      	this.audioContext
      );
      if(this.guiElement !== undefined)
      {
        sampler.addGUI(this.guiElement);
      }
      this.samplers.push(sampler);
    }
  }

  addSynth() {
    if(this.audioContext !== undefined) {
      this.node.port.postMessage({addSynth:true});
      let synth = new MaxiSynth(
        this.node,
        this.synths.length,
        "synth",
      	this.audioContext
      );
      if(this.guiElement !== undefined)
      {
        synth.addGUI(this.guiElement);
      }
      this.synths.push(synth);
    }
  }

  setParam(name, val) {
    let param = this.node.parameters.get(name);
    if(param)
    {
      param.setValueAtTime(val, this.audioContext.currentTime)
    }
  }

  setLoop(val) {
    this.setParam("loop", val - 1);
  }

  setLoopBeats(val) {
    this.setParam("loop", (val * this.TICKS_PER_BEAT) - 1);
  }

  setTempo(tempo) {
    this.node.port.postMessage({tempo:tempo});
  }

  getMappedOutputs() {
	  let y = [];
    this.getInstruments().forEach((s)=> {
    	y = y.concat(s.getMappedParameters());
    });
    return y;
  }

  createNode() {
    return new Promise((resolve, reject)=> {
     this.node = new AudioWorkletNode(
        this.audioContext,
        this.synthProcessorName,
        {
          processorOptions: {}
        }
      );
      this.node.onprocessorerror = event => {
        console.log(`MaxiProcessor Error detected: ` + event.data);
      }
      this.node.onprocessorstatechange = event => {
        console.log(`MaxiProcessor state change detected: ` + audioWorkletNode.processorState);
      }
      this.node.port.onmessage = event => {
        //this.onTick(event.data.playHead);
      };
      this.node.port.onmessageerror = event => {
        console.log(`Error message from port: ` + event.data);
      };
      this.node.connect(this.audioContext.destination);
      resolve()
    });
  }

  loadModule(url) {
    return new Promise((resolve, reject)=> {
      console.log("adding module", url);
      this.audioContext.audioWorklet.addModule(url).then(() => {
        console.log("added module");
        resolve();
      }).catch((e) => {
        console.log("Error on loading worklet: ", e)
        reject(e);
      });
    });
  }

  loadModules() {
    return new Promise((resolve, reject)=> {
      if (this.audioContext === undefined) {
        try {
          this.audioContext = new AudioContext({
            latencyHint:'playback',
            sample: 44100
          });
         this.loadModule(this.getSynthName()).then(()=> {
            this.createNode().then(resolve);
          }).catch((err)=> {
            reject(err);
          });
        } catch (err) {
          reject(err);
        }
      }
      else
      {
        reject("audio context already exists");
      }
    });
  }

  updateMappedOutputs(data)
  {
    let outputCtr = 0;
    let instrumentCtr = 0;
    const instruments = this.samplers.concat(this.synths);
   	data.forEach((val)=> {
      let found = false;
      while(!found && instrumentCtr < instruments.length)
      {
        const s = instruments[instrumentCtr];
        if(s.mapped.length > 0)
        {
          s.onMLChange(val, outputCtr)
		      found = true;
        }
        outputCtr++;
        if(outputCtr >= s.mapped.length)
        {
          instrumentCtr++;
          outputCtr = 0;
        }
      }
    });
  }

  stopAudio() {
    if (this.audioContext !== undefined) {
      this.audioContext.suspend();
    }
  }

  playPause() {
    this.node.port.postMessage({togglePlaying:true});
  }

  rewind() {
    console.log("REWIND")
    this.node.port.postMessage({rewind:true});
  }

}

class MaxiInstrument {

  constructor(node, index, instrument, audioContext) {
    this.node = node;
    this.index = index;
    this.instrument = instrument;
    this.audioContext = audioContext;
    this.mapped = [];
    this.outputGUI = [];
    this.TICKS_PER_BEAT = 24;
    this.docId = "local";
    console.log(window)
    if(window.frameElement)
    {
      this.docid == window.frameElement.name
    }
  }
  noteon(freq = 1) {
    this.node.port.postMessage({
      noteon:{
        instrument:this.instrument,
        index:this.index,
        val:freq
      }
    });
  }

  noteoff(freq = 1) {
    this.node.port.postMessage({
      noteoff:{
        instrument:this.instrument,
        index:this.index,
        val:freq
      }
    });
  }

  setSequence(seq, instruments = [], muteDrums = false) {
    const notes = seq.notes;
   	let toAdd = [];
    let mul = 1;
    if(seq.quantizationInfo)
    {
		  mul = this.TICKS_PER_BEAT / seq.quantizationInfo.stepsPerQuarter;
    }
    notes.forEach((n)=> {
      let doAdd = true;
      if(instruments.length > 0)
      {
		    doAdd = instruments.includes(n.instrument);
      }
      //If instrument selected, check for drums
      if(doAdd && muteDrums)
      {
      	doAdd = !n.isDrum;
      }
      if(doAdd)
      {
        let start = n.start;
        if(!start && n.quantizedStartStep !== undefined)
        {
          start = n.quantizedStartStep;
        }
        let end = n.end;
        if(!end && n.quantizedEndStep !== undefined)
        {
          end = n.quantizedEndStep
        }
        else
        {
          end = start + 1;
        }
      	toAdd.push({cmd:"noteon", f:this.getFreq(n.pitch), t:start * mul});
      	toAdd.push({cmd:"noteoff", f:this.getFreq(n.pitch), t:end * mul});
      }
    });
    toAdd.sort((a, b)=> {
      return a.t - b.t;
    });
    this.node.port.postMessage({
      sequence:{
        instrument:this.instrument,
        index:this.index,
        val:toAdd
      }
    });
  }

  onGUIChange(val, index) {
    const key = Object.keys(this.parameters)[index];
    this.onChange(val, key);
    this.saveParamValues();
  }

  onMLChange(val, index) {
    this.outputGUI[this.mapped[index]].value = val;
    this.onChange(val, this.mapped[index]);
  }

  onChange(val, key) {
    const scaled = (this.parameters[key].scale * val) + this.parameters[key].translate;
    this.setParam(key, scaled);
  }

  randomise() {
    this.mapped.forEach((key)=> {
      const val = Math.random();
      this.outputGUI[key].value = val;
      this.onChange(val, key);
    })
  }

  getMappedParameters() {
    let vals = [];
    this.mapped.forEach((key)=> {
      vals.push(this.outputGUI[key].value);
    })
    return vals;
  }

  sendDefaultParam() {
    this.node.port.postMessage({
      "parameters":{
        instrument:this.instrument,
        index:this.index,
        val:this.parameters
      }
    });
  }

  setParam(name, val) {
    let param = this.node.parameters.get(name);
    if(param)
    {
      param.setValueAtTime(val, this.context.currentTime)
    }
    else if (this.parameters[name])
    {
      this.parameters[name].val = val;
      if(name == "poly")
      {
        console.log(name, val)
      }
      this.node.port.postMessage({
        "parameters":{
          instrument:this.instrument,
          index:this.index,
          val:this.parameters
        }
      });
    }
  }

  getParamKey() {
    return "key";
  }

  saveParamValues() {
    const key = this.getParamKey();
    window.localStorage.setItem(
      key,
      JSON.stringify(this.getParamValues())
    );
  }

  loadParamValues() {
    const key = this.getParamKey();
    const vals = JSON.parse(window.localStorage.getItem(key))
    if(vals)
    {
      Object.keys(vals).forEach((key)=>{
        const val = parseFloat(vals[key]);
        if(this.outputGUI[key])
        {
          this.outputGUI[key].value = val;
          this.onChange(val, key);
        }
      });
    }
  }

  getParamValues() {
    let vals = {};
   	Object.keys(this.outputGUI).forEach((p)=> {
    	vals[p] = this.outputGUI[p].value;
    })
    return vals;
  }
}

class MaxiSynth extends MaxiInstrument {

  constructor(node, index, instrument, audioContext) {
    super(node, index, instrument, audioContext);

    this.parameters = {
      "gain":{scale:1, translate:0, val:1},
      "attack":{scale:1500, translate:0, val:1000},
      "decay":{scale:1500, translate:0, val:1000},
      "sustain":{scale:1, translate:0, val:1},
      "release":{scale:1500, translate:0, val:1000},
      "lfoFrequency":{scale:10, translate:0, val:0},
      "lfoPitchMod":{scale:100, translate:0, val:1},
      "lfoFilterMod":{scale:8000, translate:0, val:1},
      "lfoAmpMod":{scale:1, translate:0, val:0},
      "adsrPitchMod":{scale:100, translate:0, val:1},
      "cutoff":{scale:3000, translate:40, val:2000},
      "Q":{scale:2, translate:0, val:1},
      "frequency":{scale:1000, translate:0, val:440},
      "frequency2":{scale:1000, translate:0, val:440},
      "poly":{scale:1, translate:0, val:1},
      "oscFn":{scale:1, translate:0, val:0},
    }
    this.sendDefaultParam();
  }

  setOsc(osc) {
    this.setParam("oscFn", osc);
  }

  getParamKey() {
    return this.docId + "_synth_" + this.index;
  }

  getFreq(n) {
    return Nexus.mtof(n);
  }

  addGUI(element) {
    const rowLength = 4;
    const table = document.createElement("TABLE");
    let row = table.insertRow();
    element.appendChild(table);
    table.style.border = "1px solid black"

    const title = document.createElement('p');
    title.innerHTML = "MaxiSynth";
    title.style.fontSize = "10pt";
    title.style.margin = "3pt";

    const randomButton = document.createElement("BUTTON");
    randomButton.innerHTML = "Randomise"
    randomButton.onclick = ()=>{
      this.randomise();
    }

    const oscillatorSelector = document.createElement("select");
    ["sin", "tri", "saw", "noise"].forEach((osc, i)=> {
      const option = document.createElement("option");
      option.value = i;
      option.text = osc;
      oscillatorSelector.appendChild(option);
    });
    oscillatorSelector.onchange = ()=> {
      const index = parseInt(oscillatorSelector.selectedIndex);
      this.onGUIChange(index, Object.keys(this.parameters).length - 1);
    }
    this.outputGUI.oscFn = oscillatorSelector;

    const printParamsButton = document.createElement("BUTTON");
    printParamsButton.innerHTML = "Dump"
    printParamsButton.onclick = ()=>{
      let str = "vals:{\n";
      const vals = this.getParamValues();
      Object.keys(vals).forEach((key)=>{
		str += "\t" + key + ":" + vals[key] + ",\n"
      });
      str += "}"
      console.log(str)
    }

    const presets = [
      {title:"--presets--"},
      {title:"Peep",
       vals:{
            oscFn:1,
            frequency:0.44,
            frequency2:0.22,
            attack:0.06,
            decay:0.04,
            sustain:0.02,
            release:0.03,
            lfoFrequency:0,
            lfoPitchMod:0,
            lfoFilterMod:0,
            lfoAmpMod:0.18,
            adsrAmpMod:1,
            adsrPitchMod:0.45,
            adsrFilterMod:1,
            cutoff:1,
            Q:0,
        }
      },
      {title:"Accordion",
         vals:{
          oscFn:1,
          frequency:0.44,
          frequency2:0.22,
          attack:0.65,
          decay:0.02,
          sustain:0.01,
          release:0.07,
          lfoFrequency:0.79,
          lfoPitchMod:0,
          lfoFilterMod:0,
          lfoAmpMod:0,
          adsrAmpMod:1,
          adsrPitchMod:0,
          adsrFilterMod:1,
          cutoff:1,
          Q:1,
    	}
      },
      {title:"Snare",
        vals:{
            oscFn:3,
            frequency:0.44,
            frequency2:0.22,
            attack:0.03,
            decay:0.26,
            sustain:0.12,
            release:0.28,
            lfoFrequency:0,
            lfoPitchMod:0,
            lfoFilterMod:0,
            lfoAmpMod:0,
            adsrAmpMod:1,
            adsrPitchMod:0,
            adsrFilterMod:0,
            cutoff:0.91,
            Q:0.3,
        }
      },
      {title:"Factory",
        vals:{
            oscFn:2,
            frequency:0.44,
            frequency2:0.22,
            attack:1,
            decay:0.07,
            sustain:0.35,
            release:0.04,
            lfoFrequency:0,
            lfoPitchMod:0,
            lfoFilterMod:0,
            lfoAmpMod:0.18,
            adsrAmpMod:1,
            adsrPitchMod:1,
            adsrFilterMod:1,
            cutoff:1,
            Q:0.5,
        }
      },
      {title:"Strings",
      	vals:{
            oscFn:2,
            frequency:0.44,
            frequency2:0.22,
            attack:0.67,
            decay:0.67,
            sustain:1,
            release:0.67,
            lfoFrequency:0,
            lfoPitchMod:0,
            lfoFilterMod:0,
            lfoAmpMod:0,
            adsrAmpMod:1,
            adsrPitchMod:0,
            adsrFilterMod:1,
            cutoff:1,
            Q:0.5,
        }
      },
      {title:"Underwater",
        vals:{
          oscFn:0,
          frequency:0.44,
          frequency2:0.22,
          attack:1,
          decay:0.58,
          sustain:0.22,
          release:0.16,
          lfoFrequency:0.88,
          lfoPitchMod:0,
          lfoFilterMod:0.08,
          lfoAmpMod:0,
          adsrAmpMod:1,
          adsrPitchMod:0,
          adsrFilterMod:0,
          cutoff:0.23,
          Q:0.36,
        }
      },
      {title:"Squelch",
        vals:{
            oscFn:2,
            frequency:0.44,
            frequency2:0.22,
            attack:0.06,
            decay:0.58,
            sustain:0.22,
            release:0.41,
            lfoFrequency:1,
            lfoPitchMod:0,
            lfoFilterMod:0.13,
            lfoAmpMod:0,
            adsrAmpMod:1,
            adsrPitchMod:0,
            adsrFilterMod:0,
            cutoff:1,
            Q:0.93,
        }
      },
      {title:"Fairground",
      	vals:{
          oscFn:0,
          frequency:0.44,
          frequency2:0.22,
          attack:0.67,
          decay:0.67,
          sustain:0.7,
          release:0.67,
          lfoFrequency:0.97,
          lfoPitchMod:0,
          lfoFilterMod:0,
          lfoAmpMod:0.18,
          adsrAmpMod:1,
          adsrPitchMod:0,
          adsrFilterMod:1,
          cutoff:1,
          Q:0.5
        }
      },
      {title:"Raymond",
        vals:{
          oscFn:2,
          frequency:0.44,
          frequency2:0.22,
          attack:0.26,
          decay:0.67,
          sustain:0.7,
          release:0.13,
          lfoFrequency:0.97,
          lfoPitchMod:0,
          lfoFilterMod:0.88,
          lfoAmpMod:0,
          adsrAmpMod:1,
          adsrPitchMod:0,
          adsrFilterMod:1,
          cutoff:1,
          Q:0.5
      	},
      },
      {title:"Skep",
      vals:{
        oscFn:1,
        frequency:0.44,
        frequency2:0.22,
        attack:0.08,
        decay:0.22,
        sustain:0.13,
        release:1,
        lfoFrequency:0.05,
        lfoPitchMod:0,
        lfoFilterMod:0,
        lfoAmpMod:0.07,
        adsrAmpMod:1,
        adsrPitchMod:0.06,
        adsrFilterMod:0,
        cutoff:0.86,
        Q:0.25
      	}
      }
    ];
    const presetSelector = document.createElement("select");
    presets.forEach((preset)=> {
      const option = document.createElement("option");
      option.value = 0;
      option.text = preset.title;
      presetSelector.appendChild(option);
    });
    presetSelector.onchange = ()=> {
      const index = parseInt(presetSelector.selectedIndex);
      if(index > 0)
      {
        const preset = presets[index];
        Object.keys(preset.vals).forEach((key)=>{
          const val = preset.vals[key];
          if(this.outputGUI[key])
          {
            this.outputGUI[key].value = val;
            this.onChange(val, key);
          }
        });
        this.saveParamValues();
      }
    }

    let cell = row.insertCell();
    cell.appendChild(title);
    cell = row.insertCell();
    cell.appendChild(randomButton);
    cell.appendChild(oscillatorSelector);
    cell = row.insertCell();
    cell.colSpan = "2"
    cell.appendChild(presetSelector);
    cell = row.insertCell();
    cell.appendChild(printParamsButton);

    for(let i = 0; i < Object.keys(this.parameters).length; i++)
    {
      let p = Object.keys(this.parameters)[i];
      if(p !== "oscFn" && p !== "poly")
      {
        if(i % rowLength === 0)
        {
          row = table.insertRow();
        }
        cell = row.insertCell();
        cell.classList.add("cell_" + p);
        cell.style.border = "1px solid black";
        let val = this.parameters[p].val;
        val = (val - this.parameters[p].translate) / this.parameters[p].scale;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 1;
        slider.step = 0.01;
        slider.value = val;
        this.outputGUI[p] = slider;
        slider.oninput = ()=> {
          this.onGUIChange(slider.value, i);
        }
        cell.appendChild(slider);
        const label = document.createElement('p');
        label.innerHTML = p;
        label.style.width = "100px";
        label.style.fontSize = "8pt";
        label.style.margin = "2px";
        cell.appendChild(label);
      }

    }
    this.loadParamValues();
    this.useFreqSliders(this.parameters["poly"] == 0)
  }

  useFreqSliders(useSliders) {
    this.setParam("poly", useSliders ? 0 : 1)
    const vis = useSliders ? "visible" : "hidden"
    let elem = document.getElementsByClassName("cell_frequency");
    for (let e of elem) {
      e.style.visibility = vis;
    };
    elem = document.getElementsByClassName("cell_frequency2");
    for (let e of elem) {
      e.style.visibility = vis;
    };
  }
}

class MaxiSampler extends MaxiInstrument {

   constructor(node, index, instrument, audioContext) {
    super(node, index, instrument, audioContext);
    const core = {
      "gain":{scale:1, translate:0, min:0, max:1, val:0.5},
      "rate":{scale:1, translate:0, min:0, max:4, val:1},
      // "end":{scale:1, translate:0, min:0, max:1, val:1},
      // "start":{scale:1, translate:0, min:0, max:1, val:0}
    };
    this.voices = 8;
    this.group = 1;
    this.parameters = {};
    const keys = Object.keys(core);
    for(let i = 0; i < this.voices; i++)
    {
      for(let j = 0; j < keys.length; j++) {
        const key = keys[j]+"_"+i;
        this.parameters[key] = JSON.parse(JSON.stringify(core[keys[j]]))
      };
    }
    this.keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    this.sendDefaultParam();
  }

  getFreq(n)
  {
    return n;
  }

  getParamKey()
  {
    return this.docId + "_sampler_" + this.index;
  }

  toggleGroup() {
    this.group = this.group == 0 ? 1 : 0;
    const changeGroupButton = document.getElementById("changeGroupButton");
    const slots = this.group == 0 ? "5-8" : "1-4";
    changeGroupButton.innerHTML = "View Samples " + slots;
    const indexes = [0,1,2,3].map(x => x + ((this.voices / 2) * this.group))
    Object.keys(this.parameters).forEach((p)=> {
      let elem = document.getElementsByClassName("cell_" + p);
      const i = parseInt(p.split("_")[1])
      const vis = indexes.includes(i) ? "table-cell" : "none";
      for (let e of elem)
      {
        e.style.display = vis;
      }
    })

  }

  addGUI(element) {
    const rowLength = 4;
    const title = document.createElement('p');
    title.innerHTML = "MaxiSampler";
    title.style.fontSize = "10pt";
    title.style.margin = "3pt";
    element.appendChild(title);
    const changeGroupButton = document.createElement("BUTTON");
    changeGroupButton.innerHTML = "View Samples 5-8";
    changeGroupButton.id = "changeGroupButton";
    changeGroupButton.onclick = ()=>{
      this.toggleGroup();
    }
    element.appendChild(changeGroupButton);
    const table = document.createElement("TABLE");
    element.appendChild(table);
    let row;
    table.style.border = "1px solid black"
    for(let i = 0; i < Object.keys(this.parameters).length; i++)
    {
      let p = Object.keys(this.parameters)[i];
      if(i % rowLength === 0)
      {
        row = table.insertRow();
      }
      const cell = row.insertCell();
      cell.classList.add("cell_" + p);
      cell.style.border = "1px solid black";
      let val = this.parameters[p].val;
      val = (val - this.parameters[p].translate) / this.parameters[p].scale;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = this.parameters[p].min;
      slider.max = this.parameters[p].max;
      slider.step = 0.01;
      slider.value = val;
      this.outputGUI[p] = slider;
      slider.oninput = ()=> {
        this.onGUIChange(slider.value, i);
      }
      cell.appendChild(slider);
      const label = document.createElement('p');
      label.innerHTML = p;
      label.style.width = "100px";
      label.style.fontSize = "8pt";
      label.style.margin = "2px";
      cell.appendChild(label);
    }
    this.loadParamValues();
    this.toggleGroup();
  }

  loadSample(url, index) {
    console.log("loadSamples", this.index);
    if (this.audioContext !== undefined) {
      this.loadSampleToArray(index, url)
    } else throw "Audio Context is not initialised!";
  }

  sendAudioArray(sampleWorkletObjectName, float32Array) {
    console.log("sendAudioArray");
    if (float32Array !== undefined && this.node !== undefined) {
      this.node.port.postMessage({
        audio:{
          instrument:"sampler",
          index:this.index,
          val:{
            audioBlob: float32Array,
        	  index:parseInt(sampleWorkletObjectName)
          }
        }
      });
    }
  }

  getArrayAsVectorDbl (arrayIn) {
    var vecOut = new exports.VectorDouble();
    for (var i = 0; i < arrayIn.length; i++) {
      vecOut.push_back(arrayIn[i]);
    }
    return vecOut;
  };

  getBase64(str) {
    //check if the string is a data URI
    if (str.indexOf(';base64,') !== -1) {
      //see where the actual data begins
      var dataStart = str.indexOf(';base64,') + 8;
      //check if the data is base64-encoded, if yes, return it
      // taken from
      // http://stackoverflow.com/a/8571649
      return str.slice(dataStart).match(/^([A-Za-z0-9+\/]{4})*([A-Za-z0-9+\/]{4}|[A-Za-z0-9+\/]{3}=|[A-Za-z0-9+\/]{2}==)$/) ? str.slice(dataStart) : false;
    } else return false;
  };

  //

  removePaddingFromBase64(input) {
    var lkey = this.keyStr.indexOf(input.charAt(input.length - 1));
    if (lkey === 64) {
      return input.substring(0, input.length - 1);
    }
    return input;
  };

  loadSampleToArray (sampleObjectName, url) {
    var data = [];

    var context = this.audioContext;

    var b64 = this.getBase64(url);
    if (b64) {
      var ab_bytes = (b64.length / 4) * 3;
      var arrayBuffer = new ArrayBuffer(ab_bytes);

      b64 = this.removePaddingFromBase64(this.removePaddingFromBase64(b64));

      var bytes = parseInt((b64.length / 4) * 3, 10);

      var uarray;
      var chr1, chr2, chr3;
      var enc1, enc2, enc3, enc4;
      var i = 0;
      var j = 0;

      uarray = new Uint8Array(arrayBuffer);

      b64 = b64.replace(/[^A-Za-z0-9\+\/\=]/g, "");

      for (i = 0; i < bytes; i += 3) {
        //get the 3 octects in 4 ascii chars
        enc1 = this.keyStr.indexOf(b64.charAt(j++));
        enc2 = this.keyStr.indexOf(b64.charAt(j++));
        enc3 = this.keyStr.indexOf(b64.charAt(j++));
        enc4 = this.keyStr.indexOf(b64.charAt(j++));

        chr1 = (enc1 << 2) | (enc2 >> 4);
        chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        chr3 = ((enc3 & 3) << 6) | enc4;

        uarray[i] = chr1;
        if (enc3 !== 64) {
          uarray[i + 1] = chr2;
        }
        if (enc4 !== 64) {
          uarray[i + 2] = chr3;
        }
      }
      context.decodeAudioData(
        arrayBuffer, // has its content-type determined by sniffing
        (buffer)=> {
          data = buffer.getChannelData(0);
          if (data) this.sendAudioArray(sampleObjectName, data);
        },
        (buffer)=> { // errorCallback
          console.log("Error decoding source!");
        }
      );
    } else {
      var request = new XMLHttpRequest();
      request.addEventListener("load", () => console.log("The transfer is complete."));
      request.open("GET", url, true);
      request.responseType = "arraybuffer";
      request.onload = ()=>{
        context.decodeAudioData(
          request.response,
          (buffer)=> {
            data = buffer.getChannelData(0);
            if (data) this.sendAudioArray(sampleObjectName, data);
          },
          (buffer)=> {
            console.log("Error decoding source!");
          },
        )
      };
      request.send();
    }
  }
}
