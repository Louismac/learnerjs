import Maximilian from "http://localhost:4200/libs/maximilian.wasmmodule.v.0.3.js"

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
    this.playHead = 0;
    for(let i = 0; i < voices; i++)
    {
      this.samples.push(new Maximilian.maxiSample());
      this.adsr.push(new Maximilian.maxiEnv());
      this.velocities.push(1);
    }
    //this.dcf = new Maximilian.maxiFilter();
    this.seqPtr = 0;
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

  //Execute noteon/noteoffs (whether sequenced or manually triggered)
  handleCmd(nextCmd) {
    if(this.paramsLoaded())
    {
      const f = nextCmd.f;
      const v = nextCmd.v !== undefined ? nextCmd.v : 127;
      if(nextCmd.cmd === "noteon")
      {
        this.samples[f].trigger();
        this.velocities[f] = v/127;
      }
    }
  }

  handleLoop() {
    this.seqPtr = this.playHead = 0;
  }

  tick() {
    if(this.playHead >= this.loopTicks)
    {
      this.handleLoop();
    }

    while(this.doTrig())
    {
      const nextCmd = this.sequence[this.seqPtr]
      this.handleCmd(nextCmd);
      this.seqPtr++;
    }
    this.playHead++;
  }

  //CURRENTLY UNUSED STUBS
  onSample() {}
  onStop() {}

  paramsLoaded() {
    return Object.keys(this.parameters).length == 16;
  }

  signal(parameters) {
    this.dcoOut = 0;
    if(this.paramsLoaded())
    {
      for(let i = 0; i < this.samples.length; i++)
      {
        const s = this.samples[i];
        if(s.isReady())
        {
          // let end = this.parameters['end_'+i].val;
          // if(end == 0)
          // {
          //   end = s.getLength();
          // }
          // let start = this.parameters['start_'+i].val;
          let rate = this.parameters['rate_'+i].val
          let gain = this.parameters['gain_' + i].val;
          //let gain = i == 0 ? 1:0;
          this.dcoOut += s.playOnce(rate) * gain * this.velocities[i];
        }
        this.adsr[i].trigger = 0;
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
    for(let i = 0; i < voices; i++)
    {
      this.dco.push(new Maximilian.maxiOsc());
      this.adsr.push(new Maximilian.maxiEnv());
    }
    this.lfo = new Maximilian.maxiOsc();
    this.dcf = new Maximilian.maxiFilter();
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
    if(this.parameters.poly.val == 1)
    {
      return this.triggered.map(a => a.f).includes(f);
    }
    else
    {
      return this.triggered.length > 0;
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

  //Execute noteon/noteoffs (whether sequenced or manually triggered)
  handleCmd(nextCmd) {
    if(this.paramsLoaded())
    {
      const f = Math.round((nextCmd.f + Number.EPSILON) * 100) / 100;
    //  console.log(nextCmd.cmd)
      if(nextCmd.cmd === "noteon")
      {
        if(this.parameters.poly.val == 1)
        {
          this.triggerNoteOn(f, nextCmd.v)
        }
        else
        {
          //console.log("trigger poly", this.parameters.frequency.val, this.parameters.frequency2.val)
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
    this.adsr[t.o].trigger = 0;
    let releaseTime = this.samplePtr +
      ((this.parameters.release.val / 1000) * this.sampleRate);
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

  handleLoop() {
	  //Wrap around any release times
    for(let i = 0; i < this.released.length; i++)
    {
      this.released[i].off = this.released[i].off % this.loopSamples;
      //console.log("wrapping round", this.released[i].off, this.released[i].f)
    }
    this.midiPanic();
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
    this.midiPanic();
  }

  midiPanic() {
    this.triggered.forEach((trig)=> {
      this.externalNoteOff(trig.f);
    });
  }

  paramsLoaded() {
    return Object.keys(this.parameters).length == 16;
  }

  signal() {
    if(this.paramsLoaded())
    {
      const poly = this.parameters.poly.val == 1;

      const lfoOut = this.lfo.sinewave(this.parameters.lfoFrequency.val);
      const oscFn = this.getOscFn(this.parameters.oscFn.val);
      this.dcoOut = 0;
      const out = this.triggered.concat(this.released);

      for(let o of out)
      {
        const envOut = this.adsr[o.o].adsr(1, this.adsr[o.o].trigger);
        o.lastVol = envOut;
        const pitchMod = (this.parameters.adsrPitchMod.val * envOut) + (lfoOut * this.parameters.lfoPitchMod.val);
        const ampOsc =  ((lfoOut + 1 ) / 2) * this.parameters.lfoAmpMod.val;
        const normalise = poly ? this.dco.length : 4.0;
        const ampMod = (envOut + (ampOsc * envOut)) / normalise;
        //const ampMod = envOut / 3;

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
        // if(this.samplePtr % 1000 == 0) {
        //   console.log(o.o, f, poly)
        // }
        //f = f < 0 ? 0 : f;
        let osc;
        if(oscFn === "noise")
        {
          osc = this.dco[o.o].noise();
        }
        else
        {
          osc = this.dco[o.o][oscFn](f + pitchMod);
          //osc = this.dco[o.o][oscFn](f);
        }
        this.dcoOut += (osc * ampMod * this.parameters.gain.val * o.v);
      }

      //Filter

      let filterEnv = 1;
      const filterOsc = ((lfoOut + 1)/2) * this.parameters.lfoFilterMod.val;
      let cutoff = this.parameters.cutoff.val;
      cutoff = (cutoff * filterEnv) + filterOsc;
      if (cutoff > 2000) {
        cutoff = 2000;
      }
      if (cutoff < 40) {
        cutoff = 40;
      }
      this.dcfOut = this.dcf.lores(this.dcoOut, cutoff, this.parameters.Q.val);
      return this.dcfOut;
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
    this.output = new Float32Array(256);
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
        //console.log("seqeuence", data.val)
        this.instruments[data.instrument][data.index].sequence = data.val;
      }
      if(event.data.addSynth !== undefined)
      {
        //console.log("ADDING SYNTH");
        this.instruments["synth"].push(new MaxiSynthProcessor());
      }
      if(event.data.addSampler !== undefined)
      {
        //console.log("ADDING SAMPLER");
        this.instruments["sampler"].push(new MaxiSamplerProcessor());
      }
      if(event.data.noteon !== undefined)
      {
        const data = event.data.noteon;
        //console.log("received noteon", data.instrument, data.index, data.val)
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
      if(event.data.parameters !== undefined)
      {
		    const data = event.data.parameters;
        this.instruments[data.instrument][data.index].parameters = data.val
      }
      if(event.data.audio !== undefined)
      {
        const data = event.data.audio;
        const audioData = this.translateFloat32ArrayToBuffer(data.val.audioBlob);
        this.instruments.sampler[data.index].samples[data.val.index].setSample(audioData);
        console.log("received audio")
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

  synthKey(index) {
    switch (index) {
      case 0:return "gain";
      case 1:return "attack";
      case 2:return "decay";
      case 3:return "sustain";
      case 4:return "release";
      case 5:return "lfoFrequency";
      case 6:return "lfoPitchMod";
      case 7:return "lfoFilterMod";
      case 8:return "lfoAmpMod";
      case 9:return "adsrPitchMod";
      case 10:return "cutoff";
      case 11:return "Q";
      case 12:return "frequency";
      case 13:return "frequency2";
      case 14:return "poly";
      case 15:return "oscFn";
    }
  }

  samplerKey(index) {
    const p = index % 2 == 0 ? "gain" : "rate";
    return p + "_" + Math.floor(index / 2);
  }

  handleRingBuf() {
    if(this._param_reader !== undefined)
    {
      if(this._param_reader.dequeue(this.output))
      {
        const NUM_SYNTHS = 6;
        const NUM_SYNTH_PARAMS = 18;
        const NUM_SAMPLERS = 6;
        const NUM_SAMPLER_PARAMS = (2 * 8) + 2;
        this.output.forEach((v, i)=> {
          if(i < NUM_SYNTHS * NUM_SYNTH_PARAMS)
          {
            const synthIndex = Math.floor(i / NUM_SYNTH_PARAMS);
            const synth = this.instruments["synth"][synthIndex];
            if(synth !== undefined)
            {
              const index = i % NUM_SYNTH_PARAMS;
              if(index < NUM_SYNTH_PARAMS - 2)
              {
                const key = this.synthKey(index)
                if(synth.parameters[key] === undefined)
                {
                  synth.parameters[key] = {};
                }
                synth.parameters[key].val = v;
              }
              else
              {
                if(index == NUM_SYNTH_PARAMS - 2)
                {
                  //console.log("external note on", v)
                  //this.instruments["synth"][synthIndex].externalNoteOn(v);
                }
                else
                {
                  //console.log("external note off", v)
                  //synth.externalNoteOff(v);
                }
              }
            }
          }
          //Sampler param
          else if (i < (NUM_SYNTHS * NUM_SYNTH_PARAMS) + (NUM_SAMPLERS * NUM_SAMPLER_PARAMS))
          {
            const samplerIndex = Math.floor((i - (NUM_SYNTHS * NUM_SYNTH_PARAMS)) / NUM_SAMPLER_PARAMS);
            const sampler = this.instruments["sampler"][samplerIndex];
            if(sampler !== undefined)
            {
              const index = (i - (NUM_SYNTHS * NUM_SYNTH_PARAMS)) % NUM_SAMPLER_PARAMS;
              if(index < NUM_SAMPLER_PARAMS - 2)
              {
                const key = this.samplerKey(index)
                if(sampler.parameters[key] === undefined)
                {
                  sampler.parameters[key] = {};
                }
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

  process(inputs, outputs, parameters)
  {
    const outputsLength = outputs.length;
    for (let outputId = 0; outputId < outputsLength; ++outputId) {
      let output = outputs[outputId];

      for (let channel = 0; channel < output.length; ++channel) {
        let outputChannel;

        if (this.DAC === undefined || this.DAC.length === 0) {
          outputChannel = output[channel];
        } else {
          if (this.DAC[channel] === undefined)
            break;
          else {
            if (output[this.DAC[channel]] !== undefined) {
              outputChannel = output[this.DAC[channel]];
            } else {
              continue;
            }
          }
        }
        for (let i = 0; i < 128; ++i) {
          this.onSample();
          this.getInstruments().forEach((s)=> {
            outputChannel[i] += s.signal();
          });
        }
      }
    }
    return true;
  }

}
registerProcessor("maxi-synth-processor", MaxiInstrumentsProcessor);
