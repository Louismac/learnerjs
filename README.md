# Learner JS

Home of Learner.js and MaxiInstruments.js

Learner.js and MaxiInstruments.js are two libraries built as part of the [MIMIC
research project](https://mimicproject.com). Here we host the source and gives instructions
for using the libraries locally, or in other projects away from the main MIMIC site.


## Learner.js

Learner.js provides an interface that allows you to easily record in examples of input and output pairings into a dataset that is saved locally in your browser.

You can then train a model to respond with new outputs when you provide new inputs.

We take care of all the storage, threading and GUI needs and all you have to do is pick what you want to control is what!

You can [follow the guide](https://mimicproject.com/guides/learner) on the MIMIC site to learn more about the library

Or you can [look at the API documentation](https://www.doc.gold.ac.uk/~lmcca002/Learner.html).

## MaxiInstruments.js

For a number of reasons, currently, MaxiInstruments will **performs best in Chrome**!. It does work in Firefox, although if you are pushing limits computationally, you can get some artefacts.

MaxiInstruments is a class of simple synths and samplers that are designed to so that their parameters can be easily controlled using the Learner.js library.

They are AudioWorklets backed so do not get interrupted by beefy feature extractors one might use an an input or the running of a model to do the mapping.

You can [follow the guide](https://mimicproject.com/guides/maxi-instrument) on the MIMIC site to learn more about the library

Or you can [look at the API documentation](https://www.doc.gold.ac.uk/~lmcca002/MaxiInstrument.html).

## Running Locally

To run on your local machine you will need to access the libraries. 

For ``MaxiInstruments`` there are some specfic headers related to [SharedArrayBufferes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements) that mean this will only work under certain circumstances. We give examples of either running this fully locally serving the files yourself, or using the versions hosted on mimicproject.com

### Use libraries hosted on mimicproject.com

If you have access to the internet whilst running libraries, this may be the best option. 

**Include the libraries** 
```
<script crossorigin src = "https://mimicproject.com/libs/learner.v.0.4.js"></script>
<script crossorigin src = "https://mimicproject.com/libs/maxiInstruments.v.0.7.1.js"></script>
```

**Tell MaxiInstruments where to find libraries** 

```
const instruments = new MaxiInstruments("https://mimicproject.com/libs");
```

You can change the urls appropriately if you are hosting elsewhere

### Locally hosted library

The recommended way to do this is to use the python server we have provided (``server.py``). 

Then when **in the project folder in the terminal** run the command below.

```
python server.py
```

This serves the files in the folder at http://localhost:4200 and adds a header to get around CORS issues.


**Include the libraries** 
```
<script crossorigin src = "./libs/learner.v.0.4.js"></script>
<script crossorigin src = "./libs/maxiInstruments.v.0.7.1.js"></script>
```

**Tell MaxiInstruments where to find libraries** 

```
const instruments = new MaxiInstruments("http://localhost:4200/libs");
```

## Run demo locally!

Then when **in the project folder in the terminal** run the command below.

```
python server.py
```

Then all you need to do is visit http://localhost:4200 to see the demo running

