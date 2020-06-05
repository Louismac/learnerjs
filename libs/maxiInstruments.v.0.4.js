//From Paul Adenot https://github.com/padenot/ringbuf.js

class RingBuffer {
  static getStorageForCapacity(capacity, type) {
    if (!type.BYTES_PER_ELEMENT) {
      throw "Pass in a ArrayBuffer subclass";
    }
    var bytes = 8 + (capacity + 1) * type.BYTES_PER_ELEMENT;
    return new SharedArrayBuffer(bytes);
  }
  // `sab` is a SharedArrayBuffer with a capacity calculated by calling
  // `getStorageForCapacity` with the desired capacity.
  constructor(sab, type) {
    if (!ArrayBuffer.__proto__.isPrototypeOf(type) &&
      type.BYTES_PER_ELEMENT !== undefined) {
      throw "Pass a concrete typed array class as second argument";
    }

    // Maximum usable size is 1<<32 - type.BYTES_PER_ELEMENT bytes in the ring
    // buffer for this version, easily changeable.
    // -4 for the write ptr (uint32_t offsets)
    // -4 for the read ptr (uint32_t offsets)
    // capacity counts the empty slot to distinguish between full and empty.
    this._type = type;
    this.capacity = (sab.byteLength - 8) / type.BYTES_PER_ELEMENT;
    this.buf = sab;
    this.write_ptr = new Uint32Array(this.buf, 0, 1);
    this.read_ptr = new Uint32Array(this.buf, 4, 1);
    this.storage = new type(this.buf, 8, this.capacity);
  }
  // Returns the type of the underlying ArrayBuffer for this RingBuffer. This
  // allows implementing crude type checking.
  type() {
    return this._type.name;
  }
  // Push bytes to the ring buffer. `bytes` is an typed array of the same type
  // as passed in the ctor, to be written to the queue.
  // Returns the number of elements written to the queue.
  push(elements) {

    var rd = Atomics.load(this.read_ptr, 0);
    var wr = Atomics.load(this.write_ptr, 0);
    if ((wr + 1) % this._storage_capacity() == rd) {
      // full
      return 0;
    }

    let to_write = Math.min(this._available_write(rd, wr), elements.length);
    let first_part = Math.min(this._storage_capacity() - wr, to_write);
    let second_part = to_write - first_part;

    this._copy(elements, 0, this.storage, wr, first_part);
    this._copy(elements, first_part, this.storage, 0, second_part);

    // publish the enqueued data to the other side
    Atomics.store(
      this.write_ptr,
      0,
      (wr + to_write) % this._storage_capacity()
    );

    return to_write;
  }
  // Read `elements.length` elements from the ring buffer. `elements` is a typed
  // array of the same type as passed in the ctor.
  // Returns the number of elements read from the queue, they are placed at the
  // beginning of the array passed as parameter.
  pop(elements) {
    var rd = Atomics.load(this.read_ptr, 0);
    var wr = Atomics.load(this.write_ptr, 0);
    if (wr == rd) {
      return 0;
    }

    let to_read = Math.min(this._available_read(rd, wr), elements.length);

    let first_part = Math.min(this._storage_capacity() - rd, elements.length);
    let second_part = to_read - first_part;

    this._copy(this.storage, rd, elements, 0, first_part);
    this._copy(this.storage, 0, elements, first_part, second_part);

    Atomics.store(this.read_ptr, 0, (rd + to_read) % this._storage_capacity());

    return to_read;
  }

  // True if the ring buffer is empty false otherwise. This can be late on the
  // reader side: it can return true even if something has just been pushed.
  empty() {
    var rd = Atomics.load(this.read_ptr, 0);
    var wr = Atomics.load(this.write_ptr, 0);

    return wr == rd;
  }

  // True if the ring buffer is full, false otherwise. This can be late on the
  // write side: it can return true when something has just been poped.
  full() {
    var rd = Atomics.load(this.read_ptr, 0);
    var wr = Atomics.load(this.write_ptr, 0);

    return (wr + 1) % this.capacity != rd;
  }

  // The usable capacity for the ring buffer: the number of elements that can be
  // stored.
  capacity() {
    return this.capacity - 1;
  }

  // Number of elements available for reading. This can be late, and report less
  // elements that is actually in the queue, when something has just been
  // enqueued.
  available_read() {
    var rd = Atomics.load(this.read_ptr, 0);
    var wr = Atomics.load(this.write_ptr, 0);
    return this._available_read(rd, wr);
  }

