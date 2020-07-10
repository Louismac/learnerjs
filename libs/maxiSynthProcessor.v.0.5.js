import Maximilian from "http://localhost:4200/libs/maximilian.wasmmodule.js"

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

class MaxiSamplerProcessor {
   constructor() {
    //Max polyphony
    const voices = 8;
    this.sampleRate = 44100;
    this.DAC = [0];
    this.dcoOut = 0;
    //this.dcfOut = 0;
    this.samples = [];
    this.adsr = [];
    this.velocities = []
    this.releaseTimes = [];
    this.playHead = 0;
    for(let i = 0; i < voices; i++)
    {
      this.samples.push(new Maximilian.maxiSample());
      this.adsr.push(new Maximilian.maxiEnv());
      this.velocities.push(1);
      this.releaseTimes.push(-1);
    }
    //this.dcf = new Maximilian.maxiFilter();
    this.seqPtr = 0;
    this.samplePtr = 0;
    this.sequence = [];
    this.parameters = {};

  }

  doTrig() {
    let trig = false;
    if(this.seqPtr < this.sequence.length)
    {
      trig = this.sequence[this.seqPtr].t <= this.playHead;
    }
    return trig;
  }

  externalNoteOn(val)
  {
    const freq = val.f == undefined ? 440 : val.f
    const vel = val.v === undefined ? 127 : val.v
  	this.handleCmd({cmd:"noteon", f:freq, v:vel});
  }

  //Unused stub
  externalNoteOff(freq) {}

  setSequence(seq) {
    this.sequence = seq;
  }

  //Execute noteon/noteoffs (whether sequenced or manually triggered)
  handleCmd(nextCmd) {
    if(this.paramsLoaded())
    {
      const f = nextCmd.f;
      const v = nextCmd.v !== undefined ? nextCmd.v : 127;
      if(nextCmd.cmd === "noteon")
      {
        let start = this.parameters['start_'+f].val;
      //  this.releaseTimes[f] = this.samplePtr + len;
        this.adsr[f].setSustain(1);
        this.adsr[f].setDecay(10);
        this.adsr[f].setAttack(5);
        this.adsr[f].setRelease(5);
        this.adsr[f].trigger = 1;
        this.samples[f].setPosition(start);
        this.velocities[f] = v / 127;
      }
    }
  }

  handleLoop() {
    this.seqPtr = this.samplePtr = this.playHead = 0;
  }

  tick() {
    if(this.playHead >= this.loopTicks)
    {
      this.handleLoop();
    }
    //console.log(this.playHead, this.sequence)
    while(this.doTrig())
    {
      const nextCmd = this.sequence[this.seqPtr]
      this.handleCmd(nextCmd);
      this.seqPtr++;
    }
    this.playHead++;
  }

  //CURRENTLY UNUSED STUBS
  onSample() {
    this.samplePtr++;
    // this.releaseTimes.forEach((r, i)=> {
    //   if(this.samplePtr > r && r > 0) {
    //     this.adsr[i].trigger = 0;
    //     this.releaseTimes[i] = -1;
    //   }
    // })
  }
  onStop() {}

  paramsLoaded() {
    return Object.keys(this.parameters).length > 0;
  }

  signal() {
    this.dcoOut = [0, 0];
    if(this.paramsLoaded())
    {
      for(let i = 0; i < this.samples.length; i++)
      {
        const s = this.samples[i];
        if(s.isReady())
        {
          let end = this.parameters['end_'+i].val;
          if(end == 0)
          {
            end = 1.0
          }
          let start = this.parameters['start_'+i].val;
          let rate = this.parameters['rate_'+i].val;
          if(rate < 0.01) {
            rate = 0.02;
          }
          if(end <= start) {
            end = start + 1;
          }
          //const envOut = this.adsr[i].adsr(1, this.adsr[i].trigger);
          let gain = this.parameters['gain_' + i].val;
          let p = this.parameters['pan_' + i].val;
          let r = p;
          let l = 1 - p;
          let sig = s.playUntil(rate, end) * this.velocities[i] * gain;
          if(this.samplePtr % 10000 == 0) {

          }
          this.dcoOut[0] += sig * l;
          this.dcoOut[1] += sig * r;
        }
      }
    }
    else {
    }
   	return this.dcoOut;
  }
}

