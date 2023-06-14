
var initAudioEngine = (origin = document.location.origin+"/libs")=>{
  return new Promise((resolve, reject)=>{
    //Dynamically load modules
    import(origin + "/index.mjs").then((semaEngine)=>{
      import(origin + "/ringbuf.js").then((RingBuffer)=>{
        //Setup sema engine
        const Engine = semaEngine.Engine
        const Learner = semaEngine.Learner
        var maxi = new Engine();
        var inputBufferIds = []
        //init Engine
        maxi.init(origin).then(()=>{
          let learner = new Learner();
          maxi.addLearner('l1', learner);
          maxi.addSample = (name, url)=> {
            return maxi.loadSample(name + "----", url, true)
          }
          let dspCode = "";

          //What happens is we do a dacOut on the play function
          dspCode = {
            setup: `() => {
              let q=this.newq();
              let createDSPLoop = ()=> {
                return ()=>{return 0}
              }
              q.play = createDSPLoop();
              return q;
            }`,
            loop: `(q, inputs, mem) => {
              var sig = q.play(inputs);
              if(Array.isArray(sig)) {
                for(let i = 0; i < sig.length; i++) {
                  this.dacOut(sig[i], i);
                }
              } else {
                this.dacOutAll(sig);
              }
            }`
          }

          maxi.addEventListener('onSharedBuffer', (e) => {
            console.log("onSharedBuffer", e)
            let ringbuf = new RingBuffer.default(e.sab, Float64Array);
            maxi.sharedArrayBuffers[e.channelID] = {
              sab: e.sab,
              rb: ringbuf,
              blocksize:e.blocksize
            };
          });

          let pollRate = 10;
          function sabPrinter() {
            try {
              //Only check if we need to (e.g. they have defined a callback)
              if(maxi.onInput !== undefined) {
                for (let v in maxi.sharedArrayBuffers) {
                  if(!inputBufferIds.includes(v)) {
                    let avail = maxi.sharedArrayBuffers[v].rb.available_read();
                    if ( avail > 0 && avail != maxi.sharedArrayBuffers[v].rb.capacity) {
                      for (let i = 0; i < avail; i += maxi.sharedArrayBuffers[v].blocksize) {
                        let elements = new Float64Array(maxi.sharedArrayBuffers[v].blocksize);
                        let val = maxi.sharedArrayBuffers[v].rb.pop(elements);
                        if(maxi.onInput) {
                          maxi.onInput(v,elements)
                        }
                      }
                    }
                  }
                }
              }
              setTimeout(sabPrinter, pollRate);
            } catch (error) {
              setTimeout(sabPrinter, pollRate);
            }
          }
          sabPrinter()

          maxi.send = (id, data)=> {
            if(maxi.sharedArrayBuffers[id] === undefined) {
              inputBufferIds.push(id)
              maxi.createSharedBuffer(id, "ML", data.length);
              console.log(maxi.sharedArrayBuffers)
            }
            maxi.pushDataToSharedBuffer(id, data);
          }

          maxi.setAudioCode = async (location, newSetup = true)=>{
            console.log("setAudioCode")
            const executeCode = (userCode)=> {
              userCode = userCode.replace(/Maximilian/g, "Module");
              dspCode = {}
              if(!newSetup) {
                dspCode.setup = `(q)=>{
                  let createDSPLoop = ()=> {` +
                    userCode +
                    ` return play;
                  }
                  q.play = createDSPLoop();
                  return q;
                }`;
                dspCode.loop = `(q, inputs, mem) => {
                  var sig = q.play(inputs);
                  if(Array.isArray(sig)) {
                    for(let i = 0; i < sig.length; i++) {
                      this.dacOut(sig[i], i);
                    }
                  } else {
                    this.dacOutAll(sig);
                  }
                }`
                dspCode.keepq = true;
              } else {
                dspCode.setup = `()=>{
                  let q = this.newq();
                  let createDSPLoop = ()=> {` +
                    userCode +
                    ` return play;
                  }
                  q.play = createDSPLoop();
                  return q;
                }`
                dspCode.loop = `(q, inputs, mem) => {
                  var sig = q.play(inputs);
                  if(Array.isArray(sig)) {
                    for(let i = 0; i < sig.length; i++) {
                      this.dacOut(sig[i], i);
                    }
                  } else {
                    this.dacOutAll(sig);
                  }
                }`
              }

              setTimeout(()=>{
                maxi.eval(dspCode, false)
              },50);
            }
            //Try script element
            let scriptElement = document.getElementById(location)
            console.log("location",location, scriptElement)
            if(scriptElement !== null)
            {
              executeCode(scriptElement.innerHTML)
            }
            else
            {
              //Else try url
              console.log("try url")
              function isValidURL(url) {
                try {
                  new URL(url);
                  return true;
                } catch (error) {
                  return false;
                }
              }
              if(isValidURL(location)) {
                let response = await fetch(location);
                if (response.ok) {
                  let text = await response.text();
                  console.log("executing http code")
                  executeCode(text)
                }
              }
              else {
                //Else use string literal
                console.log("executing literal code")
                executeCode(location)
              }
            }
          }
          resolve(maxi)
        })
      })
    })
  })
}