  // Number of elements available for writing. This can be late, and report less
  // elements that is actually available for writing, when something has just
  // been dequeued.
  available_write() {
    var rd = Atomics.load(this.read_ptr, 0);
    var wr = Atomics.load(this.write_ptr, 0);
    return this._available_write(rd, wr);
  }

  // private methods //

  // Number of elements available for reading, given a read and write pointer..
  _available_read(rd, wr) {
    if (wr > rd) {
      return wr - rd;
    } else {
      return wr + this._storage_capacity() - rd;
    }
  }

  // Number of elements available from writing, given a read and write pointer.
  _available_write(rd, wr) {
    let rv = rd - wr - 1;
    if (wr >= rd) {
      rv += this._storage_capacity();
    }
    return rv;
  }

  // The size of the storage for elements not accounting the space for the index.
  _storage_capacity() {
    return this.capacity;
  }

  // Copy `size` elements from `input`, starting at offset `offset_input`, to
  // `output`, starting at offset `offset_output`.
  _copy(input, offset_input, output, offset_output, size) {
    for (var i = 0; i < size; i++) {
      output[offset_output + i] = input[offset_input + i];
    }
  }
}

class ArrayWriter {
  // From a RingBuffer, build an object that can enqueue enqueue audio in a ring
  // buffer.
  constructor(ringbuf) {
    if (ringbuf.type() != "Float32Array") {
      throw "This class requires a ring buffer of Float32Array";
    }
    this.ringbuf = ringbuf;
  }
  // Enqueue a buffer of interleaved audio into the ring buffer.
  // Returns the number of samples that have been successfuly written to the
  // queue. `buf` is not written to during this call, so the samples that
  // haven't been written to the queue are still available.
  enqueue(buf) {
    return this.ringbuf.push(buf);
  }
  // Query the free space in the ring buffer. This is the amount of samples that
  // can be queued, with a guarantee of success.
  available_write() {
    return this.ringbuf.available_write();
  }
}

class ArrayReader {
  constructor(ringbuf) {
    if (ringbuf.type() != "Float32Array") {
      throw "This class requires a ring buffer of Float32Array";
    }
    this.ringbuf = ringbuf;
  }
  // Attempt to dequeue at most `buf.length` samples from the queue. This
  // returns the number of samples dequeued. If greater than 0, the samples are
  // at the beginning of `buf`
  dequeue(buf) {
    if (this.ringbuf.empty()) {
      return false;
    }
    return this.ringbuf.pop(buf);
  }
  // Query the occupied space in the queue. This is the amount of samples that
  // can be read with a guarantee of success.
  available_read() {
    return this.ringbuf.available_read();
  }
}



class MaxiInstruments {

  constructor() {
    this.samplers = [];
    this.globalParameters = new Float32Array(256);
    this.loops = new Float32Array(16);
    this.synths = [];
    this.sendTick = false;
    this.synthProcessorName = 'maxi-synth-processor';
    this.version = "v.0.4";
    this.TICKS_PER_BEAT = 24;
    this.NUM_SYNTHS = 6;
    this.NUM_SYNTH_PARAMS = 18;
    this.NUM_SAMPLERS = 6;
    this.NUM_SAMPLER_PARAMS = (2 * 8) + 2;
    this.GLOBAL_OFFSET =
      (this.NUM_SYNTHS *this.NUM_SYNTH_PARAMS) +
      (this.NUM_SAMPLERS * this.NUM_SAMPLER_PARAMS);
    var head = document.getElementsByTagName('HEAD')[0];
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
    head.appendChild(nexusUI);
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = origin + '/libs/maxiInstruments.css';
    head.appendChild(link);
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
    let sampler;
    if (this.audioContext !== undefined) {
      this.node.port.postMessage({addSampler:true});
      sampler = new MaxiSampler(
        this.node,
        this.samplers.length,
        "sampler",
      	this.audioContext,
        (index, val, send = true)=>{
          this.globalParameters[index] = val;
          if(this.paramWriter !== undefined && send)
          {
            this.paramWriter.enqueue(this.globalParameters);
          }
        }
      );
      if(this.guiElement !== undefined)
      {
        sampler.addGUI(this.guiElement);
      }
      this.samplers.push(sampler);
    }
    return sampler;
  }

  addSynth() {
    let synth;
    if(this.audioContext !== undefined) {
      this.node.port.postMessage({addSynth:true});
      synth = new MaxiSynth(
        this.node,
        this.synths.length,
        "synth",
      	this.audioContext,
        (index, val, send = true)=>{
          this.globalParameters[index] = val;
          if(this.paramWriter !== undefined && send)
          {
            this.enqueue();
          }
        }
      );
      if(this.guiElement !== undefined)
      {
        synth.addGUI(this.guiElement);
      }
      this.synths.push(synth);
    }
    return synth;
  }