class MaxiSynthProcessor {

  constructor() {
    const voices = 12;
    this.sampleRate = 44100;
    this.DAC = [0];
    this.dcoOut = 0;
    this.dcfOut = 0;
    this.dco = [];
    this.adsr = [];
    this.triggered = [];
    this.released = [];
    this.verb = new Maximilian.maxiFreeVerb()
    for(let i = 0; i < voices; i++)
    {
      this.dco.push(new Maximilian.maxiOsc());
      this.adsr.push(new Maximilian.maxiEnv());
    }
    this.lfo = new Maximilian.maxiOsc();
    this.dcf = new Maximilian.maxiFilter();
    this.dl = new Maximilian.maxiDelayline()
    this.seqPtr = 0;
    this.samplePtr = 0;
    this.sequence = [];
    this.playHead = 0;
    this.parameters = {};
  }

    //Find the oscillator to release for freq (for noteoff)
  getTriggeredForFreq(f) {
    let osc;
    for(let i = 0; i < this.triggered.length; i++)
    {
      if(this.triggered[i].f == f)
      {
        osc = this.triggered[i];
        break;
      }
    }
    return osc;
  }

  //Find the oscillator to release for freq (for noteoff)
  getOscToRelease(f) {
    let osc = -1;
    for(let i = 0; i < this.triggered.length; i++)
    {
      if(this.triggered[i].f === f)
      {
        osc = this.triggered[i].o;
        break;
      }
    }
    return osc;
  }

  isFreqTriggered(f) {
    if(this.paramsLoaded())
    {
      if(this.parameters.poly.val == 1)
      {
        return this.triggered.map(a => a.f).includes(f);
      }
      else
      {
        return this.triggered.length > 0;
      }
    }
  }

  //Get next available oscillator
  //Oscillators are not available until they have finished releasing
  getAvailableOsc() {
    let osc = -1;
    let inUse = this.triggered.concat(this.released).map(a => a.o);
    if(inUse.length >= this.dco.length)
    {
      //console.log("all oscs in use, popping release early", inUse.length);
      this.released.shift();
      inUse = this.triggered.concat(this.released).map(a => a.o);
    }
    for(let i = 0; i < this.dco.length; i++)
    {
      if(!inUse.includes(i))
      {
        osc = i;
        break;
      }
    }
    return osc;
  }

  //Dont retrigger if freq already playing
  externalNoteOn(val)
  {
    const freq = val.f === undefined ? 440 : val.f
    const vel = val.v === undefined ? 127 : val.v
    if(!this.isFreqTriggered(freq) && this.paramsLoaded())
    {
      this.handleCmd({cmd:"noteon", f:freq, v:vel});
    }
  }

  //Only release if freq triggered
  externalNoteOff(freq)
  {
    freq = Math.round((freq + Number.EPSILON) * 100) / 100;
    if(this.paramsLoaded())
    {
      if(this.parameters.poly.val == 1)
      {
        const o = this.getOscToRelease(freq);
        if(o >= 0)
        {
          this.handleCmd({cmd:"noteoff", f:freq});
        }
      }
      else
      {
        this.handleCmd({cmd:"noteoff", f:freq});
      }
    }
  }

