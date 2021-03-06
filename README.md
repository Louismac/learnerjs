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

MaxiInstruments is a class of simple synths and samplers that are designed to so that their parameters can be easily controlled using the Learner.js library.

They are AudioWorklets backed so do not get interrupted by beefy feature extractors one might use an an input or the running of a model to do the mapping.

You can [follow the guide](https://mimicproject.com/guides/maxi-instrument) on the MIMIC site to learn more about the library

Or you can [look at the API documentation](https://www.doc.gold.ac.uk/~lmcca002/MaxiInstrument.html).


## Running Locally

To run on your local machine you will first need to serve some files. The recommended way to do this is to use the node package [http-server](https://www.npmjs.com/package/http-server). Follow the instructions to install globally. You may have to also install the cors library globally also.

```
npm install http-server -g
npm install cors -g
```

Then when in the project folder in the terminal run the command below.

```
http-server -p 4200 --cors
```

This serves the files in the folder at http://localhost:4200 and adds a header to get around CORS issues.

Then all you need to do is visit index.html to see the demo running.
.