  enqueue() {
      let success = this.paramWriter.enqueue(this.globalParameters);
      this.retryEnqueue(success, 0)
  }

  retryEnqueue(success, ctr) {
    if(!success && ctr < 20) {
      setTimeout(()=>{
        //console.log("retry", ctr)
        success = this.paramWriter.enqueue(this.globalParameters);
        this.retryEnqueue(success, ctr + 1)
      }, 30)
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
    this.node.port.postMessage({loopAll: val - 1});
  }

  setLoopBeats(val) {
    this.node.port.postMessage({loopAll: (val * this.TICKS_PER_BEAT) - 1});
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
      window.node = this.node;

      let sab3 = RingBuffer.getStorageForCapacity(256, Float32Array);
      let rb3 = new RingBuffer(sab3, Float32Array);
      this.paramWriter = new ArrayWriter(rb3);
      this.node.port.postMessage({
        type: "recv-param-queue",
        data: sab3
      });
      this.node.onprocessorerror = event => {
        console.log(`MaxiProcessor Error detected: ` + event.data);
      }
      this.node.onprocessorstatechange = event => {
        console.log(`MaxiProcessor state change detected: ` + audioWorkletNode.processorState);
      }
      this.node.port.onmessage = event => {
        if (event.data.type === "recv-loop-queue")
        {
          const b = new RingBuffer(event.data.data, Float32Array);
          this.loopReader = new ArrayReader(b);
          setInterval(()=> {
            if(this.loopReader !== undefined)
            {
              if(this.loopReader.dequeue(this.loops))
              {
                if(this.onTick !== undefined)
                {
                  this.onTick(this.loops);
                }
              }
            }
          }, 10)
        }
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

  setOnTick(onTick) {
    this.onTick = onTick;
    if(!this.sendTick) {
      this.sendTick = true;
      this.node.port.postMessage({sendTick:true});
    }
  }
}

class MaxiInstrument {

  constructor(node, index, instrument, audioContext, onParamUpdate) {
    this.node = node;
    this.index = index;
    this.instrument = instrument;
    this.audioContext = audioContext;
    this.onParamUpdate = onParamUpdate;
    this.mapped = [];
    this.outputGUI = [];
    this.TICKS_PER_BEAT = 24;
    this.NUM_SYNTHS = 6;
    this.NUM_SYNTH_PARAMS = 18;
    this.NUM_SAMPLERS = 6;
    this.NUM_SAMPLER_PARAMS = (2 * 8) + 2;
    this.GLOBAL_OFFSET =
      (this.NUM_SYNTHS * this.NUM_SYNTH_PARAMS) +
      (this.NUM_SAMPLERS * this.NUM_SAMPLER_PARAMS);
    this.docId = "local";
    if(window.frameElement)
    {
      this.docId = window.frameElement.name
    }
  }

  setLoop(val) {
    this.node.port.postMessage({
      loop:{
        instrument:this.instrument,
        index:this.index,
        val:val
      }
    });
  }

  setLoopBeats(val) {
    this.node.port.postMessage({
      loop:{
        instrument:this.instrument,
        index:this.index,
        val:(val * this.TICKS_PER_BEAT) - 1
      }
    });
  }

  noteon(freq = 60, vel = 127) {
    //console.log("instrument note on", this.instrument, this.index, freq, vel)
    this.node.port.postMessage({
      noteon:{
        instrument:this.instrument,
        index:this.index,
        val:{f:freq, v:vel}
      }
    });
  }

  noteoff(freq = 60) {
    this.node.port.postMessage({
      noteoff:{
        instrument:this.instrument,
        index:this.index,
        val:freq
      }
    });
  }

  setSequence(seq, instruments = [], muteDrums = false) {
    let notes = seq.notes;
   	let toAdd = [];
    let mul = 1;
    if(seq.quantizationInfo)
    {
		  mul = this.TICKS_PER_BEAT / seq.quantizationInfo.stepsPerQuarter;
    }
    let newNotes = [];
    for(let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if(Array.isArray(n.pitch)) {
        n.pitch.forEach((p)=> {
          let newNote = JSON.parse(JSON.stringify(n));
          newNote.pitch = p;
          newNotes.push(newNote)
        });
        notes.splice(i, 1);
        --i;
      }
    }
    notes = notes.concat(newNotes)
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
        if(start === undefined
           && n.quantizedStartStep !== undefined)
        {
          start = n.quantizedStartStep;
        }
        let end = n.end;
        if(end === undefined)
        {
          if(n.quantizedEndStep !== undefined)
          {
            end = n.quantizedEndStep
          }
          else
          {
            end = start + 1;
          }
        }
        let v = 127;
        if(Object.keys(n).includes("velocity"))
        {
          v = n.velocity;
        }
      	toAdd.push({cmd:"noteon", f:this.getFreq(n.pitch), t:start * mul, v:v});
      	toAdd.push({cmd:"noteoff", f:this.getFreq(n.pitch), t:end * mul});
      }
    });
    toAdd.sort((a, b)=> {
      return a.t - b.t;
    });
    console.log(toAdd)
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

  onChange(val, key, send = true) {
    const scaled = (this.parameters[key].scale * val) + this.parameters[key].translate;
    this.setParam(key, scaled, send);
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
    const keys = Object.keys(this.parameters);
    keys.forEach((p, i)=> {
      const send = i <= keys.length - 1
      this.setParam(p, this.parameters[p].val, send)
    })
  }

  setParam(name, val, send = true) {
    if(val < 0) val = 0.00;
    if(this.parameters[name])
    {
      this.parameters[name].val = val
      const offset = this.instrument == "synth" ? 0 : this.NUM_SYNTH_PARAMS * this.NUM_SYNTHS;
      const paramIndex = Object.keys(this.parameters).indexOf(name);
      const index = offset + (this.index * this.NUM_SYNTH_PARAMS) + paramIndex;
      this.onParamUpdate(index, val, send)
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
      const keys = Object.keys(vals);
      keys.forEach((key, i)=>{
        const val = parseFloat(vals[key]);
        if(this.outputGUI[key])
        {
          const send = i >= keys.length - 1;
          this.outputGUI[key].value = val;
          this.onChange(val, key, send);
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

  constructor(node, index, instrument, audioContext, onParamUpdate) {
    super(node, index, instrument, audioContext, onParamUpdate);

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

    this.presets = [
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

  preset(index) {
    if(index > 0 && index < this.presets.length)
    {
      const preset = this.presets[index];
      Object.keys(preset.vals).forEach((key, i)=>{
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

  addGUI(element) {
    const rowLength = 4;
    const table = document.createElement("TABLE");
    table.classList.add("maxi-table")
    let row = table.insertRow();
    element.appendChild(table);

    const title = document.createElement('p');
    title.innerHTML = "MaxiSynth";
    title.classList.add("title-label")

    const randomButton = document.createElement("BUTTON");
    randomButton.classList.add("random-btn")
    randomButton.classList.add("maxi-btn")
    randomButton.innerHTML = "Randomise"
    randomButton.style.width = "70px";

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
    oscillatorSelector.classList.add("maxi-selector")

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


    const presetSelector = document.createElement("select");
    this.presets.forEach((preset)=> {
      const option = document.createElement("option");
      option.value = 0;
      option.text = preset.title;
      presetSelector.appendChild(option);
    });
    presetSelector.classList.add("maxi-selector")
    presetSelector.style["margin-left"] = "35px";
    presetSelector.onchange = ()=> {
      const index = parseInt(presetSelector.selectedIndex);
      this.preset(index);
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
    //cell.appendChild(printParamsButton);

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
        label.classList.add("param-label")
        label.innerHTML = p;
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

   constructor(node, index, instrument, audioContext, onParamUpdate) {
    super(node, index, instrument, audioContext, onParamUpdate);
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
    const table = document.createElement("TABLE");
    table.classList.add("maxi-table")
    element.appendChild(table);
    let row;
    const rowLength = 4;
    row = table.insertRow();
    let cell = row.insertCell();
    const title = document.createElement('p');
    title.innerHTML = "MaxiSampler";
    title.classList.add("title-label");
    cell.appendChild(title);
    cell = row.insertCell();
    const changeGroupButton = document.createElement("BUTTON");
    changeGroupButton.innerHTML = "View Samples 5-8";
    changeGroupButton.classList.add("maxi-btn")
    changeGroupButton.id = "changeGroupButton";
    changeGroupButton.onclick = ()=>{
      this.toggleGroup();
    }
    cell.appendChild(changeGroupButton);


    for(let i = 0; i < Object.keys(this.parameters).length; i++)
    {
      let p = Object.keys(this.parameters)[i];
      if(i % rowLength === 0)
      {
        row = table.insertRow();
      }
      cell = row.insertCell();
      cell.classList.add("cell_" + p);
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
      label.classList.add("param-label");
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
