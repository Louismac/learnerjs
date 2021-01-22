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


/**
   Class for the main MaxiInstruments library
 */
class MaxiInstruments {

  constructor() {
    /** Holds the sampler objects, in order of added
        @var {MaxiSampler[]} */
    this.samplers = [];
    this.globalParameters = new Float32Array(512);
    this.loops = new Float32Array(16);
    /** Holds the synth objects, in order of added
        @var {MaxiSynth[]} */
    this.synths = [];
    this.sendTick = false;
    this.synthProcessorName = 'maxi-synth-processor';
    this.version = "v.0.6";
    this.TICKS_PER_BEAT = 24;
    this.NUM_SYNTHS = 6;
    this.NUM_SAMPLERS = 6;
    this.NUM_SYNTH_PARAMS = Object.keys(MaxiSynth.parameters()).length;
    this.NUM_SAMPLER_PARAMS = Object.keys(MaxiSampler.parameters()).length;
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

  /**
  Return how many mapped parameters there are across all instruments
  @returns {number} total number mapped parameters there are across all instruments
  @example
  * //Make a regression model that has the correct number of outputs
  * learner.addRegression(instruments.getNumMappedOutputs(), false)
  */
  getNumMappedOutputs() {
    return this.getInstruments().reduce((c, s) => c + s.mapped.length, 0);
  }

  /**
  Create a MaxiSampler instance
  @returns {Object} the MaxiSampler object
   */
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
            this.enqueue();
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

  /**
  Create a MaxiSynth instance
  @returns {Object} the MaxiSynth object
   */
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
            //console.log("enqueuing", this.globalParameters)
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
 /**
   Set the Loop of all instruments
   @param {number} loopLength The length of the loop in ticks
   @param {number} [ticks=24] ticksPerBeat for the loop
   @example
   * //Set loop for 4 beats at default 24 ticks
   * instruments.setLoop(96)
   * @example
   * //Set loop for 4 beats
   * instruments.setLoop(4, 1)
  */
  setLoop(end, ticks = 24, start = 0) {
    const loopAt = (end * (this.TICKS_PER_BEAT / ticks));
    const loopStart = (start * (this.TICKS_PER_BEAT / ticks));
    console.log("loop", loopStart, loopAt);
    this.node.port.postMessage({loopAllStart:loopStart, loopAllEnd: loopAt});
  }

  /**
  Set Tempo
  @param {number} tempo in BPM
   */
  setTempo(tempo) {
    this.node.port.postMessage({tempo:tempo});
  }

  /**
  Set Gain
  @param {number} [val = 1] GainNode attached to AudioWorkletNode
   */
  setGain(val = 1) {
    if(this.gainNode !== undefined && this.audioContext != undefined)
    {
      this.gainNode.gain.setValueAtTime(val, this.audioContext.currentTime);
    }
  }

  /**
  Get the current values of the mapped instrument parameters
  @return {number[]} current values of the mapped instrument parameters
  @examples
  * learner.newExample(instruments.getMappedOutputs(), learner.y)
   */
  getMappedOutputs() {
	  let y = [];
    this.getInstruments().forEach((s)=> {
    	y = y.concat(s.getMappedParameters());
    });
    return y;
  }

  createNode() {
    return new Promise((resolve, reject)=> {
      this.audioContext.destination.channelInterpretation='discrete';
      this.audioContext.destination.channelCountMode='explicit';
      this.audioContext.destination.channelCount=this.audioContext.destination.maxChannelCount
      /** Holds the main AudioWorkletNode
          @var {Object} */
     this.node = new AudioWorkletNode(
        this.audioContext,
        this.synthProcessorName,
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [this.audioContext.destination.maxChannelCount]
        }
      );
      window.node = this.node;

      let sab3 = RingBuffer.getStorageForCapacity(512, Float32Array);
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
      this.gainNode = new GainNode(this.audioContext);
      this.node.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
      this.node.channelInterpretation='discrete';
      this.node.channelCountMode='explicit';
      this.node.channelCount=this.audioContext.destination.maxChannelCount;
      this.node.port.postMessage({
        paramKeys:{
          instrument:"synth",
          index:0,
          val:Object.keys(MaxiSynth.parameters())
        }
      });
      this.node.port.postMessage({
        paramKeys:{
          instrument:"sampler",
          index:0,
          val:Object.keys(MaxiSampler.parameters())
        }
      });
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

/**
Load the modules. Must be done before any synths or samplers are added
@return {Promise}
@example
*instruments.loadModules().then(()=> {
*  //Music making code goes here
*})
 */
  loadModules() {
    return new Promise((resolve, reject)=> {
      if (this.audioContext === undefined) {
        try {
           /** Holds the main AudioContext
                @var {Object} */
          this.audioContext = new AudioContext({
            latencyHint:'playback',
            sample: 44100
          });
         this.loadModule(this.getSynthName()).then(()=> {
            this.createNode().then(resolve);
          }).catch((err)=> {
            if(this.guiElement !== undefined)
            {
              const label = document.createElement("p");
              label.innerHTML = "Audio worklets not supported, try Chrome!";
              this.guiElement.appendChild(label)
            }
            reject(err);
          });
        } catch (err) {
          console.log("here")
          reject(err);
        }
      }
      else
      {
        reject("audio context already exists");
      }
    });
  }
 /**
 Updates the mapped parameters of the instruments with new values (usually from a regression model)
 @param {number[]} data The new values to the mapped parameters
  *@example
  *learner.onOutput = (output)=> {
  *  instruments.updateMappedOutputs(output)
  *}
  */
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

  /**
  Toggle Play / pause
   */
  playPause() {
    this.node.port.postMessage({togglePlaying:true});
  }
  /**
  Reset all sequencers to 0.
   */
  rewind() {
    this.node.port.postMessage({rewind:true});
  }

/**
 * This callback type is called `onTickCallback` and is displayed as a global symbol.
 *
 * @callback onTickCallback
 * @param {number[]} playHeads
 */

  /**
    Set a callback function to be called on every tick
    * @param {onTickCallback} callback
    * @example
    *instruments.setOnTick((playHeads)=> {
    *  //The current playhead of the first instrument added
    *  if(playHeads[0] == 1) {
    *    sound.trigger()
    *  }
    *  //The current playhead of the third instrument added
    *  if(playHeads[2] % 2 == 0) {
    *    sound2.trigger()
    *  }
    *})
   */
  setOnTick(onTick) {
    this.onTick = onTick;
    if(!this.sendTick) {
      this.sendTick = true;
      this.node.port.postMessage({sendTick:true});
    }
  }
}

class MX {

  //https://github.com/coolaj86/knuth-shuffle
  static shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;
    while (0 !== currentIndex) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }
    return array;
  }

  static unabbreviate(n) {
    if(n.p !== undefined) {
      n.pitch = n.p;
      n.p = undefined;
    }
    if(n.s !== undefined) {
      n.start = n.s;
      n.s = undefined;
    }
    if(n.e !== undefined) {
      n.end = n.e;
      n.e = undefined;
    }
    if(n.l !== undefined) {
      n.length = n.l;
      n.l = undefined;
    }
    if(n.v !== undefined) {
      n.velocity = n.v;
      n.v = undefined;
    }
    if(n.f !== undefined) {
      n.freq = n.f;
      n.f = undefined;
    }
  }

  static shufflePos(seq) {
    let indexes = new Array(seq.length).fill(1).map((x,i)=>i);
    MX.shuffle(indexes);
    let newSeq = [];
    seq.forEach((oldN, i)=> {
      MX.unabbreviate(oldN);
      let newN = JSON.parse(JSON.stringify(oldN));
      let switchN = seq[indexes[i]];
      MX.unabbreviate(switchN);
      newN.start = undefined;
      if(switchN.start !== undefined) {
        newN.start = switchN.start;
        newN.end = switchN.end;
        newN.length = switchN.length;
      }
      newSeq.push(JSON.parse(JSON.stringify(newN)));
    })
    return newSeq;
  }

  static shuffleNotes(seq) {
    let indexes = new Array(seq.length).fill(1).map((x,i)=>i);
    MX.shuffle(indexes);
    let newSeq = [];
    seq.forEach((oldN, i)=> {
      MX.unabbreviate(oldN);
      let newN = JSON.parse(JSON.stringify(oldN));
      let switchN = seq[indexes[i]];
      MX.unabbreviate(switchN);
      newN.pitch = newN.freq = undefined;
      if(switchN.pitch !== undefined) {
        newN.pitch = switchN.pitch;
      }
      else if(switchN.freq !== undefined) {
        newN.freq = switchN.freq;
      }
      newSeq.push(JSON.parse(JSON.stringify(newN)));
    })
    return newSeq;
  }
}

/**
 Class representing a MaxiInstrument, the parent of both MaxiSynth and MaxiSampler
 */
class MaxiInstrument {