  handleCmd(nextCmd) {
    if(this.paramsLoaded())
    {
      const f = Math.round((nextCmd.f + Number.EPSILON) * 100) / 100;
      //console.log(nextCmd)
      if(nextCmd.cmd === "noteon")
      {
        if(this.parameters.poly.val == 1)
        {
          this.triggerNoteOn(f, nextCmd.v)
        }
        else
        {
          //console.log("trigger nonpoly", this.parameters.frequency.val, this.parameters.frequency2.val, this.parameters.poly.val)
          this.releaseAll();
          this.triggerNoteOn(this.parameters.frequency.val, nextCmd.v)
          this.triggerNoteOn(this.parameters.frequency2.val, nextCmd.v)
        }
      }
      else if(nextCmd.cmd === "noteoff")
      {
        let release = -1;
        if(this.parameters.poly.val == 1)
        {
          const t = this.getTriggeredForFreq(f);
          if(t !== undefined) {
            this.release(t);
            this.remove(this.triggered, t);
          }
        }
        else
        {
          this.releaseAll();
        }
      }
    }
  }

  release(t) {
    let releaseTime = 1;
    if(this.paramsLoaded())
    {
      releaseTime = this.samplePtr +
        ((this.parameters.release.val / 1000) * this.sampleRate);
    }
    this.adsr[t.o].trigger = 0;
    releaseTime = Math.round(releaseTime)
    this.released.push({f:t.f, o:t.o, off:releaseTime, v:t.v});

  }

  releaseAll() {
    const toRemove = [];
    this.triggered.forEach((t)=>{
      this.release(t)
      toRemove.push(t)
    })
    for(let i = 0; i < toRemove.length; i++)
    {
      this.remove(this.triggered, toRemove[i]);
    }
  }

  triggerNoteOn(freq, vel = 127)
  {
    if(this.paramsLoaded()) {
      const o = this.getAvailableOsc();
      //This will be -1 if no available oscillators
      if(o >= 0)
      {
        //
        this.adsr[o].setAttack(this.parameters.attack.val);
        this.adsr[o].setDecay(this.parameters.decay.val);
        this.adsr[o].setSustain(this.parameters.sustain.val);
        this.adsr[o].setRelease(this.parameters.release.val);
        this.triggered.push({o:o, f:freq, v:vel/127});
        this.adsr[o].trigger = 1;
        //console.log("triggering", freq, o);
      }
    }
  }

  handleLoop() {
	  //Wrap around any release times
    for(let i = 0; i < this.released.length; i++)
    {
      this.released[i].off = this.released[i].off % this.loopSamples;
      //console.log("wrapping round", this.released[i].off, this.released[i].f)
    }
    this.releaseAll();
    //Restart loop
    //console.log(this.samplePtr)
    this.samplePtr = this.seqPtr = this.playHead = 0;
  }

  //If theres a command to trigger in the sequence
  doTrig() {
    let trig = false;
    if(this.seqPtr < this.sequence.length)
    {
      trig = this.sequence[this.seqPtr].t <= this.playHead;
    }
    return trig;
  }

  tick() {
    if(this.playHead >= this.loopTicks)
    {
      this.handleLoop();
    }
    while(this.doTrig())
    {
      const nextCmd = this.sequence[this.seqPtr];
      this.handleCmd(nextCmd);
      this.seqPtr++;
    }
    this.playHead++;
  }

  remove(array, element) {
    const index = array.indexOf(element);
    array.splice(index, 1);
  }

  removeReleased() {
    let toRemove = [];
    this.released.forEach((o, i)=>{
      //Because of the way maxi adsr works, check envelope has actually
      //finished releasing
      if(this.samplePtr >= (o.off + 1) && o.lastVol < 0.00001)
      {
        //console.log("removing", o.off, o.lastVol)
        toRemove.push(o);
      }
    });
    for(let i = 0; i < toRemove.length; i++)
    {
      this.remove(this.released, toRemove[i]);
    }
  }

  onSample() {
    this.samplePtr++;
    this.removeReleased();
  }

  onStop() {
    this.releaseAll();
  }

  setSequence(seq) {
    this.sequence = seq;
    this.releaseAll();
  }

  paramsLoaded() {
    return Object.keys(this.parameters).length > 0
  }