  constructor(node, index, instrument, audioContext, onParamUpdate) {
    this.node = node;
    this.index = index;
    this.instrument = instrument;
    /** Holds the audio context
        @var {Object} */
    this.audioContext = audioContext;
    this.onParamUpdate = onParamUpdate;
    /** Which instrument parameters to map
        @var {string[]}
        @example
        synth.mapped = ["frequency", "attack"]
        @example
        sampler.mapped = ["gain_0", "rate_1"]
     */
    this.mapped = [];
    this.prevGains = {};
    this.outputGUI = [];
    this.TICKS_PER_BEAT = 24;
    this.NUM_SYNTHS = 6;
    this.NUM_SAMPLERS = 6;
    this.NUM_SYNTH_PARAMS = Object.keys(MaxiSynth.parameters()).length;
    this.NUM_SAMPLER_PARAMS = Object.keys(MaxiSampler.parameters()).length;
    // this.NUM_SYNTH_PARAMS = 17;
    // this.NUM_SAMPLER_PARAMS = 24;
    this.GLOBAL_OFFSET =
      (this.NUM_SYNTHS * this.NUM_SYNTH_PARAMS) +
      (this.NUM_SAMPLERS * this.NUM_SAMPLER_PARAMS);
    this.docId = "local";
    if(window.frameElement)
    {
      this.docId = window.frameElement.name
    }
  }
  /**
    Set the Loop of this instrument
    @param {number} loopLength The length of the loop
    @param {number} [ticks=24] ticksPerBeat for the loop
    @example
    * //Set loop for 4 beats at default 24 ticks
    * synth.setLoop(96)
    * @example
    * //Set loop for 4 beats
    * sampler.setLoop(4, 1)
   */
    setLoop(end, ticks = 24, start = 0) {
      const loopEnd = (end * (this.TICKS_PER_BEAT / ticks));
      const loopStart = (start * (this.TICKS_PER_BEAT / ticks));
      this.node.port.postMessage({
        loop:{
          instrument:this.instrument,
          index:this.index,
          val:{start:loopStart,end:loopEnd}
        }
      });
    }
/**
Return any muted samples / synths back to original gain
@param {number[]} [tracks=all tracks] If synth this argument is largely pointless.
 * If a sampler you can specify to unmute particular samples
 @example
 synth.unmute()
 @example
 * //Unmute all samples
 * sampler.unmute()
 @example
 * //Unmute first and fourth samples
 * sampler.unmute([0, 3])
 */
  unmute(tracks) {
    if(this.prevGains === undefined) {
      return;
    }
    if(this.instrument === "sampler")
    {
      if(tracks === undefined)
      {
        tracks = new Array(8).fill(1).map((x,i)=>i)
      }
      let params = [];
      tracks.forEach((t)=> {
        if(this.prevGains["gain_"+t] !== undefined) {
          params.push(["gain_"+t, this.prevGains["gain_"+t]])
        }
      });
      this.setParams(params)
      this.prevGains = {};
    }
    else
    {
      if(this.prevGains["gain"] !== undefined) {
        this.setParam("gain", this.prevGains["gain"]);
      }
      this.prevGains = {};
    }
    document.getElementById("muteButton" + this.index).innerHTML = "Mute"
  }
  /**
  Mute given synth or samples
  @param {number[]} [tracks=all tracks] If synth this argument is largely pointless.
   * If a sampler you can specify to mute particular samples
   @example
   synth.mute()
   @example
   * //Mute all samples
   * sampler.mute()
   @example
   * //Mute first and fourth samples
   * sampler.mute([0, 3])
   */
  mute(tracks) {
    if(this.instrument === "sampler")
    {
      if(tracks === undefined)
      {
        tracks = new Array(8).fill(1).map((x,i)=>i)
      }
      var params = tracks.map(x => [ "gain_" + x, 0]);
      params.forEach((row)=> {
        if(this.prevGains[row[0]] === undefined)
        {
          this.prevGains[row[0]] = this.parameters[row[0]].val;
        }
      })
      this.setParams(params)
    }
    else
    {
      if(this.prevGains["gain"] === undefined) {
        this.prevGains["gain"] = this.parameters.gain.val;
      }
      this.setParam("gain", 0);
    }
    document.getElementById("muteButton" + this.index).innerHTML = "Unmute"
  }

/**
Trigger note on
@param {number} [pitch = 60] Pitch of MIDI note
@param {number} [vel = 127] Velocity (0-127)
 */
  noteon(pitch = 60, vel = 127) {
    //console.log("instrument note on", this.instrument, this.index, freq, vel)
    this.node.port.postMessage({
      noteon:{
        instrument:this.instrument,
        index:this.index,
        val:{f:this.getFreq(pitch), v:vel}
      }
    });
  }
  /**
  Trigger note ff
  @param {number} [pitch = 60] Pitch of MIDI note
   */
  noteoff(pitch = 60) {
    this.node.port.postMessage({
      noteoff:{
        instrument:this.instrument,
        index:this.index,
        val:this.getFreq(pitch)
      }
    });
  }

/**
Set Sequence
 * @param {Object[]} sequence - The sequence to be assigned.
 * @param {(number|number[])} sequence[].s - the start position in ticks of an event. If array, multiple events at same pitch and length played
 * @param {(number|number[])} sequence[].start - the start position in ticks of an event. If array, multiple events at same pitch and length played
 * @param {number} sequence[].l - The length in ticks of an event. Does not apply to sampler.
 * @param {number} sequence[].length - The length in ticks of an event. Does not apply to sampler.
 * @param {number} sequence[].e - The end in ticks of an event. Does not apply to sampler.
 * @param {number} sequence[].end - The end in ticks of an event. Does not apply to sampler.
 * @param {(number|number[])} sequence[].p - the MIDI note of an event, if array chord played. If sampler, denotes sample to trigger.
 * @param {(number|number[])} sequence[].pitch - the MIDI note of an event, if array chord played. If sampler, denotes sample to trigger.
 * @param {(number|number[])} sequence[].f - the frequency in Hz of an event, if array chord played
 * @param {(number|number[])} sequence[].frequency - the the frequency in Hz of an event, if array chord played
 * @param {number} sequence[].v - The velocity of an event (0 - 127). Default 127
 * @param {number} sequence[].velocity - The velocity of an event (0 - 127). Default 127
 * @param {number} [ticksPerBeat = 24] The ticks per beat of this sequence (max 24)
 * @param {number} [transpose = 0] Transpose all note values by this
 * @example
 * //Synth MIDI notes on beats 1 and 3 (24 ticks per beat default)
 * synth.setSequence([
 *   {p:60, s:0, v:60, l:24},{p:60, s:48, v:60, l:24}
 * ])
 * @example
 * //Synth MIDI notes on beats 1 and 3 (4 ticks per beat)
 * synth.setSequence([
 *   {p:60, s:0, v:60, l:4},{p:60, s:8, v:60, l:4}
 * ], 4)
 * @example
 * //Synth frequencies, end provided
 * synth.setSequence([
 *   {f:440, s:0, e:12},{f:220, s:24, e:36}
 * ])
 * @example
 * //Synth notes in 16ths transposed octave down
 * synth.setSequence([
 *   {p:60, s:0, l:2},{p:63, s:12, l:4}
 * ], 4, -12)
 * @example
 * sampler.setSequence([
 *   {p:0, s:0, v:60}, {p:1, s:24},
 * ])
 * @example
 * //Play samples 0,1,2 at the start of the seqeunce
 * sampler.setSequence([
 *   {p:[0, 1, 2], s:0, v:60}
 * ])
 * @example
 * //Play sample 0 at 0, 24, 36 and 48 ticks
 * sampler.setSequence([
 *   {p:0, s:[0,24,36,48]}
 * ])
 * @example
 * //Play sample 0 on 1 and 3 (1 tick per beat)
 * sampler.setSequence([
 *   {p:0, s:[0,2]}
 * ], 1)
 * @example
 * //Play samples on 16ths (4 ticks per beat), alternating velocities
 * sampler.setSequence([
 *   {p:0, s:[0,2,4,6], v:127},
 *   {p:0, s:[1,2,5,7], v:60},
 * ], 4)
*/
  setSequence(seq, tickPerBeat = 24, transpose = 0, instruments = [], muteDrums = false) {
   	let toAdd = [];
    let mul = this.TICKS_PER_BEAT / tickPerBeat;
    let notes = seq;
    //backwards compat/magenta
    if(seq.notes !== undefined) {
      notes = seq.notes;
    }
    if(seq.quantizationInfo)
    {
		  mul = this.TICKS_PER_BEAT / seq.quantizationInfo.stepsPerQuarter;
    }
    let newNotes = [];
    for(let i = 0; i < notes.length; i++) {
      const n = notes[i];
      MX.unabbreviate(n);
      //fold out notes
      if(Array.isArray(n.pitch)) {
        n.pitch.forEach((p)=> {
          let newNote = JSON.parse(JSON.stringify(n));
          newNote.pitch = p;
          newNotes.push(newNote)
        });
        notes.splice(i, 1);
        --i;
      }
      if(Array.isArray(n.freq)) {
        n.freq.forEach((f)=> {
          let newNote = JSON.parse(JSON.stringify(n));
          newNote.freq = f;
          newNotes.push(newNote)
        });
        notes.splice(i, 1);
        --i;
      }
    }
    notes = notes.concat(newNotes)
    newNotes = [];
    //Fold out starts
    for(let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if(Array.isArray(n.start)) {
        n.start.forEach((s)=> {
          let newNote = JSON.parse(JSON.stringify(n));
          newNote.start = s;
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
          else if(n.length !== undefined)
          {
            end = start + n.length;
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
        var f = n.freq;
        if(f === undefined && n.pitch !== undefined)
        {
          f = this.getFreq(n.pitch + transpose)
        }
      	toAdd.push({cmd:"noteon", f:f, t:start * mul, v:v});
      	toAdd.push({cmd:"noteoff", f:f, t:end * mul});
      }
    });
    toAdd.sort((a, b)=> {
      return a.t - b.t;
    });
    //console.log(toAdd)
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
  }

  onMLChange(val, index) {
    this.outputGUI[this.mapped[index]].value = val;
    this.onChange(val, this.mapped[index]);
  }

  onChange(val, key, send = true) {
    const scaled = (this.parameters[key].scale * val) + this.parameters[key].translate;
    this.setParam(key, scaled, send);
    if(send)
    {
      this.saveParamValues();
    }
  }
/**
Randomise all mapped parameters
 */
  randomise() {
    this.mapped.forEach((key)=> {
      const val = Math.random();
      this.outputGUI[key].value = val;
      this.onChange(val, key);
    })
  }
  /**
  Get values of mapped parameters
  @return {string[]} params -
   */
  getMappedParameters() {
    let vals = [];
    this.mapped.forEach((key)=> {
      vals.push(this.outputGUI[key].value);
    })
    return vals;
  }

  sendDefaultParam() {
    setTimeout(()=>{
      console.log("sendDefaultParam")
      const keys = Object.keys(this.parameters);
      keys.forEach((p, i)=> {
        const send = i == keys.length - 1
        this.setParam(p, this.parameters[p].val, send)
      })
    }, 100)

  }

/**
  Set parameter values for instrument
  @param {Array[]} pairs - Array of arrays containing [key, val] pairs
  *@example
  *synth.setParams([
  *  ["gain", 0],
  *  ["attack", 1000],
  *  ["release", 40]
  *])
 */
  setParams(vals) {
    vals.forEach((pair, i)=>{
      this.setParam(pair[0], pair[1], i == vals.length - 1);
    })
  }

  /**
    Set parameter value for instrument
    @param {string} key - name of parameter
    @param {number} val - value of parameter
    @param {boolean} [send=true] - Whether to send to audio worker or not (good for bulking changes)
    @example
    * //Wait until end to send
    * sampler.setParam("gain_0", 0.5, false);
    * sampler.setParam("gain_2", 0.5, false)
    * sampler.setParam("gain_3", 0.5)
   */
  setParam(name, val, send = true) {
    if(val < 0) val = 0.00;
    const scaled = (val - this.parameters[name].translate) / this.parameters[name].scale;

    if(this.outputGUI[name] !== undefined)
    {
      this.outputGUI[name].value = scaled;
    }
    if(this.parameters[name] !== undefined)
    {
      this.parameters[name].val = val
      let offset = this.instrument == "synth" ? 0 : this.NUM_SYNTH_PARAMS * this.NUM_SYNTHS;
      offset += this.instrument == "synth" ? (this.index * this.NUM_SYNTH_PARAMS) :  (this.index * this.NUM_SAMPLER_PARAMS)
      const paramIndex = Object.keys(this.parameters).indexOf(name);
      const index = offset + paramIndex;
      //console.log(name, val, send, index, this.index, offset, this.index * this.NUM_SAMPLER_PARAMS)
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
    const savedVals = JSON.parse(window.localStorage.getItem(key))
    if(savedVals)
    {
      //console.log(savedVals)
      const keys = Object.keys(this.parameters);
      keys.forEach((key, i)=>{
        let val = parseFloat(savedVals[key]);
        if(this.outputGUI[key] && val)
        {
          this.outputGUI[key].value = val;
        }
        else
        {
          val = this.parameters[key].val;
        }
        const send = i >= keys.length - 1;
        this.onChange(val, key, send);
      });
    }
    else
    {
      this.sendDefaultParam();
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

/**
Class repesenting synth object. Subclass of MaxiInstrument
@extends MaxiInstrument
*/

class MaxiSynth extends MaxiInstrument {

  static parameters() {
    return {
      "gain":{scale:1, translate:0, val:1},
      "pan":{scale:1, translate:0, val:0.5},
      "attack":{scale:1500, translate:0, val:1000},
      "decay":{scale:1500, translate:0, val:1000},
      "sustain":{scale:1, translate:0, val:1},
      "release":{scale:1500, translate:0, val:1000},
      "lfoFrequency":{scale:10, translate:0, val:0},
      "lfoPitchMod":{scale:20, translate:0, val:0},
      "lfoFilterMod":{scale:1000, translate:0, val:0},
      "lfoAmpMod":{scale:1, translate:0, val:0},
      "adsrPitchMod":{scale:100, translate:0, val:0},
      "cutoff":{scale:3000, translate:40, val:3000},
      "reverbMix":{scale:1, translate:0, val:0},
      "roomSize":{scale:1.5, translate:0, val:0},
      "delay":{scale:44100, translate:0, val:0},
      "delayMix":{scale:1.0, translate:0, val:0},
      "frequency":{scale:1000, translate:0, val:440},
      "frequency2":{scale:1000, translate:0, val:440},
      "poly":{scale:1, translate:0, val:1},
      "oscFn":{scale:1, translate:0, val:0},
      "lfoOscFn":{scale:1, translate:0, val:0},
    }
  }

  constructor(node, index, instrument, audioContext, onParamUpdate) {
    super(node, index, instrument, audioContext, onParamUpdate);
    this.parameters = MaxiSynth.parameters();
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
    //this.sendDefaultParam();
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

/**
  Pick a preset
  @param {number} index - index of preset
  */
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
    randomButton.style.width = "80px";

    randomButton.onclick = ()=>{
      this.randomise();
    }

    const oscillatorSelector = document.createElement("select");
    ["sin", "tri", "saw", "square", "noise"].forEach((osc, i)=> {
      const option = document.createElement("option");
      option.value = i;
      option.text = osc;
      oscillatorSelector.appendChild(option);
    });
    oscillatorSelector.classList.add("maxi-selector")

    oscillatorSelector.onchange = ()=> {
      const index = parseInt(oscillatorSelector.selectedIndex);
      this.onGUIChange(index, Object.keys(this.parameters).indexOf("oscFn"));
    }
    this.outputGUI.oscFn = oscillatorSelector;

    const lfoSelector = document.createElement("select");
    ["sin", "tri", "saw", "square", "noise"].forEach((osc, i)=> {
      const option = document.createElement("option");
      option.value = i;
      option.text = osc;
      lfoSelector.appendChild(option);
    });
    lfoSelector.classList.add("maxi-selector")

    lfoSelector.onchange = ()=> {
      const index = parseInt(lfoSelector.selectedIndex);
      this.onGUIChange(index, Object.keys(this.parameters).indexOf("lfoOscFn"));
    }
    this.outputGUI.lfoOscFn = lfoSelector;

    const printParamsButton = document.createElement("BUTTON");
    printParamsButton.innerHTML = "Print"
    printParamsButton.classList.add("maxi-btn")
    printParamsButton.style.margin = "auto";
    printParamsButton.style.display = "block";
    printParamsButton.style.width = "70px";
    printParamsButton.onclick = ()=>{
      let str = "synth.setParams([\n";
      const vals = this.getParamValues();
      Object.keys(vals).forEach((key)=>{
        const val = vals[key];
        const scaled = (this.parameters[key].scale * val) + this.parameters[key].translate;
		     str += "\t[\"" + key + "\"," + scaled + "],\n"
      });
      str += "]"
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
    //cell.appendChild(title);

    var label = document.createElement("p");
    label.innerHTML = "osc:"
    label.classList.add("selector-label")
    cell.appendChild(label);
    cell.appendChild(oscillatorSelector);
    label = document.createElement("p");
    label.innerHTML = "lfo:"
    label.classList.add("selector-label")
    cell.appendChild(label);
    cell.appendChild(lfoSelector);
    cell = row.insertCell();
    //cell.colSpan = "2"
    cell.appendChild(presetSelector);
    cell = row.insertCell();
    cell.appendChild(randomButton);
    cell = row.insertCell();
    cell.appendChild(printParamsButton);
    var ignore = ["poly", "oscFn", "lfoOscFn"];
    var cellCtr = 0;
    for(let i = 0; i < Object.keys(this.parameters).length; i++)
    {
      let p = Object.keys(this.parameters)[i];
      if(!ignore.includes(p))
      {
        if(cellCtr % rowLength === 0)
        {
          row = table.insertRow();
        }
        cell = row.insertCell();
        cellCtr++;
        cell.id = this.index + "cell_" + p;
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

/**
If true, synth uses two additional frequency parameters to contorl pitch,
as opposed to taking pitch from the sequence.
@param {boolean} useSliders
 */

  useFreqSliders(useSliders) {
    this.setParam("poly", useSliders ? 0 : 1)
    //const vis = useSliders ? "visible" : "hidden"
    const vis = useSliders ? "table-cell" : "none"
    let elem = document.getElementById(this.index + "cell_frequency");
    elem.style.display = vis;
    elem = document.getElementById(this.index + "cell_frequency2");
    elem.style.display = vis;
  }
}

/**
Class repesenting sampler object. Subclass of MaxiInstrument
@extends MaxiInstrument
*/

class MaxiSampler extends MaxiInstrument {
   static parameters() {
     const core = {
       "gain":{scale:1, translate:0, min:0, max:1, val:0.5},
       "rate":{scale:1, translate:0, min:0, max:4, val:1},
       "pan":{scale:1, translate:0, min:0, max:1, val:0.5},
       "end":{scale:1, translate:0, min:0, max:1, val:1},
       "start":{scale:1, translate:0, min:0, max:1, val:0.0}
     };
     let voices = 8;
     let parameters = {};
     const keys = Object.keys(core);
     for(let j = 0; j < keys.length; j++) {
       for(let i = 0; i < voices; i++)
       {
         const key = keys[j]+"_"+i;
         parameters[key] = JSON.parse(JSON.stringify(core[keys[j]]))
       }
     }
     return parameters;
   }

   constructor(node, index, instrument, audioContext, onParamUpdate) {
    super(node, index, instrument, audioContext, onParamUpdate);
    this.voices = 8;
    this.parameters = MaxiSampler.parameters();
    this.keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    //this.sendDefaultParam();
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
    const changeGroupButton = document.getElementById("changeGroupButton_" + this.index);
    const slots = this.group == 0 ? "5-8" : "1-4";
    changeGroupButton.innerHTML = "View Samples " + slots;
    const indexes = [0, 1, 2, 3].map(x => x + ((this.voices / 2) * this.group))
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
    changeGroupButton.id = "changeGroupButton_" + this.index;
    changeGroupButton.onclick = ()=>{
      this.toggleGroup();
    }
    cell.appendChild(changeGroupButton);

    cell = row.insertCell();
    const muteButton = document.createElement("BUTTON");
    muteButton.innerHTML = "Mute";
    muteButton.classList.add("maxi-btn")
    muteButton.id = "muteButton" + this.index;
    muteButton.onclick = ()=>{
      if(Object.keys(this.prevGains).length === 0) {
        this.mute()
      }
      else
      {
        this.unmute()
      }
    }
    cell.appendChild(muteButton);

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

  /**
    Load Sample into slot
    @param {string} url - url of audio file. If MIMIC asset, just use filename.
    @param {number} index - slot in sampler to load to
    @example
    * sampler.loadSample("myBigKick.wav", 0);
    */
  loadSample(url, index) {
    if (this.audioContext !== undefined) {
      this.loadSampleToArray(index, url)
    } else throw "Audio Context is not initialised!";
  }

  sendAudioArray(sampleWorkletObjectName, float32Array) {
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