  //Call signal once then mix in process loop
  signal() {
    if(this.paramsLoaded())
    {
      const poly = this.parameters.poly.val == 1;

      const oscFn = this.getOscFn(this.parameters.oscFn.val);
      const lfoOscfn = this.getOscFn(this.parameters.lfoOscFn.val);
      let lfoOut;
      if(lfoOscfn === "noise")
      {
        lfoOut = this.lfo.noise();
      }
      else
      {
        lfoOut = this.lfo[lfoOscfn](this.parameters.lfoFrequency.val);
      }

      this.dcoOut = 0;
      const out = this.triggered.concat(this.released);

      for(let o of out)
      {
        const envOut = this.adsr[o.o].adsr(1, this.adsr[o.o].trigger);
        o.lastVol = envOut;
        const pitchMod = (this.parameters.adsrPitchMod.val * envOut) + (lfoOut * this.parameters.lfoPitchMod.val);

        const normalise = poly ? this.dco.length : 4.0;
        let lfoVal = this.parameters.lfoAmpMod.val;
        const ampOsc =  ((lfoOut + 1 ) / 2)
        let ampMod = (((1-lfoVal) * envOut) + (lfoVal * ampOsc * envOut)) / normalise;
        let f = o.f;
        if(!poly)
        {
          if(o.o % 2 == 0)
          {
            f = this.parameters.frequency.val
          }
          else
          {
            f = this.parameters.frequency2.val
          }
        }

        let osc;
        if(oscFn === "noise")
        {
          osc = this.dco[o.o].noise();
        }
        else
        {
          osc = this.dco[o.o][oscFn](f + pitchMod);
        }

        this.dcoOut += (osc * ampMod * this.parameters.gain.val * o.v);
      }
      const delay = this.parameters.delay.val;
      const delayMix = this.parameters.delayMix.val;
      this.dlOut = (this.dl.dl(this.dcoOut, delay, 0.5) * delayMix * 3.5) + (this.dcoOut * (1 - delayMix))


      let filterEnv = 1;
      const filterOsc = ((lfoOut + 1)/2) * this.parameters.lfoFilterMod.val;
      let cutoff = this.parameters.cutoff.val;
      cutoff = (cutoff * filterEnv) + filterOsc;
      if (cutoff > 3000) {
        cutoff = 3000;
      }
      if (cutoff < 40) {
        cutoff = 40;
      }
      this.dfcOut = this.dcf.lores(this.dlOut, cutoff, 0.5);

      var wet = this.parameters.reverbMix.val;
      if(wet > 0.01) {
        var room = this.parameters.roomSize.val;
        this.reverbOut = (this.verb.play(this.dfcOut, room, 0.2) * wet) + (this.dfcOut * (1 - wet))
      }
      else {
        this.reverbOut = this.dfcOut;
      }

      var r = this.parameters.pan.val;
      var l = 1 - this.parameters.pan.val;

      return [this.reverbOut * l, this.reverbOut * r];
    }
	else {
      //console.log("just 0")
      return 0;
    }
  }

  getOscFn(o)
  {
    let oscFn;
    switch(o) {
      case 0:
        oscFn = "sinewave"; break;
      case 1:
        oscFn = "triangle"; break;
      case 2:
        oscFn = "saw"; break;
      case 3:
        oscFn = "square"; break;
      case 4:
        oscFn = "noise"; break;
      default:
        oscFn = "sinewave"; break;
    }
    return oscFn;
  }
}

class MaxiInstrumentsProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return []
    }

   constructor(options) {
    super();
    //Max polyphony
    this.paramKeys = {};
    this.instruments = {synth:[], sampler:[]};
    this.TICKS_PER_BEAT = 24;
    this.loopSamples = Number.MAX_SAFE_INTEGER;
    this.loopTicks = Number.MAX_SAFE_INTEGER;
    this.myClock = new Maximilian.maxiClock();
    this.myClock.setTempo(80);
    this.myClock.setTicksPerBeat(this.TICKS_PER_BEAT);
    this.isPlaying = true;
    this.loops = new Float32Array(16);
    this.o = { index: 0, value: 0 };
    this.output = new Float32Array(512);
    this.port.onmessage = (event) => {
      if (event.data.type === "recv-param-queue") {
        const b = new RingBuffer(event.data.data, Float32Array);
        this._param_reader = new ArrayReader(b);
      }
      if(event.data.sendTick !== undefined) {
        let sab2 = RingBuffer.getStorageForCapacity(31, Float32Array);
        let rb2 = new RingBuffer(sab2, Float32Array);
        this.loopWriter = new ArrayWriter(rb2);
        this.port.postMessage({
          type: "recv-loop-queue",
          data: sab2
        });
      }
      if(event.data.sequence !== undefined)
      {
        const data = event.data.sequence;
        this.instruments[data.instrument][data.index].setSequence(data.val);
        //console.log(data, this.instruments[data.instrument][data.index].sequence);
      }
      if(event.data.paramKeys !== undefined)
      {
        const data = event.data.paramKeys;
        this.paramKeys[data.instrument] = data.val;
      }
      if(event.data.addSynth !== undefined)
      {
        //console.log("new synth")
        this.instruments["synth"].push(new MaxiSynthProcessor());
      }
      if(event.data.addSampler !== undefined)
      {
        //console.log("new sampler")
        this.instruments["sampler"].push(new MaxiSamplerProcessor());
      }
      if(event.data.noteon !== undefined)
      {
        const data = event.data.noteon;
        this.instruments[data.instrument][data.index].externalNoteOn(data.val);
      }
      if(event.data.noteoff !== undefined)
      {
        const data = event.data.noteoff;
        this.instruments[data.instrument][data.index].externalNoteOff(data.val);
      }
      if(event.data.tempo !== undefined)
      {
		    this.myClock.setTempo(event.data.tempo)
      }
      if(event.data.audio !== undefined)
      {
        const data = event.data.audio;
        const audioData = this.translateFloat32ArrayToBuffer(data.val.audioBlob);
        this.instruments.sampler[data.index].samples[data.val.index].setSample(audioData);
      }
      if(event.data.togglePlaying !== undefined)
      {
        this.toggleIsPlaying();
      }
      if(event.data.rewind !== undefined)
      {
        this.rewind();
      }
      if(event.data.loopAll !== undefined)
      {
        const data = event.data.loopAll;
        const beatLength = 60 / this.myClock.bpm;
        const loopInSamples = (data / 24) * beatLength * 44100;
        this.getInstruments().forEach((s)=> {
          s.loopTicks = data
          s.loopSamples = loopInSamples
        })
      }
      if(event.data.loop !== undefined)
      {
        const data = event.data.loop;
        const beatLength = 60 / this.myClock.bpm;
        const loopInSamples = (data.val / 24) * beatLength * 44100;
        this.instruments[data.instrument][data.index].loopTicks = data.val;
        this.instruments[data.instrument][data.index].loopSamples = loopInSamples;
      }
    }
  }

 translateFloat32ArrayToBuffer(audioFloat32Array) {

    var maxiSampleBufferData = new Maximilian.VectorDouble();
    for (var i = 0; i < audioFloat32Array.length; i++) {
      maxiSampleBufferData.push_back(audioFloat32Array[i]);
    }
    return maxiSampleBufferData;
  }

  logGain(gain) {
    return 0.175 * Math.exp(gain * 0.465);
  }

  getInstruments() {
    return this.instruments.synth.concat(this.instruments.sampler)
  }

  toggleIsPlaying() {
    this.isPlaying = !this.isPlaying;
    if(!this.isPlaying)
    {
      this.getInstruments().forEach((s)=> {
        s.onStop()
      })
    }
  }

  rewind() {
    this.getInstruments().forEach((s)=> {
      s.playHead = 0;
    });
  }

  onSample() {
    this.getInstruments().forEach((s)=> {
      s.onSample()
    })
    this.handleClock();
    this.handleRingBuf();
  }

  handleRingBuf() {
    if(this._param_reader !== undefined &&
    this.paramKeys["synth"] !== undefined &&
    this.paramKeys["sampler"] !== undefined)
    {
      if(this._param_reader.dequeue(this.output))
      {
        //console.log("this.output", this.output)
        const NUM_SYNTHS = 6;
        const NUM_SYNTH_PARAMS = this.paramKeys["synth"].length;
        const NUM_SAMPLERS = 6;
        const NUM_SAMPLER_PARAMS = this.paramKeys["sampler"].length;
        this.output.forEach((v, i)=> {
          //Synth Param
          if(i < NUM_SYNTHS * NUM_SYNTH_PARAMS)
          {
            const synthIndex = Math.floor(i / NUM_SYNTH_PARAMS);
            const synth = this.instruments["synth"][synthIndex];
            if(synth !== undefined)
            {
              const index = i % NUM_SYNTH_PARAMS;
              if(index < NUM_SYNTH_PARAMS)
              {
                const key = this.paramKeys["synth"][index];
                if(synth.parameters[key] === undefined)
                {
                  synth.parameters[key] = {};
                }
                //console.log(key, v);
                synth.parameters[key].val = v;
              }
            }
          }
          //Sampler param
          else if (i < (NUM_SYNTHS * NUM_SYNTH_PARAMS) + (NUM_SAMPLERS * NUM_SAMPLER_PARAMS))
          {
            const samplerIndex = Math.floor((i - (NUM_SYNTHS * NUM_SYNTH_PARAMS)) / NUM_SAMPLER_PARAMS);
            const sampler = this.instruments["sampler"][samplerIndex];
            //console.log(samplerIndex, sampler)
            if(sampler !== undefined)
            {
              const index = (i - (NUM_SYNTHS * NUM_SYNTH_PARAMS)) % NUM_SAMPLER_PARAMS;
              if(index < NUM_SAMPLER_PARAMS)
              {
                const key = this.paramKeys["sampler"][index]
                if(sampler.parameters[key] === undefined)
                {
                  sampler.parameters[key] = {};
                }
                //console.log("adding from buf", key, samplerIndex, v, i, index);
                sampler.parameters[key].val = v;
              }
            }
          }
        })
      }
    }
  }

  handleClock() {
    if(this.myClock && this.isPlaying)
    {
      this.myClock.ticker();
      if(this.myClock.tick)
      {
        this.getInstruments().forEach((s, i)=> {
          s.tick();
          this.loops[i] = s.playHead;
        })
        if(this.loopWriter !== undefined)
        {
          this.loopWriter.enqueue(this.loops);
        }
      }
    }
  }

  makeBlock(chan, block) {
    let b = [];
    for(let i = 0; i < chan; i++) {
      let ar = [];
      for(let j = 0; j < block; j ++) {
        ar.push(0)
      }
      b.push(ar)
    }
    return b;
  }

  process(inputs, outputs, parameters)
  {
    for(let o = 0; o < outputs.length; o++)
    {
      let output = outputs[o];
      let multiChannelSample = new Array(output.length).fill(0);
      let multiChannelBlock = this.makeBlock(output.length, output[0].length);
      for (let channel = 0; channel < output.length; channel++)
      {
        const outputChannel = output[channel];
        if(channel === 0)
        {
          for (let s = 0; s < outputChannel.length; s++)
          {
            this.onSample();
            this.getInstruments().forEach((inst, i)=> {
              multiChannelSample = inst.signal();
              for (let c = 0; c < multiChannelSample.length; c++)
              {
                multiChannelBlock[c][s] += multiChannelSample[c];
              }
            });
            outputChannel[s] = multiChannelBlock[channel][s];
          }
        }
        else
        {
          for (let s = 0; s < outputChannel.length; s++)
          {
            outputChannel[s] = multiChannelBlock[channel][s];
          }
        }
      }
    }
    return true;
  }

}
registerProcessor("maxi-synth-processor", MaxiInstrumentsProcessor);
